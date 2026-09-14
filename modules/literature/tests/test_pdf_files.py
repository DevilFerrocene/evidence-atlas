import os
from pathlib import Path, PureWindowsPath
import tempfile
import unittest
from unittest.mock import patch
import uuid

from scientist_literature_mcp.pdf_files import PdfFileStore


class PdfFileStoreChecks(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.directory = Path(self.temporary_directory.name).resolve()
        self.environment = patch.dict(
            os.environ, {"LITERATURE_DOWNLOAD_DIR": str(self.directory)}, clear=True
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.raw = b"%PDF-1.7\nexample\n%%EOF\n"

    def test_saves_unique_pdf_files_with_direct_execution_paths(self):
        store = PdfFileStore.from_environment()
        first = store.save(self.raw)
        second = store.save(self.raw)
        self.assertNotEqual(first["filename"], second["filename"])
        for result in (first, second):
            filename = result["filename"]
            self.assertEqual(Path(filename).suffix, ".pdf")
            uuid.UUID(Path(filename).stem)
            self.assertEqual(Path(result["path"]), self.directory / filename)
            self.assertEqual(result["bytes"], len(self.raw))
            self.assertEqual(Path(result["path"]).read_bytes(), self.raw)

    def test_host_mapping_returns_host_path_and_writes_actual_directory(self):
        host_directory = self.directory / "host mapping not mounted here"
        os.environ["LITERATURE_DOWNLOAD_HOST_DIR"] = str(host_directory)
        result = PdfFileStore.from_environment().save(self.raw)
        self.assertEqual(Path(result["path"]), host_directory / result["filename"])
        self.assertEqual((self.directory / result["filename"]).read_bytes(), self.raw)
        self.assertFalse(host_directory.exists())

    def test_windows_host_mapping_accepts_both_separator_styles(self):
        for value in (r"C:\Users\Research Downloads", "C:/Users/Research Downloads"):
            with self.subTest(value=value):
                os.environ["LITERATURE_DOWNLOAD_HOST_DIR"] = value
                store = PdfFileStore.from_environment()
                result = store.save(self.raw)
                self.assertIsInstance(store.host_directory, PureWindowsPath)
                self.assertEqual(
                    result["path"], str(PureWindowsPath(value) / result["filename"])
                )
                self.assertEqual(
                    (self.directory / result["filename"]).read_bytes(), self.raw
                )

    def test_required_directory_missing_or_malformed_is_rejected(self):
        for value in (None, "", "relative", "~/Downloads"):
            with self.subTest(value=value):
                if value is None:
                    os.environ.pop("LITERATURE_DOWNLOAD_DIR", None)
                else:
                    os.environ["LITERATURE_DOWNLOAD_DIR"] = value
                with self.assertRaisesRegex(ValueError, "LITERATURE_DOWNLOAD_DIR"):
                    PdfFileStore.from_environment()

    def test_missing_directory_is_rejected_without_creation(self):
        missing = self.directory / "missing"
        os.environ["LITERATURE_DOWNLOAD_DIR"] = str(missing)
        with self.assertRaisesRegex(ValueError, "existing directory"):
            PdfFileStore.from_environment()
        self.assertFalse(missing.exists())

    def test_regular_file_cannot_be_the_download_directory(self):
        file = self.directory / "file"
        file.write_text("existing")
        os.environ["LITERATURE_DOWNLOAD_DIR"] = str(file)
        with self.assertRaisesRegex(ValueError, "existing directory"):
            PdfFileStore.from_environment()
        self.assertEqual(file.read_text(), "existing")

    def test_directory_access_is_checked_during_configuration(self):
        with patch("scientist_literature_mcp.pdf_files.os.access", return_value=False) as access:
            with self.assertRaisesRegex(PermissionError, "readable and writable"):
                PdfFileStore.from_environment()
        access.assert_called_once_with(self.directory, os.R_OK | os.W_OK | os.X_OK)
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_optional_host_mapping_must_be_absolute_when_present(self):
        for value in ("", "relative", "~/Downloads", "C:relative", r"\Downloads"):
            with self.subTest(value=value):
                os.environ["LITERATURE_DOWNLOAD_HOST_DIR"] = value
                with self.assertRaisesRegex(ValueError, "LITERATURE_DOWNLOAD_HOST_DIR"):
                    PdfFileStore.from_environment()

    def test_invalid_pdf_bytes_do_not_create_a_file(self):
        store = PdfFileStore.from_environment()
        for raw in (b"", b"<html>login</html>", b"leading%PDF-1.7", "pdf", None):
            with self.subTest(raw=raw):
                with self.assertRaisesRegex(ValueError, "PDF data"):
                    store.save(raw)
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_existing_uuid_filename_is_preserved(self):
        identifier = uuid.uuid4()
        existing = self.directory / f"{identifier}.pdf"
        existing.write_bytes(b"previous document")
        store = PdfFileStore.from_environment()
        with patch("scientist_literature_mcp.pdf_files.uuid.uuid4", return_value=identifier):
            with self.assertRaises(FileExistsError):
                store.save(self.raw)
        self.assertEqual(existing.read_bytes(), b"previous document")
        self.assertEqual(list(self.directory.iterdir()), [existing])

    def test_failed_partial_write_removes_only_its_own_file(self):
        existing = self.directory / "existing.pdf"
        existing.write_bytes(b"previous document")
        original_open = Path.open

        class FailingWriter:
            def __init__(self, stream):
                self.stream = stream

            def __enter__(self):
                return self

            def __exit__(self, *args):
                self.stream.close()

            def write(self, raw):
                self.stream.write(raw[:6])
                raise OSError("disk full")

        def failing_open(path, *args, **kwargs):
            return FailingWriter(original_open(path, *args, **kwargs))

        store = PdfFileStore.from_environment()
        with patch.object(Path, "open", new=failing_open):
            with self.assertRaisesRegex(OSError, "disk full"):
                store.save(self.raw)
        self.assertEqual(list(self.directory.iterdir()), [existing])
        self.assertEqual(existing.read_bytes(), b"previous document")


if __name__ == "__main__":
    unittest.main()
