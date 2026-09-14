import base64
import io
import json
from pathlib import Path
import sys
import time
import unittest
import urllib.error
import urllib.parse
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "browser"))
import open_access as oa


DOI = "10.1234/example"
ATOM = b'''<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry><id>http://arxiv.org/abs/2401.01234v2</id><title>A verified manuscript</title>
    <arxiv:doi>10.1234/EXAMPLE</arxiv:doi>
    <link title="pdf" href="http://arxiv.org/pdf/2401.01234v2" />
  </entry></feed>'''


class Response(io.BytesIO):
    def __init__(self, payload, headers=None):
        super().__init__(payload)
        self.headers = headers or {}


class OpenAccessChecks(unittest.TestCase):
    def setUp(self):
        oa._ARXIV_CACHE.clear()
        oa._ARXIV_LAST_REQUEST = 0
        self.deadline = time.monotonic() + 35
        self.allow = lambda url: True

    def pdf(self, pages=1):
        from pypdf import PdfWriter
        writer = PdfWriter()
        for _ in range(pages):
            writer.add_blank_page(width=72, height=72)
        output = io.BytesIO()
        writer.write(output)
        return output.getvalue()

    def work(self, **extra):
        return json.dumps({"doi": "https://doi.org/" + DOI, "display_name": "A paper", **extra}).encode()

    def test_normalization_and_declared_identity_required(self):
        self.assertEqual(oa.normalize_doi(" https://doi.org/10.1234%2FEXAMPLE "), DOI)
        for value in ("title only", "10.1234/a\ntext", None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                oa.normalize_doi(value)
        candidates, status = oa._openalex_candidates(self.work(doi="https://doi.org/10.1234/other"), DOI)
        self.assertEqual((candidates, status), ([], "doi_mismatch"))
        candidates, status = oa._arxiv_candidates(ATOM.replace(b"10.1234/EXAMPLE", b"10.1234/other"), DOI)
        self.assertEqual((candidates, status), ([], "no_exact_doi_match"))

    def test_openalex_requires_oa_and_excludes_supplements(self):
        payload = self.work(locations=[
            {"is_oa": False, "pdf_url": "https://journal.org/main.pdf"},
            {"is_oa": "true", "pdf_url": "https://journal.org/closed.pdf"},
            {"is_oa": True, "pdf_url": "https://journal.org/supplement.pdf"},
            {"is_oa": True, "pdf_url": None},
            {"is_oa": True, "pdf_url": "https://journal.org/article.pdf", "version": "publishedVersion",
             "source": {"type": "journal", "display_name": "Journal"}},
            {"is_oa": True, "pdf_url": "https://repository.org/article.pdf", "version": "acceptedVersion",
             "source": {"type": "repository", "display_name": "Repository"}},
        ])
        candidates, status = oa._openalex_candidates(payload, DOI)
        self.assertEqual(status, "ok")
        self.assertEqual(len(candidates), 2)
        self.assertEqual(candidates[0]["source_kind"], "open_repository")
        self.assertEqual(candidates[0]["version"], "acceptedVersion")
        self.assertEqual(candidates[1]["source_kind"], "open_access_publisher")

    def test_arxiv_keeps_verified_versioned_identifier(self):
        candidates, status = oa._arxiv_candidates(ATOM, DOI)
        self.assertEqual(status, "ok")
        self.assertEqual(candidates[0]["url"], "https://arxiv.org/pdf/2401.01234v2")
        self.assertEqual(candidates[0]["record_url"], "https://arxiv.org/abs/2401.01234v2")
        self.assertEqual(candidates[0]["version"], "submittedVersion")
        self.assertEqual(candidates[0]["identity_match"], "exact_doi")

    def test_url_rejects_local_names_ips_and_unsafe_forms(self):
        for url in ("http://repository.org/a.pdf", "https://user:pw@repository.org/a.pdf",
                    "https://127.0.0.1/a.pdf", "https://repository.org:444/a.pdf", "https://thing.local/a.pdf",
                    "https://localhost/a.pdf", "https://192.168.1.2/a.pdf", "https://thing.internal/a.pdf"):
            with self.subTest(url=url), self.assertRaises(oa._OpenAccessError):
                oa._checked_url(url, self.allow)
        self.assertEqual(oa._checked_url("https://repository.org/a.pdf", self.allow), "https://repository.org/a.pdf")

    def test_pdf_redirect_cannot_escape_pdf_policy(self):
        first = "https://repository.org/paper.pdf"
        blocked = "https://repository.org/private/paper.pdf"
        opener = Mock()
        opener.open.side_effect = urllib.error.HTTPError(first, 302, "redirect", {"Location": blocked}, None)
        with patch.object(oa.urllib.request, "build_opener", return_value=opener):
            with self.assertRaisesRegex(oa._OpenAccessError, "url_not_allowed"):
                oa._request_bytes(first, deadline=self.deadline, max_bytes=1000,
                                  allowed_url=self.allow, pdf_url_allowed=lambda url: "/private/" not in url)
        self.assertEqual(opener.open.call_count, 1)
        request = opener.open.call_args.args[0]
        self.assertNotIn("Cookie", request.headers)
        self.assertNotIn("Authorization", request.headers)
        self.assertNotIn("Referer", request.headers)

    def test_download_enforces_stream_and_declared_size_limits(self):
        for response in (Response(b"123456"), Response(b"1", {"Content-Length": "6"})):
            opener = Mock()
            opener.open.return_value = response
            with self.subTest(headers=response.headers), \
                 patch.object(oa.urllib.request, "build_opener", return_value=opener):
                with self.assertRaisesRegex(oa._OpenAccessError, "size_limit_exceeded"):
                    oa._request_bytes("https://repository.org/a.pdf", deadline=self.deadline,
                                      max_bytes=5, allowed_url=self.allow)
            self.assertTrue(response.closed)

    def test_real_pdf_parser_rejects_html_truncation_and_zero_pages(self):
        self.assertEqual(oa._pdf_pages(self.pdf(2)), 2)
        for payload in (b"<html>login</html>", b"%PDF-1.7\ntruncated", self.pdf(0)):
            with self.subTest(payload=payload[:20]), self.assertRaises(oa._OpenAccessError):
                oa._pdf_pages(payload)

    def test_fallback_returns_original_pdf_and_exact_provenance(self):
        raw = self.pdf(2)
        def fetch(url, **kwargs):
            if "api.openalex.org" in url:
                return self.work(locations=[]), url
            if "export.arxiv.org" in url:
                return ATOM, url
            self.assertEqual(url, "https://arxiv.org/pdf/2401.01234v2")
            self.assertIs(kwargs["pdf_url_allowed"], pdf_policy)
            return raw, url + "?token=secret&type=print"
        pdf_policy = lambda url: "arxiv.org" in url
        with patch.object(oa, "_request_bytes", side_effect=fetch):
            result, summary = oa.find_open_pdf(DOI, deadline=self.deadline, max_bytes=100000,
                                               allowed_url=self.allow, pdf_url_allowed=pdf_policy)
        self.assertTrue(result["success"])
        self.assertEqual(base64.b64decode(result["data_base64"]), raw)
        self.assertEqual(result["pages"], 2)
        self.assertEqual(result["doi"], DOI)
        self.assertEqual(result["repository"], "arXiv")
        self.assertEqual(result["version"], "submittedVersion")
        self.assertEqual(result["identity_match"], "exact_doi")
        self.assertNotIn("token=", result["source_url"])
        self.assertEqual(summary["reason"], "found")

    def test_arxiv_cache_avoids_repeated_queries(self):
        with patch.object(oa, "_request_bytes", return_value=(ATOM, "https://export.arxiv.org/api/query")) as fetch:
            first, _ = oa._query_arxiv(DOI, self.deadline, self.allow)
            first[0]["title"] = "Caller mutation"
            second, _ = oa._query_arxiv(DOI, self.deadline, self.allow)
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual(second[0]["title"], "A verified manuscript")

    def test_arxiv_spacing_consumes_the_same_deadline(self):
        oa._ARXIV_LAST_REQUEST = time.monotonic()
        with patch.object(oa, "_request_bytes") as fetch, patch.object(oa.time, "sleep") as sleep:
            with self.assertRaisesRegex(oa._OpenAccessError, "time_budget_exhausted"):
                oa._query_arxiv(DOI, time.monotonic() + 1, self.allow)
        fetch.assert_not_called()
        sleep.assert_not_called()

    def test_arxiv_search_keeps_input_case_and_case_variants_in_one_query(self):
        with patch.object(oa, "_request_bytes", return_value=(ATOM, "https://export.arxiv.org/api/query")) as fetch:
            oa._query_arxiv(DOI, self.deadline, self.allow, "10.1234/Example")
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(fetch.call_args.args[0]).query)["search_query"][0]
        self.assertEqual(query, 'all:"10.1234/Example" OR all:"10.1234/example" OR all:"10.1234/EXAMPLE"')
        self.assertEqual(fetch.call_count, 1)

    def test_candidate_attempts_are_deduplicated_and_capped(self):
        locations = [{"is_oa": True, "pdf_url": f"https://repository.org/paper{index}.pdf"} for index in range(6)]
        locations.append(locations[0])
        def fetch(url, **kwargs):
            if "api.openalex.org" in url:
                return self.work(locations=locations), url
            raise oa._OpenAccessError("http_403")
        with patch.object(oa, "_request_bytes", side_effect=fetch), \
             patch.object(oa, "_query_arxiv", return_value=([], "no_exact_doi_match")):
            result, summary = oa.find_open_pdf(DOI, deadline=self.deadline, max_bytes=1000, allowed_url=self.allow)
        self.assertFalse(result["success"])
        self.assertEqual(summary["candidates"], 6)
        self.assertEqual(summary["download_attempts"], 3)
        self.assertEqual(len(summary["errors"]), 3)
        self.assertNotIn("data_base64", result)

    def test_expired_deadline_does_not_start_a_request(self):
        with patch.object(oa, "_request_bytes") as fetch:
            result, summary = oa.find_open_pdf(DOI, deadline=time.monotonic() - 1,
                                               max_bytes=1000, allowed_url=self.allow)
        fetch.assert_not_called()
        self.assertEqual(result["reason"], "time_budget_exhausted")
        self.assertEqual(summary["providers"], [])

    def test_disallowed_metadata_locations_do_not_spend_pdf_attempts(self):
        raw = self.pdf()
        locations = [{"is_oa": True, "pdf_url": f"https://unapproved.org/paper{index}.pdf",
                      "source": {"type": "repository"}} for index in range(4)]
        def fetch(url, **kwargs):
            if "api.openalex.org" in url:
                return self.work(locations=locations), url
            if "export.arxiv.org" in url:
                return ATOM, url
            self.assertIn("https://arxiv.org/pdf/", url)
            return raw, url
        with patch.object(oa, "_request_bytes", side_effect=fetch):
            result, summary = oa.find_open_pdf(DOI, deadline=self.deadline, max_bytes=100000,
                                               allowed_url=lambda url: "unapproved.org" not in url)
        self.assertTrue(result["success"])
        self.assertEqual(summary["download_attempts"], 1)
        self.assertEqual(len(summary["errors"]), 4)

    def test_source_kind_uses_host_type_independently_of_version(self):
        candidates, _ = oa._openalex_candidates(self.work(locations=[
            {"is_oa": True, "pdf_url": "https://journal.org/a.pdf", "version": "acceptedVersion",
             "source": {"type": "journal"}},
            {"is_oa": True, "pdf_url": "https://archive.org/a.pdf", "version": "publishedVersion",
             "source": {"type": "repository"}},
            {"is_oa": True, "pdf_url": "https://unknown.org/a.pdf", "version": "acceptedVersion"},
        ]), DOI)
        kinds = {item["url"]: item["source_kind"] for item in candidates}
        self.assertEqual(kinds["https://journal.org/a.pdf"], "open_access_publisher")
        self.assertEqual(kinds["https://archive.org/a.pdf"], "open_repository")
        self.assertEqual(kinds["https://unknown.org/a.pdf"], "unknown")

    def test_supplementary_pdf_redirect_is_rejected_before_second_request(self):
        first = "https://repository.org/article.pdf"
        opener = Mock()
        opener.open.side_effect = urllib.error.HTTPError(first, 302, "redirect",
                                                         {"Location": "/supporting-information.pdf"}, None)
        with patch.object(oa.urllib.request, "build_opener", return_value=opener):
            with self.assertRaisesRegex(oa._OpenAccessError, "supplementary_pdf"):
                oa._request_bytes(first, deadline=self.deadline, max_bytes=1000,
                                  allowed_url=self.allow, pdf_url_allowed=self.allow)
        self.assertEqual(opener.open.call_count, 1)

    def test_openalex_pdf_is_fetched_before_starting_second_provider(self):
        raw = self.pdf()
        def fetch(url, **kwargs):
            if "api.openalex.org" in url:
                return self.work(locations=[{"is_oa": True, "pdf_url": "https://repository.org/main.pdf",
                                             "source": {"type": "repository"}}]), url
            self.assertEqual(url, "https://repository.org/main.pdf")
            return raw, url
        with patch.object(oa, "_request_bytes", side_effect=fetch), patch.object(oa, "_query_arxiv") as arxiv:
            result, summary = oa.find_open_pdf(DOI, deadline=self.deadline, max_bytes=100000, allowed_url=self.allow)
        self.assertTrue(result["success"])
        self.assertEqual(len(summary["providers"]), 1)
        arxiv.assert_not_called()


if __name__ == "__main__":
    unittest.main()
