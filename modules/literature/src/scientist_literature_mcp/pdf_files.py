from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path, PurePath, PurePosixPath, PureWindowsPath
import uuid


def _absolute_directory(value: str | None, name: str) -> Path:
    if not value or "\x00" in value:
        raise ValueError(f"{name} must be an absolute directory path")
    directory = Path(value)
    if not directory.is_absolute():
        raise ValueError(f"{name} must be an absolute directory path")
    return directory


def _absolute_host_directory(value: str) -> PurePath:
    if value and "\x00" not in value:
        windows_directory = PureWindowsPath(value)
        if windows_directory.is_absolute():
            return windows_directory
        posix_directory = PurePosixPath(value)
        if not windows_directory.drive and posix_directory.is_absolute():
            return posix_directory
    raise ValueError("LITERATURE_DOWNLOAD_HOST_DIR must be an absolute directory path")


@dataclass(frozen=True)
class PdfFileStore:
    directory: Path
    host_directory: PurePath

    @classmethod
    def from_environment(cls) -> PdfFileStore:
        directory = _absolute_directory(
            os.environ.get("LITERATURE_DOWNLOAD_DIR"), "LITERATURE_DOWNLOAD_DIR"
        )
        if not directory.is_dir():
            raise ValueError("LITERATURE_DOWNLOAD_DIR must be an existing directory")
        if not os.access(directory, os.R_OK | os.W_OK | os.X_OK):
            raise PermissionError("LITERATURE_DOWNLOAD_DIR must be readable and writable")
        directory = directory.resolve(strict=True)
        host_directory: PurePath = directory
        if "LITERATURE_DOWNLOAD_HOST_DIR" in os.environ:
            host_directory = _absolute_host_directory(
                os.environ["LITERATURE_DOWNLOAD_HOST_DIR"]
            )
        return cls(directory=directory, host_directory=host_directory)

    def save(self, raw: bytes) -> dict[str, str | int]:
        if not isinstance(raw, bytes) or not raw.startswith(b"%PDF-"):
            raise ValueError("PDF data must be nonempty bytes beginning with %PDF-")
        filename = f"{uuid.uuid4()}.pdf"
        destination = self.directory / filename
        stream = destination.open("xb")
        try:
            with stream:
                if stream.write(raw) != len(raw):
                    raise OSError("Incomplete PDF file write")
        except BaseException:
            destination.unlink(missing_ok=True)
            raise
        return {
            "path": str(self.host_directory / filename),
            "filename": filename,
            "bytes": len(raw),
        }
