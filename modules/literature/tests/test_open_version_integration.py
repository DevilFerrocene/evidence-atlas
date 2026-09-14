import ast
import base64
from copy import deepcopy
import json
from pathlib import Path
import re
import sys
from types import SimpleNamespace
from typing import Any
import unittest
from unittest.mock import Mock
from urllib.parse import parse_qsl, unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "browser/literature_browser.py"
TREE = ast.parse(SOURCE.read_text())
sys.path.insert(0, str(ROOT / "src"))
from scientist_literature_mcp.browser_client import BrowserClient


class SameSessionDownloadError(RuntimeError):
    pass


class SameSessionAssetError(RuntimeError):
    pass


def isolated_browser_namespace():
    function_names = {"validate_url", "open_version_doi", "article_open_fallback_allowed"}
    constant_names = {"SUPPLEMENTARY_PDF_PATH_MARKERS", "SUPPLEMENTARY_PDF_FILENAME_RE"}
    nodes = [
        node for node in TREE.body
        if isinstance(node, ast.FunctionDef) and node.name in function_names
        or isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id in constant_names
            for target in node.targets
        )
    ]
    manager = next(node for node in TREE.body if isinstance(node, ast.ClassDef) and node.name == "BrowserManager")
    nodes.append(next(node for node in manager.body if isinstance(node, ast.FunctionDef) and node.name == "_read_in_worker"))
    namespace = {
        "Any": Any, "base64": base64, "re": re, "urlparse": urlparse,
        "unquote": unquote, "parse_qsl": parse_qsl,
        "READ_BUDGET_SECONDS": 120, "MAX_PDF_BYTES": 64 * 1024 * 1024,
        "time": SimpleNamespace(monotonic=Mock(return_value=1000.0)),
        "LiteratureBrowserError": RuntimeError,
        "SameSessionDownloadError": SameSessionDownloadError,
        "SameSessionAssetError": SameSessionAssetError,
        "host_allowed": lambda host: host in {"doi.org", "publisher.example", "repository.example"},
        "is_supplementary_pdf_url": Mock(return_value=False),
        "approved_open_url": Mock(return_value=True),
        "find_open_pdf": Mock(),
        "extract_pdf_text": Mock(return_value=("Open article text", False, 2)),
        "extract_numbered_references": Mock(return_value=[{"text": "Reference"}]),
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace


class OpenVersionWrapperChecks(unittest.TestCase):
    def setUp(self):
        self.namespace = isolated_browser_namespace()
        self.publisher_result = {
            "success": False, "url": "https://doi.org/10.1234/example",
            "final_url": "https://publisher.example/article/123", "status": 403,
            "page_state": "challenge", "access_state": "challenge",
            "text": "Verify access", "text_truncated": False,
            "pdf_download": {"success": False, "reason": "fetch_failed", "errors": ["publisher denied"]},
        }
        self.publisher = Mock(return_value=self.publisher_result)
        self.manager = SimpleNamespace(_read_publisher_in_worker=self.publisher)
        self.pdf = {
            "success": True, "source_url": "https://repository.example/article.pdf",
            "data_base64": base64.b64encode(b"%PDF-1.7\nopen bytes").decode(),
            "bytes": 19, "pages": 2, "title": "Open article",
            "source_kind": "open_access", "version": "acceptedVersion", "doi": "10.1234/example",
            "record_url": "https://repository.example/record/123",
        }
        self.lookup = {
            "attempted": True, "doi": "10.1234/example", "reason": "verified_open_pdf",
            "providers": [{"provider": "openalex", "status": "matched"}],
            "candidates": 1, "download_attempts": 1, "errors": [],
        }
        self.find = self.namespace["find_open_pdf"]
        self.find.return_value = (self.pdf, self.lookup)

    def read(self, url="https://doi.org/10.1234/example", **options):
        return self.namespace["_read_in_worker"](
            self.manager, url, **{"wait_ms": 0, "max_chars": 10000, "download_pdf": True, **options},
        )

    def test_available_publisher_pdf_skips_open_lookup(self):
        self.publisher_result["pdf_download"] = {"success": True, "source_url": "https://publisher.example/article.pdf"}
        result = self.read()
        self.assertIs(result, self.publisher_result)
        self.assertEqual(result["open_access"], {"attempted": False, "reason": "requested_pdf_available"})
        self.find.assert_not_called()

    def test_text_reads_maintenance_and_supplements_skip_open_lookup(self):
        cases = [
            ("https://doi.org/10.1234/example", {"download_pdf": False}),
            ("https://doi.org/10.1234/example", {"maintenance_session_refresh": True}),
            ("https://publisher.example/doi/suppl/10.1234/example", {}),
            ("https://publisher.example/article/suppdata/table.pdf", {}),
        ]
        for url, options in cases:
            with self.subTest(url=url, options=options):
                self.assertIs(self.read(url, **options), self.publisher_result)
                self.assertNotIn("deadline", self.publisher.call_args.kwargs)
        self.find.assert_not_called()

    def test_publisher_exception_recovers_with_original_failure_evidence(self):
        self.publisher.side_effect = RuntimeError("denied at https://publisher.example/private?token=secret")
        result = self.read()
        self.assertTrue(result["success"])
        self.assertEqual(result["publisher_attempt"]["page_state"], "error")
        failure = result["publisher_attempt"]["pdf_download"]
        self.assertEqual(failure["reason"], "publisher_request_failed")
        self.assertEqual(failure["errors"], ["RuntimeError: denied at [publisher URL]"])
        self.assertEqual(self.find.call_args.args, ("10.1234/example",))

    def test_same_session_asset_failures_remain_errors(self):
        for error in (SameSessionDownloadError, SameSessionAssetError):
            with self.subTest(error=error):
                self.publisher.side_effect = error("same-session operation failed")
                with self.assertRaises(error):
                    self.read()
        self.find.assert_not_called()

    def test_challenge_recovers_as_open_full_text_with_pdf_source(self):
        previous = deepcopy(self.publisher_result)
        result = self.read()
        self.assertTrue(result["success"])
        self.assertEqual(result["page_state"], "content")
        self.assertEqual(result["access_state"], "open_access_full_text")
        self.assertEqual(result["status"], 200)
        self.assertEqual(result["text"], "Open article text")
        self.assertEqual(result["text_source"], "open_version_pdf")
        self.assertEqual(result["text_source_url"], self.pdf["source_url"])
        self.assertEqual(result["final_url"], self.pdf["source_url"])
        self.assertEqual(result["publisher_attempt"], {key: previous[key] for key in ("page_state", "access_state", "status", "pdf_download")})
        self.assertIs(result["open_access"], self.lookup)
        self.assertIs(result["pdf_download"], self.pdf)
        self.assertTrue(result["pdf_extraction"]["success"])

    def test_open_success_retains_requested_doi_url_after_publisher_redirect(self):
        requested = "https://doi.org/10.1234/example"
        redirected = "https://publisher.example/challenge?__cf_chl_tk=transient#verification"
        self.publisher_result.update(url=redirected, final_url=redirected)
        result = self.read(requested)
        self.assertTrue(result["success"])
        self.assertEqual(result["url"], requested)
        self.assertEqual(result["final_url"], self.pdf["source_url"])
        self.assertEqual(result["publisher_attempt"]["status"], 403)
        self.assertEqual(self.find.call_args.args, ("10.1234/example",))

    def test_unsuccessful_challenge_strips_transient_url_and_retains_publisher_status(self):
        for requested, attempted in (("https://publisher.example/article/123", False), ("https://doi.org/10.1234/example", True)):
            with self.subTest(requested=requested):
                self.find.reset_mock()
                self.find.return_value = ({"success": False, "reason": "no_verified_open_pdf"}, self.lookup)
                redirected = "https://publisher.example/challenge?__cf_chl_tk=transient#verification"
                self.publisher.return_value = {
                    **deepcopy(self.publisher_result), "url": redirected, "final_url": redirected,
                }
                result = self.read(requested)
                self.assertFalse(result["success"])
                self.assertEqual(result["url"], requested)
                self.assertEqual(result["final_url"], "https://publisher.example/challenge")
                self.assertEqual(result["status"], 403)
                self.assertEqual(result["page_state"], "challenge")
                self.assertEqual(result["publisher_attempt"]["status"], 403)
                self.assertEqual(result["publisher_attempt"]["pdf_download"]["reason"], "fetch_failed")
                self.assertEqual(result["open_access"]["attempted"], attempted)
                self.assertEqual(self.find.call_count, int(attempted))

    def test_open_lookup_failure_preserves_publisher_body_and_details(self):
        previous = deepcopy(self.publisher_result)
        self.find.return_value = ({"success": False, "reason": "no_verified_open_pdf"}, self.lookup)
        result = self.read()
        for key in ("success", "url", "final_url", "status", "page_state", "access_state", "text", "text_truncated"):
            self.assertEqual(result[key], previous[key], key)
        self.assertEqual(result["pdf_download"], {**previous["pdf_download"], "open_version_reason": "no_verified_open_pdf"})
        self.assertEqual(result["publisher_attempt"]["pdf_download"], previous["pdf_download"])
        self.namespace["extract_pdf_text"].assert_not_called()

    def test_missing_doi_does_not_search(self):
        result = self.read("https://publisher.example/article/123")
        self.assertEqual(result["open_access"], {"attempted": False, "reason": "doi_unavailable"})
        self.find.assert_not_called()

    def test_publisher_uses_reserved_budget_and_lookup_uses_overall_deadline(self):
        for seconds, budget, reserve in ((10, 10, 4), (60, 60, 24), (120, 120, 35), (600, 120, 35)):
            with self.subTest(seconds=seconds):
                self.publisher.return_value = deepcopy(self.publisher_result)
                self.read(timeout_seconds=seconds)
                self.assertEqual(self.publisher.call_args.kwargs["deadline"], 1000 + budget - reserve)
                self.assertEqual(self.find.call_args.kwargs["deadline"], 1000 + budget)
                self.assertEqual(self.find.call_args.kwargs["max_bytes"], 64 * 1024 * 1024)
                self.assertIs(self.find.call_args.kwargs["allowed_url"], self.namespace["approved_open_url"])

    def test_empty_pdf_text_or_extraction_error_preserves_verified_text_and_source(self):
        for error in (None, ValueError("invalid text layer")):
            with self.subTest(error=error):
                previous = {
                    **deepcopy(self.publisher_result), "success": True, "page_state": "content",
                    "access_state": "publisher_full_text", "text": "Verified publisher article",
                    "text_truncated": False, "text_source": "publisher_html",
                    "text_source_url": "https://publisher.example/fulltext/123", "references": [{"text": "Original reference"}],
                    "html_text_chars": 26, "full_text_dom_visible": True,
                    "html_extraction": {"attempted": True, "success": True},
                }
                self.publisher.return_value = deepcopy(previous)
                self.namespace["extract_pdf_text"].side_effect = error
                self.namespace["extract_pdf_text"].return_value = (" \n", False, 2)
                result = self.read()
                for key in ("text", "text_truncated", "text_source", "text_source_url", "access_state", "references", "html_text_chars", "full_text_dom_visible", "html_extraction"):
                    self.assertEqual(result[key], previous[key], key)
                self.assertEqual(result["final_url"], self.pdf["source_url"])
                self.assertIs(result["pdf_download"], self.pdf)
                self.assertEqual(result["pdf_extraction"]["success"], error is None)

    def test_preserved_text_without_source_url_uses_original_publisher_url(self):
        self.publisher_result.update(success=True, access_state="full_text_visible", text="Verified text")
        self.namespace["extract_pdf_text"].return_value = ("", False, 2)
        result = self.read()
        self.assertEqual(result["text_source_url"], "https://publisher.example/article/123")

    def test_invalid_url_is_rejected_before_publisher_or_open_lookup(self):
        for url in ("file:///tmp/article.pdf", "https://user:secret@doi.org/10.1234/example", "https://unapproved.example/10.1234/example"):
            with self.subTest(url=url):
                with self.assertRaises(RuntimeError):
                    self.read(url)
        self.publisher.assert_not_called()
        self.find.assert_not_called()


class OpenVersionIdentityChecks(unittest.TestCase):
    def setUp(self):
        self.namespace = isolated_browser_namespace()
        self.doi = self.namespace["open_version_doi"]

    def test_exact_doi_from_original_publisher_urls_and_metadata(self):
        cases = [
            ("https://doi.org/10.1234/AbC", {}, "10.1234/AbC"),
            ("https://dx.doi.org/10.1234%2FAbC", {}, "10.1234/AbC"),
            ("https://publisher.example/doi/pdf/10.1234/AbC.pdf?download=true", {}, "10.1234/AbC"),
            ("https://publisher.example/article/file?id=10.1234%2FAbC&type=printable", {}, "10.1234/AbC"),
            ("https://publisher.example/article/1", {"metadata": {"citation_doi": ["https://doi.org/10.1234/AbC"]}}, "10.1234/AbC"),
            ("https://publisher.example/article/1", {"metadata": {"dc.identifier": ["ISBN 123", "info:doi/10.1234/AbC"]}}, "10.1234/AbC"),
            ("https://publisher.example/article/1", {"final_url": "https://publisher.example/doi/abs/10.1234/AbC"}, "10.1234/AbC"),
            ("https://doi.org/10.1234/AbC", {"metadata": {"citation_doi": ["10.1234/other"]}}, "10.1234/AbC"),
        ]
        for original, result, expected in cases:
            with self.subTest(original=original, result=result):
                self.assertEqual(self.doi(original, result), expected)

    def test_metadata_case_variants_identify_one_doi(self):
        result = {"metadata": {"citation_doi": ["https://doi.org/10.1234/AbC"], "prism.doi": "doi:10.1234/abc"}}
        self.assertEqual(self.doi("https://publisher.example/article/1", result).casefold(), "10.1234/abc")

    def test_ambiguous_or_non_doi_metadata_is_rejected(self):
        cases = [
            {"metadata": {"citation_doi": ["10.1234/first", "10.1234/second"]}, "final_url": "https://doi.org/10.1234/first"},
            {"metadata": {"citation_doi": ["10.1234/first"], "prism.doi": "10.1234/second"}},
            {"metadata": {"citation_doi": ["This article cites 10.1234/abc", None, 42]}},
            {"text": "References: 10.1234/abc"},
        ]
        for result in cases:
            with self.subTest(result=result):
                self.assertEqual(self.doi("https://publisher.example/article/1", result), "")

    def test_supplement_paths_excluded_independent_of_pdf_host_approval(self):
        allowed = self.namespace["article_open_fallback_allowed"]
        for path in ("/doi/suppl/10.1234/article", "/suppdata/article.pdf", "/files/article-mmc1.pdf", "/files/article_MOESM1_ESM.pdf", "/files/article-si.pdf", "/action/downloadSupplement?doi=10.1234/article", "/files/supporting-information/table.pdf"):
            with self.subTest(path=path):
                self.assertFalse(allowed("https://unapproved.example" + path))
        self.assertFalse(allowed("https://acs.figshare.com/articles/123"))
        self.assertTrue(allowed("https://unapproved.example/article.pdf"))
        self.namespace["is_supplementary_pdf_url"].assert_called()


class OpenVersionClientChecks(unittest.TestCase):
    def test_download_delivers_open_version_evidence_without_encoded_payload(self):
        raw = b"%PDF-1.7\noriginal bytes"
        pdf = {
            "success": True, "bytes": len(raw), "pages": 2,
            "data_base64": base64.b64encode(raw).decode(),
            "source_url": "https://repository.example/article.pdf?token=private",
            "source_kind": "open_access", "version": "acceptedVersion", "doi": "10.1234/example",
            "repository": "Example repository", "identity_match": "exact_doi",
            "record_url": "https://repository.example/record/123?token=private",
        }
        evidence = {
            "open_access": {"attempted": True, "doi": "10.1234/example", "reason": "verified_open_pdf", "candidates": 1, "download_attempts": 1,
                            "providers": [{"provider": "openalex", "status": "matched"}], "errors": []},
            "publisher_attempt": {"page_state": "challenge", "access_state": "challenge", "status": 403,
                                  "pdf_download": {"success": False, "reason": "fetch_failed", "errors": ["publisher denied"]}},
        }
        client = BrowserClient("http://localhost:9020", routes=())
        client.request_json = Mock(return_value={
            "success": True, "text": "article", "access_state": "open_access_full_text",
            "pdf_download": pdf, **evidence,
        })
        result, saved = client.download_pdf("https://doi.org/10.1234/example")
        self.assertEqual(saved, raw)
        self.assertTrue(result["success"])
        for key in ("version", "doi", "source_kind", "repository", "identity_match"):
            self.assertEqual(result[key], pdf[key])
        self.assertEqual(result["record_url"], "https://repository.example/record/123")
        self.assertEqual(result["source_url"], "https://repository.example/article.pdf")
        self.assertEqual(result["publisher_attempt"], evidence["publisher_attempt"])
        self.assertEqual(result["open_access"], evidence["open_access"])
        encoded = json.dumps(result)
        self.assertNotIn("data_base64", encoded)
        self.assertNotIn(pdf["data_base64"], encoded)
        self.assertNotIn("private", encoded)
        self.assertNotIn("text", result)


if __name__ == "__main__":
    unittest.main()
