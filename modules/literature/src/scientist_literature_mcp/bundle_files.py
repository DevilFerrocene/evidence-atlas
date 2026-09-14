from __future__ import annotations

import base64
import re
import uuid
import zipfile
from typing import Any

from .pdf_files import PdfFileStore


def download_bundle(client: Any, output: PdfFileStore, url: str, *,
                    include_pdf: bool, all_figures: bool,
                    figure_indices: list[int] | None, archive: bool,
                    wait_ms: int, timeout_seconds: int) -> dict[str, Any]:
    indices = list(dict.fromkeys(figure_indices or []))
    if all_figures and indices:
        raise ValueError("Choose all_figures or figure_indices, not both")
    if any(type(i) is not int or not 0 <= i <= 1000 for i in indices):
        raise ValueError("figure_indices must contain zero-based indices from 0 to 1000")
    if not include_pdf and not all_figures and not indices:
        raise ValueError("Select a PDF or figures to download")
    figures: dict[int, dict[str, Any]] = {}
    if all_figures:
        offset = 0
        while True:
            result = client.read(url, wait_ms=wait_ms, max_chars=1000,
                                 max_figures=30, figure_offset=offset,
                                 timeout_seconds=timeout_seconds)
            if not result.get("success"):
                raise ValueError("Article figure listing failed")
            for item in result.get("figures") or []:
                index = int(item["index"])
                figures[index] = item
            page = result.get("figure_extraction") or {}
            if not page.get("has_more"):
                break
            offset += int(page.get("returned") or 0)
            if not page.get("returned") or offset > 1000:
                raise ValueError("Figure listing exceeded its bounded range")
        indices = list(figures)
    name = f"article-{uuid.uuid4()}"
    directory = output.directory / name
    directory.mkdir()
    files: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []

    def save(filename: str, raw: bytes, metadata: dict[str, Any]) -> None:
        with (directory / filename).open("xb") as stream:
            if stream.write(raw) != len(raw):
                raise OSError("Incomplete file write")
        files.append({"filename": filename, "path": str(output.host_directory / name / filename),
                      "bytes": len(raw), **metadata})

    if include_pdf:
        try:
            result, raw = client.download_pdf(url, wait_ms=wait_ms, timeout_seconds=timeout_seconds)
            if raw is None:
                failures.append({"file": "article.pdf", "reason": result.get("reason", "unavailable")})
            else:
                save("article.pdf", raw, {k: result[k] for k in
                     ("source_url", "pages", "version", "repository", "doi") if k in result})
        except Exception as exc:
            failures.append({"file": "article.pdf", "reason": type(exc).__name__})
    for index in indices:
        try:
            result = client.read(url, wait_ms=wait_ms, max_chars=1000,
                                 include_figure_images=True, max_figures=1,
                                 figure_offset=index, timeout_seconds=timeout_seconds)
            items = result.get("figures") or []
            item = next((f for f in items if int(f.get("index", -1)) == index), {})
            if not item.get("image_base64"):
                failures.append({"figure_index": index, "reason": item.get("image_access_state") or "image_unavailable",
                                 "detail": item.get("image_error") or "No image bytes returned"})
                continue
            mime = item.get("mime_type")
            extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg"}.get(mime)
            if not extension:
                raise ValueError("Unsupported image type")
            raw = base64.b64decode(item["image_base64"], validate=True)
            if not raw or len(raw) > 24 * 1024 * 1024:
                raise ValueError("Invalid image size")
            match = next((matched for value in (item.get("caption"), item.get("alt"))
                          if (matched := re.match(r"^\s*(figure|fig\.|scheme|chart)\s*(\d+)",
                                                 str(value or ""), re.I))), None)
            label = (match.group(1).lower().replace("fig.", "figure") + "-" + match.group(2)) if match else "image"
            save(f"{label}-index-{index}.{extension}", raw,
                 {"figure_index": index, "caption": item.get("caption", ""), "source_url": item.get("src", ""),
                  **{key: item[key] for key in ("image_extraction_method", "image_integrity", "image_width", "image_height") if key in item}})
        except Exception as exc:
            failures.append({"figure_index": index, "reason": type(exc).__name__})
    if all_figures and not indices:
        failures.append({"file": "figures", "reason": "no_figures_found"})
    result = {"success": bool(files) and not failures, "partial": bool(files) and bool(failures),
              "directory": str(output.host_directory / name), "files": files, "failures": failures}
    if archive and files:
        archive_name = name + ".zip"
        with zipfile.ZipFile(output.directory / archive_name, "x", zipfile.ZIP_DEFLATED) as package:
            for item in files:
                package.write(directory / item["filename"], item["filename"])
        result["archive_path"] = str(output.host_directory / archive_name)
        result["archive_bytes"] = (output.directory / archive_name).stat().st_size
    return result
