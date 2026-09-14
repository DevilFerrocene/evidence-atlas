from __future__ import annotations

from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import re
from urllib.parse import urlsplit, urlunsplit


def public_url(value: object) -> str:
    try:
        p = urlsplit(str(value or ""))
        return urlunsplit((p.scheme, p.hostname or "", p.path, "", ""))
    except ValueError:
        return "[invalid URL]"


def safe_error(value: object, limit: int = 8000) -> str:
    text = str(value)
    text = re.sub(r'https?://[^\s<>"\']+', lambda m: public_url(m.group()), text)
    text = re.sub(r'(?im)\b(?:set-cookie|cookie|authorization|proxy-authorization)\s*[:=][^\r\n]+', '[redacted header]', text)
    text = re.sub(r'(?i)(["\']?(?:[\w-]*(?:token|secret|password|signature|credential)[\w-]*|api[_-]?key)["\']?\s*[:=]\s*)("[^"]*"|\'[^\']*\'|[^\s,;}]+)', r'\1[redacted]', text)
    return text[:limit]


def log_directory() -> Path:
    configured = os.environ.get("LITERATURE_REQUEST_LOG_DIR")
    if configured:
        directory = Path(configured)
    elif os.environ.get("LITERATURE_HEALTH_REPORT"):
        directory = Path(os.environ["LITERATURE_HEALTH_REPORT"]).parent / "requests"
    else:
        directory = Path.home() / ".local" / "state" / "scientist-literature" / "requests"
    if not directory.is_absolute():
        raise ValueError("LITERATURE_REQUEST_LOG_DIR must be absolute")
    return directory


def log_location() -> str:
    return str(Path(os.environ.get("LITERATURE_REQUEST_LOG_HOST_DIR") or log_directory()) / "requests.jsonl")


def append_event(event: dict) -> None:
    directory = log_directory()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    destination = directory / "requests.jsonl"
    payload = (json.dumps({"timestamp": datetime.now(timezone.utc).isoformat(), **event}, ensure_ascii=False) + "\n").encode()
    with (directory / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if destination.exists() and destination.stat().st_size + len(payload) > 10 * 1024 * 1024:
            for index in (3, 2, 1):
                previous = directory / ("requests.jsonl" if index == 1 else f"requests.jsonl.{index - 1}")
                if previous.exists():
                    os.replace(previous, directory / f"requests.jsonl.{index}")
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        try:
            if os.write(fd, payload) != len(payload):
                raise OSError("Incomplete request log write")
        finally:
            os.close(fd)


def outcome_details(value: dict) -> dict:
    result = {key: value[key] for key in ("success", "status", "page_state", "access_state", "text_source", "full_text_dom_visible") if key in value}
    if value.get("message"):
        result["message"] = safe_error(value["message"])
    result["final_url"] = public_url(value.get("final_url"))
    for field in ("pdf_download", "pdf_extraction", "html_extraction", "challenge_bypass", "navigation_recovery"):
        source = value.get(field)
        if not isinstance(source, dict):
            continue
        result[field] = {key: safe_error(source[key]) if isinstance(source[key], str) else source[key]
                         for key in ("success", "attempted", "status", "reason", "message", "strategy", "selector", "open_version_reason", "playwright_verified")
                         if key in source and isinstance(source[key], (str, int, float, bool, type(None)))}
        if isinstance(source.get("errors"), list):
            result[field]["errors"] = [safe_error(item) for item in source["errors"][:30]]
        if isinstance(source.get("attempts"), list):
            result[field]["attempts"] = [
                {key: safe_error(item[key]) if isinstance(item[key], str) else item[key]
                 for key in ("source_host", "source_path", "strategy", "status", "content_type", "bytes", "error_type", "message", "accepted", "pages", "text_chars")
                 if key in item and isinstance(item[key], (str, int, bool, type(None)))}
                for item in source["attempts"][:30] if isinstance(item, dict)
            ]
    result["figures"] = [{key: safe_error(item[key]) if isinstance(item[key], str) else item[key]
                           for key in ("index", "image_access_state", "image_error", "image_integrity", "image_extraction_method", "image_width", "image_height", "image_bytes")
                           if key in item and isinstance(item[key], (str, int, bool, type(None)))}
                          for item in (value.get("figures") or [])[:30] if isinstance(item, dict)] if isinstance(value.get("figures", []), list) else []
    return result
