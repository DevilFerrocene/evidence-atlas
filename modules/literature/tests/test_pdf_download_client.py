import base64
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from scientist_literature_mcp.browser_client import BrowserClient, LiteratureBrowserClientError


class PdfDownloadClientChecks(unittest.TestCase):
    def setUp(self):
        self.raw = b"%PDF-1.7\noriginal bytes"
        self.pdf = {
            "success": True, "bytes": len(self.raw), "pages": 2,
            "data_base64": base64.b64encode(self.raw).decode(),
            "source_url": "https://journals.plos.org/article/file?id=10.1/x&type=print&token=secret",
        }
        self.client = BrowserClient("http://localhost:9020", routes=())
        self.client.request_json = Mock(return_value={
            "success": True, "text": "article", "access_state": "full_text_visible",
            "pdf_download": self.pdf,
        })

    def test_download_returns_original_bytes_and_compact_metadata(self):
        result, raw = self.client.download_pdf("https://doi.org/10.1/x")
        self.assertEqual(raw, self.raw)
        self.assertTrue(result["success"])
        self.assertEqual(result["pages"], 2)
        self.assertNotIn("text", result)
        self.assertNotIn("data_base64", result)
        self.assertNotIn("token=", result["source_url"])
        self.assertTrue(self.client.request_json.call_args.kwargs["payload"]["download_pdf"])

    def test_text_success_does_not_become_download_success(self):
        self.client.request_json.return_value["pdf_download"] = {
            "success": False, "reason": "no_article_pdf_link", "errors": [],
        }
        result, raw = self.client.download_pdf("https://doi.org/10.1/x")
        self.assertFalse(result["success"])
        self.assertEqual(result["reason"], "no_article_pdf_link")
        self.assertIsNone(raw)

    def test_older_browser_reports_unavailable_pdf_download(self):
        del self.client.request_json.return_value["pdf_download"]
        result, raw = self.client.download_pdf("https://doi.org/10.1/x")
        self.assertEqual(result["reason"], "pdf_download_unavailable")
        self.assertIsNone(raw)

    def test_malformed_or_mismatched_pdf_is_rejected(self):
        variants = [
            {"data_base64": "%%%"}, {"data_base64": "\u4e2d"},
            {"bytes": len(self.raw) + 1}, {"bytes": True},
            {"pages": 0}, {"pages": True},
            {"data_base64": base64.b64encode(b"<html>challenge</html>").decode(), "bytes": 22},
        ]
        for changes in variants:
            with self.subTest(changes=changes):
                self.client.request_json.return_value["pdf_download"] = {**self.pdf, **changes}
                with self.assertRaises(LiteratureBrowserClientError):
                    self.client.download_pdf("https://doi.org/10.1/x")

    def test_oversized_encoding_is_rejected_before_decoding(self):
        with patch("scientist_literature_mcp.browser_client.MAX_PDF_BYTES", 4), \
             patch("scientist_literature_mcp.browser_client.base64.b64decode") as decode:
            with self.assertRaises(LiteratureBrowserClientError):
                self.client.download_pdf("https://doi.org/10.1/x")
            decode.assert_not_called()

    def test_download_uses_configured_publisher_route(self):
        self.client.routes = ({"id": "plos", "base_url": "http://edge:9020",
                               "host_suffixes": ("plos.org",)},)
        self.client.download_pdf("https://doi.org/10.1/x", landing_url_hint="https://journals.plos.org/article")
        self.assertEqual(self.client.request_json.call_args.kwargs["base_url"], "http://edge:9020")

    def test_shared_read_path_keeps_pdf_payload_private(self):
        result = self.client.read("https://doi.org/10.1/x")
        self.assertEqual(result["text"], "article")
        self.assertNotIn("pdf_download", result)
        self.assertNotIn("download_pdf", self.client.request_json.call_args.kwargs["payload"])


if __name__ == "__main__":
    unittest.main()
