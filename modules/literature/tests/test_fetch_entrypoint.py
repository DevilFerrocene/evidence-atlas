import ast
import base64
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import time
import unittest
import re
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from urllib.parse import parse_qsl, urlencode, urlparse


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("fetch_literature", ROOT / "scripts/fetch_literature.py")
fetch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fetch)


class EntryPointChecks(unittest.TestCase):
    def test_http_error_preserves_status_and_detail(self):
        for status in (403, 429, 504):
            error = HTTPError("http://local", status, "HTTP error", {},
                              io.BytesIO(b'{"message":"specific failure"}'))
            with patch.object(fetch.urllib.request, "urlopen", side_effect=error):
                result = fetch.request_article("http://local", "https://doi.org/10.1/x", 90, False)
            self.assertEqual(result["http_status"], status)
            self.assertEqual(result["error"], "specific failure")
            self.assertEqual(result["retryable"], status != 403)

    def test_invalid_text_response_is_an_error(self):
        response = io.BytesIO(b'{"text":42}')
        with patch.object(fetch.urllib.request, "urlopen", return_value=response):
            result = fetch.request_article("http://local", "https://doi.org/10.1/x", 90, False)
        self.assertEqual(result["access_state"], "error")

    def test_failure_does_not_skip_next_article(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "papers"
            results = [{"access_state": "error", "http_status": 403, "error": "denied"},
                       {"access_state": "full_text_visible", "text": "article"}]
            with patch("sys.argv", ["fetch", "10.1039/one", "10.1039/two", "--output", str(output)]), \
                 patch.object(fetch, "request_article", side_effect=results), patch("sys.stdout", new=io.StringIO()):
                self.assertEqual(fetch.main(), 1)
            self.assertEqual((output / "0002.txt").read_text(), "article")
            self.assertEqual(json.loads((output / "0001.json").read_text())["http_status"], 403)

    def test_active_timeout_stops_batch_if_worker_stays_busy(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch("sys.argv", ["fetch", "10.1039/one", "10.1039/two", "--output", temp + "/papers"]), \
                 patch.object(fetch, "request_article", return_value={"access_state": "error", "wait_for_idle": True}) as request, \
                 patch.object(fetch, "wait_until_idle", return_value=False), patch("sys.stdout", new=io.StringIO()):
                self.assertEqual(fetch.main(), 1)
                self.assertEqual(request.call_count, 1)

    def test_too_short_timeout_rejected_before_output(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "papers"
            with patch("sys.argv", ["fetch", "10.1039/one", "--timeout", "1", "--output", str(output)]), \
                 patch("sys.stderr", new=io.StringIO()), self.assertRaises(SystemExit) as exc:
                fetch.main()
            self.assertEqual(exc.exception.code, 2)
            self.assertFalse(output.exists())


class WileyRecoveryChecks(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((ROOT / "browser/literature_browser.py").read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "recover_wiley_navigation")
        self.stop = Mock()
        self.goto = Mock(return_value="response")
        self.sample = Mock(return_value={"text": "article"})
        namespace = {"Any": object, "time": time, "DOM_READY_TIMEOUT_MS": 10000,
                     "LiteratureBrowserTimeoutError": TimeoutError, "stop_page_loading": self.stop,
                     "goto_with_dns_retry": self.goto, "page_access_sample": self.sample}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(ROOT / "browser/literature_browser.py"), "exec"), namespace)
        self.recover = namespace["recover_wiley_navigation"]

    def test_stalled_load_stops_and_samples_after_retry(self):
        page = Mock()
        page.wait_for_load_state.side_effect = TimeoutError("stalled")
        response, sample = self.recover(page, "https://onlinelibrary.wiley.com/article", deadline=time.monotonic() + 10)
        self.assertEqual(response, "response")
        self.assertEqual(sample["text"], "article")
        self.assertEqual(self.stop.call_count, 2)
        self.assertEqual(self.goto.call_count, 1)

    def test_expired_budget_never_restarts_navigation(self):
        with self.assertRaises(TimeoutError):
            self.recover(Mock(), "https://onlinelibrary.wiley.com/article", deadline=time.monotonic() - 1)
        self.stop.assert_not_called()
        self.goto.assert_not_called()

    def test_navigation_timeout_has_timeout_error_contract(self):
        tree = ast.parse((ROOT / "browser/literature_browser.py").read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "goto_with_dns_retry")
        class RequestTimeout(RuntimeError):
            pass
        namespace = {"Any": object, "time": time, "validate_url": lambda url: url,
                     "NAVIGATION_DNS_RETRIES": 1, "NAVIGATION_TIMEOUT_MS": 45000,
                     "LiteratureBrowserTimeoutError": RequestTimeout, "LiteratureBrowserError": RuntimeError}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(ROOT / "browser/literature_browser.py"), "exec"), namespace)
        page = Mock()
        page.goto.side_effect = TimeoutError("navigation stalled")
        with self.assertRaises(RequestTimeout):
            namespace["goto_with_dns_retry"](page, "https://publisher.test", deadline=time.monotonic() + 5)


class PublisherAccessChecks(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((ROOT / "browser/literature_browser.py").read_text())
        names = {"publisher_pdf_http_method", "classify_page"}
        functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
        self.namespace = {"urlparse": urlparse,
                          "host_in_domains": lambda host, domains: any(host == d or host.endswith("." + d) for d in domains),
                          "sciencedirect_problem_shell": lambda text: False}
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(ROOT / "browser/literature_browser.py"), "exec"), self.namespace)

    def test_post_is_restricted_to_annual_reviews_pdf_delivery(self):
        method = self.namespace["publisher_pdf_http_method"]
        self.assertEqual(method("https://www.annualreviews.org/deliver/fulltext/physchem/75/1/article.pdf"), "POST")
        self.assertEqual(method("https://www.annualreviews.org/login"), "GET")
        self.assertEqual(method("https://unrelated.test/deliver/fulltext/article.pdf"), "GET")

    def test_publisher_verification_pages_are_not_article_metadata(self):
        classify = self.namespace["classify_page"]
        for url, title in [("https://brill.com/", "Human Verification"),
                           ("https://opg.optica.org/", "Captcha"),
                           ("https://validate.perfdrive.com/", "Check")]:
            with self.subTest(url=url):
                self.assertEqual(classify(url, title, ""), "challenge")
        self.assertEqual(classify("https://brill.com/", "Research on captcha", "A paper about captcha"), "content")


@unittest.skipUnless(importlib.util.find_spec("pypdf"), "PDF checks require the browser's pypdf dependency")
class PDFExportChecks(unittest.TestCase):
    def setUp(self):
        from pypdf import PdfWriter
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        data = io.BytesIO()
        writer.write(data)
        self.pdf = data.getvalue()
        tree = ast.parse((ROOT / "browser/literature_browser.py").read_text())
        function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "download_article_pdf")
        self.browser = Mock(return_value=(self.pdf, "application/pdf", "https://publisher.test/file.pdf?Signature=private", 200))
        self.context = Mock(side_effect=RuntimeError("rejected"))
        namespace = {"Any": object, "time": time, "io": io, "base64": base64, "re": re,
                     "urlparse": urlparse, "parse_qsl": parse_qsl, "urlencode": urlencode, "MAX_PDF_CANDIDATES": 3,
                     "LiteratureBrowserError": RuntimeError,
                     "select_pdf_candidates": lambda links: ["https://publisher.test/file.pdf"],
                     "fetch_pdf_in_browser": self.browser, "fetch_pdf_with_context_request": self.context,
                     "validate_pdf_payload": Mock(), "extract_pdf_urls_from_viewer": Mock(return_value=[])}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(ROOT / "browser/literature_browser.py"), "exec"), namespace)
        self.download = namespace["download_article_pdf"]

    def test_original_bytes_and_public_source(self):
        result = self.download(Mock(), [], deadline=time.monotonic() + 10)
        self.assertEqual(base64.b64decode(result["data_base64"]), self.pdf)
        self.assertEqual(result["pages"], 1)
        self.assertEqual(result["source_url"], "https://publisher.test/file.pdf")

    def test_html_mislabeled_as_pdf_is_rejected(self):
        self.browser.return_value = (b"<html>verification</html>", "application/pdf", "https://publisher.test/file.pdf", 200)
        result = self.download(Mock(), [], deadline=time.monotonic() + 10)
        self.assertFalse(result["success"])
        self.assertNotIn("data_base64", result)

    def test_plos_article_query_is_preserved_without_signature(self):
        self.browser.return_value = (self.pdf, "application/pdf", "https://journals.plos.org/plosone/article/file?id=10.1371/journal.pone.0256990&type=printable&Signature=private", 200)
        result = self.download(Mock(), [], deadline=time.monotonic() + 10)
        self.assertEqual(dict(parse_qsl(urlparse(result["source_url"]).query)),
                         {"id": "10.1371/journal.pone.0256990", "type": "printable"})

    def test_expired_pdf_budget_does_not_start_fetch(self):
        result = self.download(Mock(), [], deadline=time.monotonic() - 1)
        self.assertEqual(result["reason"], "time_budget_exhausted")
        self.browser.assert_not_called()


if __name__ == "__main__":
    unittest.main()
