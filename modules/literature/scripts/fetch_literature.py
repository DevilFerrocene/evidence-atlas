#!/usr/bin/env python3
"""Fetch DOI/URL inputs through the local literature service, sequentially."""
from __future__ import annotations

import argparse
import base64
import json
from pathlib import Path
import re
import time
import urllib.error
import urllib.parse
import urllib.request


def wait_until_idle(base_url: str, timeout: float = 30) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(base_url.rstrip("/") + "/ready", timeout=2) as response:
                status = json.load(response)
            lifecycle = status.get("lifecycle", {})
            if status.get("ready") is True and lifecycle.get("pending_reads") == 0:
                return True
        except (OSError, ValueError, AttributeError):
            pass
        time.sleep(min(1, max(0, deadline - time.monotonic())))
    return False


def request_article(base_url: str, url: str, timeout: int, pdf: bool) -> dict:
    request = urllib.request.Request(
        base_url.rstrip("/") + "/v1/literature/read",
        data=json.dumps({"url": url, "max_chars": 0, "wait_ms": 2000,
                         "timeout_seconds": timeout, "download_pdf": pdf}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout + 30) as response:
            result = json.load(response)
        if not isinstance(result, dict) or not isinstance(result.get("text", ""), str):
            raise ValueError("Invalid service response: expected an object with string text")
        result["http_status"] = 200
        return result
    except urllib.error.HTTPError as exc:
        body = exc.read(8192).decode("utf-8", errors="replace")
        try:
            detail = json.loads(body)
        except ValueError:
            detail = {}
        return {"access_state": "error", "http_status": exc.code,
                "error": str(detail.get("message") or exc.reason) if isinstance(detail, dict) else str(exc.reason),
                "retryable": exc.code in {429, 502, 503, 504},
                "wait_for_idle": exc.code == 429 or exc.code >= 500}
    except (ValueError, OSError) as exc:
        return {"access_state": "error", "error": str(exc), "wait_for_idle": True}


def normalize(value: str) -> str:
    value = value.strip()
    value = re.sub(r"^doi:\s*", "", value, flags=re.I)
    if re.match(r"^10\.\d{4,9}/\S+$", value):
        return "https://doi.org/" + urllib.parse.quote(value, safe="/():;")
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("Expected a DOI or HTTP(S) URL")
    if parsed.username or parsed.password:
        raise ValueError("URLs containing credentials are not accepted")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inputs", nargs="*", help="DOIs or article URLs")
    parser.add_argument("--input-file", type=Path, help="One DOI or URL per line")
    parser.add_argument("--output", required=True, type=Path, help="New output directory")
    parser.add_argument("--base-url", default="http://127.0.0.1:19020")
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--pdf", action="store_true", help="Also save the article PDF, using a verified open version when needed")
    args = parser.parse_args()
    items = list(args.inputs)
    if args.input_file:
        try:
            items.extend(line.strip() for line in args.input_file.read_text(encoding="utf-8-sig").splitlines()
                         if line.strip() and not line.lstrip().startswith("#"))
        except (OSError, UnicodeError) as exc:
            parser.error(str(exc))
    if not items or not 45 <= args.timeout <= 900:
        parser.error("Provide inputs and a timeout between 45 and 900 seconds")
    try:
        args.output.mkdir(parents=True, exist_ok=False)
    except OSError as exc:
        parser.error(str(exc))
    failed = False
    for index, value in enumerate(items, 1):
        start = time.monotonic()
        try:
            url = normalize(value)
            result = request_article(args.base_url, url, args.timeout, args.pdf)
        except (ValueError, OSError, urllib.error.URLError) as exc:
            result = {"access_state": "error", "error": str(exc)}
        text = result.get("text") or ""
        full = bool(text.strip()) and not result.get("text_truncated", False) and result.get("access_state") in {
            "institutional_full_text", "publisher_full_text",
            "open_access_full_text", "full_text_visible"}
        failed |= not full
        stem = args.output / f"{index:04d}"
        pdf_result = result.get("pdf_download") or {"success": False, "reason": "pdf_export_unavailable"}
        if not isinstance(pdf_result, dict):
            pdf_result = {"success": False, "reason": "invalid_pdf_response"}
        pdf_data = pdf_result.pop("data_base64", "")
        if args.pdf and pdf_result.get("success"):
            try:
                raw = base64.b64decode(pdf_data, validate=True)
                if not raw.startswith(b"%PDF-") or len(raw) != pdf_result.get("bytes"):
                    raise ValueError("Invalid PDF payload or byte count")
                stem.with_suffix(".pdf").write_bytes(raw)
            except (ValueError, TypeError, OSError) as exc:
                pdf_result = {"success": False, "reason": str(exc)}
        if args.pdf:
            failed |= not bool(pdf_result.get("success"))
        # Persist only content and access metadata; session state stays in the service.
        record = {key: result[key] for key in (
            "url", "title", "access_state", "page_state", "text_source",
            "text", "text_truncated", "error", "http_status", "retryable",
            "open_access", "publisher_attempt", "text_source_url") if key in result}
        if args.pdf:
            record["pdf_download"] = pdf_result
        record.update(input=value, full_text=full,
                      elapsed_seconds=round(time.monotonic() - start, 2))
        try:
            if text:
                stem.with_suffix(".txt").write_text(text, encoding="utf-8")
            stem.with_suffix(".json").write_text(
                json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError as exc:
            print(json.dumps({"batch_stopped": True, "index": index,
                              "reason": "Output write failed", "error": str(exc)}), flush=True)
            return 1
        print(json.dumps({"index": index, "input": value, "full_text": full,
                          "access_state": result.get("access_state"),
                          "chars": len(text), "seconds": record["elapsed_seconds"],
                          "pdf": pdf_result if args.pdf else None,
                          "result": str(stem.with_suffix(".json"))},
                         ensure_ascii=False), flush=True)
        if result.get("wait_for_idle") and not wait_until_idle(args.base_url):
            print(json.dumps({"batch_stopped": True, "remaining": len(items) - index,
                              "reason": "Service did not become idle; resume remaining inputs after recovery"}), flush=True)
            return 1
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
