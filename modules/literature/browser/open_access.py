from __future__ import annotations

import base64
from collections import OrderedDict
import io
import ipaddress
import json
import math
import re
import threading
import time
from typing import Any, Callable
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


_METADATA_BYTES = 2 * 1024 * 1024
_METADATA_SECONDS = 8.0
_CACHE_SECONDS = 24 * 60 * 60
_ARXIV_LOCK = threading.Lock()
_ARXIV_LAST_REQUEST = 0.0
_ARXIV_CACHE: OrderedDict[str, tuple[float, list[dict[str, Any]], str]] = OrderedDict()
_VERSIONS = {"submittedVersion", "acceptedVersion", "publishedVersion"}
_USER_AGENT = "ScientistLiteratureBrowser/0.9 (public open-access lookup)"


class _OpenAccessError(Exception):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _doi_text(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("doi must be a string")
    value = urllib.parse.unquote(value.strip())
    value = re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", "", value, flags=re.I)
    if len(value) > 512 or not re.fullmatch(r"10\.\d{4,9}/[^\s<>\"\x00-\x1f\x7f]+", value):
        raise ValueError("invalid DOI")
    return value


def normalize_doi(value: str) -> str:
    return _doi_text(value).lower()


def _same_doi(value: Any, doi: str) -> bool:
    try:
        return normalize_doi(value) == doi
    except ValueError:
        return False


def _safe_url(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username is not None or parsed.password is not None:
            return ""
        query = urllib.parse.urlencode([
            (key, item) for key, item in urllib.parse.parse_qsl(parsed.query)
            if key.lower() in {"id", "doi", "type", "version"}
        ])
        return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, ""))
    except ValueError:
        return ""


def _remaining(deadline: float) -> float:
    left = deadline - time.monotonic()
    if left <= 0:
        raise _OpenAccessError("time_budget_exhausted")
    return left


def _checked_url(url: str, allowed_url: Callable[[str], bool],
                 pdf_url_allowed: Callable[[str], bool] | None = None) -> str:
    try:
        parsed = urllib.parse.urlsplit(url)
        host = parsed.hostname or ""
        if (parsed.scheme != "https" or not host or parsed.username is not None
                or parsed.password is not None or parsed.port not in (None, 443)
                or any(char.isspace() or ord(char) < 32 for char in url)
                or "\\" in url or host.endswith(".") or "." not in host
                or host.endswith((".local", ".localhost", ".internal"))):
            raise _OpenAccessError("unsafe_url")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            raise _OpenAccessError("unsafe_url")
        if not allowed_url(url) or (pdf_url_allowed is not None and not pdf_url_allowed(url)):
            raise _OpenAccessError("url_not_allowed")
        return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))
    except _OpenAccessError:
        raise
    except (ValueError, TypeError, OSError):
        raise _OpenAccessError("invalid_url") from None


def _request_bytes(url: str, *, deadline: float, max_bytes: int,
                   allowed_url: Callable[[str], bool],
                   pdf_url_allowed: Callable[[str], bool] | None = None) -> tuple[bytes, str]:
    opener = urllib.request.build_opener(_NoRedirect())
    for hop in range(6):
        _remaining(deadline)
        url = _checked_url(url, allowed_url, pdf_url_allowed)
        if pdf_url_allowed is not None and _supplement(url):
            raise _OpenAccessError("supplementary_pdf")
        request = urllib.request.Request(url, headers={
            "User-Agent": _USER_AGENT,
            "Accept": "application/pdf" if pdf_url_allowed is not None else "application/json, application/atom+xml",
            "Accept-Encoding": "identity",
        })
        try:
            response = opener.open(request, timeout=min(5.0, _remaining(deadline)))
        except urllib.error.HTTPError as exc:
            status = exc.code
            location = exc.headers.get("Location")
            exc.close()
            if status in (301, 302, 303, 307, 308) and location:
                if hop == 5:
                    raise _OpenAccessError("too_many_redirects") from None
                url = urllib.parse.urljoin(url, location)
                continue
            raise _OpenAccessError("not_found" if status == 404 else f"http_{status}") from None
        except (urllib.error.URLError, OSError, TimeoutError):
            if deadline <= time.monotonic():
                raise _OpenAccessError("time_budget_exhausted") from None
            raise _OpenAccessError("network_error") from None
        with response:
            try:
                declared_size = int(response.headers.get("Content-Length", "0"))
            except ValueError:
                declared_size = 0
            if declared_size > max_bytes:
                raise _OpenAccessError("size_limit_exceeded")
            chunks: list[bytes] = []
            length = 0
            while True:
                left = _remaining(deadline)
                try:
                    response.fp.raw._sock.settimeout(min(5.0, left))
                except AttributeError:
                    pass
                try:
                    read = getattr(response, "read1", response.read)
                    chunk = read(min(65536, max_bytes + 1 - length))
                except (OSError, TimeoutError):
                    if deadline <= time.monotonic():
                        raise _OpenAccessError("time_budget_exhausted") from None
                    raise _OpenAccessError("network_error") from None
                if not chunk:
                    break
                length += len(chunk)
                if length > max_bytes:
                    raise _OpenAccessError("size_limit_exceeded")
                chunks.append(chunk)
            _remaining(deadline)
            return b"".join(chunks), url
    raise _OpenAccessError("too_many_redirects")


def _supplement(url: str, label: str = "") -> bool:
    value = urllib.parse.unquote(url + " " + label).lower()
    return bool(re.search(r"supplement|supporting[ _-]?information|(?:[/_.?&=-])(?:suppl|supp|esm|mmc|s\d+)(?:[/_.?&=-]|$)", value))


def _openalex_candidates(payload: bytes, doi: str) -> tuple[list[dict[str, Any]], str]:
    try:
        work = json.loads(payload)
    except (ValueError, UnicodeDecodeError):
        raise _OpenAccessError("invalid_metadata") from None
    if not isinstance(work, dict) or not _same_doi(work.get("doi"), doi):
        return [], "doi_mismatch"
    title = str(work.get("display_name") or "")[:1000]
    locations = work.get("locations")
    if not isinstance(locations, list):
        return [], "no_direct_pdf"
    candidates = []
    for location in locations[:100]:
        if not isinstance(location, dict) or location.get("is_oa") is not True:
            continue
        pdf_url = location.get("pdf_url")
        if not isinstance(pdf_url, str) or not pdf_url or _supplement(pdf_url):
            continue
        source = location.get("source") or {}
        if not isinstance(source, dict):
            source = {}
        version = location.get("version")
        version = version if version in _VERSIONS else "unknown"
        source_type = source.get("type")
        source_kind = "unknown"
        if source_type == "repository":
            source_kind = "open_repository"
        elif source_type in {"journal", "conference", "ebook platform", "book series"}:
            source_kind = "open_access_publisher"
        candidates.append({
            "url": pdf_url, "provider": "openalex", "doi": doi,
            "source_kind": source_kind,
            "version": version, "repository": str(source.get("display_name") or "")[:300],
            "record_url": str(location.get("landing_page_url") or ""),
            "identity_match": "exact_doi", "title": title,
        })
    candidates.sort(key=lambda item: item["source_kind"] != "open_repository")
    return candidates, "ok" if candidates else "no_direct_pdf"


def _arxiv_candidates(payload: bytes, doi: str) -> tuple[list[dict[str, Any]], str]:
    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        raise _OpenAccessError("invalid_metadata") from None
    atom = "{http://www.w3.org/2005/Atom}"
    arxiv = "{http://arxiv.org/schemas/atom}"
    candidates = []
    for entry in root.findall(atom + "entry")[:5]:
        if not _same_doi(entry.findtext(arxiv + "doi"), doi):
            continue
        record = entry.findtext(atom + "id") or ""
        parsed = urllib.parse.urlsplit(record)
        if parsed.hostname not in {"arxiv.org", "export.arxiv.org"} or not parsed.path.startswith("/abs/"):
            continue
        identifier = parsed.path[len("/abs/"):]
        if not re.fullmatch(r"(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*/\d{7})v\d+", identifier):
            continue
        pdf_url = "https://arxiv.org/pdf/" + identifier
        candidates.append({
            "url": pdf_url, "provider": "arxiv", "doi": doi,
            "source_kind": "open_repository", "version": "submittedVersion",
            "repository": "arXiv", "record_url": "https://arxiv.org/abs/" + identifier,
            "identity_match": "exact_doi",
            "title": " ".join((entry.findtext(atom + "title") or "").split())[:1000],
        })
    return candidates, "ok" if candidates else "no_exact_doi_match"


def _query_arxiv(doi: str, deadline: float, allowed_url: Callable[[str], bool],
                 search_doi: str | None = None) -> tuple[list[dict[str, Any]], str]:
    global _ARXIV_LAST_REQUEST
    forms = dict.fromkeys((search_doi or doi, doi, doi.upper()))
    query = " OR ".join('all:"' + form + '"' for form in forms)
    if not _ARXIV_LOCK.acquire(timeout=_remaining(deadline)):
        raise _OpenAccessError("time_budget_exhausted")
    try:
        cached = _ARXIV_CACHE.get(query)
        now = time.monotonic()
        if cached and now - cached[0] < _CACHE_SECONDS:
            _ARXIV_CACHE.move_to_end(query)
            return [dict(item) for item in cached[1]], cached[2]
        delay = max(0.0, 3.0 - (now - _ARXIV_LAST_REQUEST))
        if delay:
            if delay >= _remaining(deadline):
                raise _OpenAccessError("time_budget_exhausted")
            time.sleep(delay)
        url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode({
            "search_query": query, "start": 0, "max_results": 5,
        })
        _ARXIV_LAST_REQUEST = time.monotonic()
        payload, _ = _request_bytes(url, deadline=min(deadline, time.monotonic() + _METADATA_SECONDS),
                                    max_bytes=_METADATA_BYTES, allowed_url=allowed_url)
        candidates, status = _arxiv_candidates(payload, doi)
        _ARXIV_CACHE[query] = (time.monotonic(), candidates, status)
        _ARXIV_CACHE.move_to_end(query)
        while len(_ARXIV_CACHE) > 128:
            _ARXIV_CACHE.popitem(last=False)
        return [dict(item) for item in candidates], status
    finally:
        _ARXIV_LOCK.release()


def _pdf_pages(payload: bytes) -> int:
    if not payload.startswith(b"%PDF-"):
        raise _OpenAccessError("not_a_pdf")
    try:
        from pypdf import PdfReader
    except ImportError:
        raise _OpenAccessError("pdf_validation_unavailable") from None
    try:
        reader = PdfReader(io.BytesIO(payload), strict=True)
        if reader.is_encrypted:
            raise _OpenAccessError("encrypted_pdf")
        pages = len(reader.pages)
    except _OpenAccessError:
        raise
    except Exception:
        raise _OpenAccessError("invalid_pdf") from None
    if pages <= 0:
        raise _OpenAccessError("empty_pdf")
    return pages


def find_open_pdf(doi: str, *, deadline: float, max_bytes: int,
                  allowed_url: Callable[[str], bool],
                  pdf_url_allowed: Callable[[str], bool] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
    search_doi = _doi_text(doi)
    doi = search_doi.lower()
    if not isinstance(deadline, (int, float)) or not math.isfinite(deadline):
        raise ValueError("deadline must be a finite monotonic timestamp")
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes <= 0:
        raise ValueError("max_bytes must be a positive integer")
    if not callable(allowed_url) or (pdf_url_allowed is not None and not callable(pdf_url_allowed)):
        raise ValueError("URL policies must be callable")
    pdf_url_allowed = pdf_url_allowed or allowed_url
    summary: dict[str, Any] = {"attempted": True, "doi": doi, "providers": [],
                               "candidates": 0, "download_attempts": 0, "errors": []}
    seen: set[str] = set()
    for provider in ("openalex", "arxiv"):
        if time.monotonic() >= deadline or summary["download_attempts"] >= 3:
            break
        try:
            if provider == "openalex":
                url = "https://api.openalex.org/works/https://doi.org/" + urllib.parse.quote(doi, safe="/")
                payload, _ = _request_bytes(url, deadline=min(deadline, time.monotonic() + _METADATA_SECONDS),
                                            max_bytes=_METADATA_BYTES, allowed_url=allowed_url)
                found, status = _openalex_candidates(payload, doi)
            else:
                found, status = _query_arxiv(doi, deadline, allowed_url, search_doi)
            summary["providers"].append({"provider": provider, "status": status, "candidates": len(found)})
        except _OpenAccessError as exc:
            summary["providers"].append({"provider": provider, "status": "error", "reason": str(exc)})
            continue
        except Exception:
            summary["providers"].append({"provider": provider, "status": "error", "reason": "invalid_metadata"})
            continue
        unique: list[dict[str, Any]] = []
        for candidate in found:
            if candidate["url"] not in seen and not _supplement(candidate["url"]):
                seen.add(candidate["url"])
                unique.append(candidate)
        summary["candidates"] += len(unique)
        for candidate in unique:
            if time.monotonic() >= deadline or summary["download_attempts"] >= 3:
                break
            try:
                if not allowed_url(candidate["url"]) or not pdf_url_allowed(candidate["url"]):
                    raise _OpenAccessError("url_not_allowed")
                summary["download_attempts"] += 1
                payload, final_url = _request_bytes(candidate["url"], deadline=deadline, max_bytes=max_bytes,
                                                    allowed_url=allowed_url, pdf_url_allowed=pdf_url_allowed)
                if _supplement(final_url):
                    raise _OpenAccessError("supplementary_pdf")
                pages = _pdf_pages(payload)
                _remaining(deadline)
                result = {key: value for key, value in candidate.items() if key not in {"url", "provider"}}
                result.update({"success": True, "source_url": _safe_url(final_url), "bytes": len(payload),
                               "pages": pages, "data_base64": base64.b64encode(payload).decode("ascii"),
                               "record_url": _safe_url(candidate["record_url"])})
                summary["reason"] = "found"
                return result, summary
            except _OpenAccessError as exc:
                summary["errors"].append({"provider": candidate["provider"], "reason": str(exc)})
            except Exception:
                summary["errors"].append({"provider": candidate["provider"], "reason": "pdf_fetch_failed"})
    reason = "time_budget_exhausted" if time.monotonic() >= deadline else "no_verified_open_pdf"
    summary["reason"] = reason
    return {"success": False, "reason": reason}, summary
