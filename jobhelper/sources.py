"""Load job postings (URL, file or text) and resumes (.txt/.md/.pdf/.csv)."""

from __future__ import annotations

import csv
import re
from pathlib import Path

import requests

MAX_CHARS = 15000  # keep prompts well inside small-model context windows

_UA = "Mozilla/5.0 (compatible; JobApplyHelper/2.0)"


def _clean(text: str) -> str:
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()[:MAX_CHARS]


def html_to_text(html: str) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "header", "form"]):
        tag.decompose()
    return _clean(soup.get_text("\n"))


def fetch_job_posting(url: str, timeout: int = 30) -> str:
    """Fetch a job page as text. Falls back to the r.jina.ai reader for JS-heavy pages."""
    text = ""
    try:
        resp = requests.get(url, headers={"User-Agent": _UA}, timeout=timeout)
        resp.raise_for_status()
        text = html_to_text(resp.text)
    except requests.RequestException:
        pass
    if len(text) < 500:  # likely a client-rendered page; try the reader service
        try:
            resp = requests.get(f"https://r.jina.ai/{url}", headers={"User-Agent": _UA}, timeout=timeout)
            resp.raise_for_status()
            text = _clean(resp.text) or text
        except requests.RequestException:
            pass
    if not text:
        raise RuntimeError(f"Could not read {url}. Save the posting to a text file and use --job-file.")
    return text


def load_job(job: str | None = None, job_file: str | None = None) -> str:
    if job_file:
        return _clean(Path(job_file).read_text(encoding="utf-8"))
    if not job:
        raise ValueError("Provide a job URL/text or --job-file.")
    if re.match(r"^https?://", job.strip()):
        return fetch_job_posting(job.strip())
    return _clean(job)


def load_resume(path: str) -> str:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Resume not found: {path}")
    suffix = p.suffix.lower()
    if suffix == ".pdf":
        from pypdf import PdfReader

        text = "\n".join(page.extract_text() or "" for page in PdfReader(str(p)).pages)
    elif suffix == ".csv":  # legacy profile.csv format: Field,Value
        with p.open(newline="", encoding="utf-8") as f:
            text = "\n".join(f"{row['Field']}: {row['Value']}" for row in csv.DictReader(f))
    else:
        text = p.read_text(encoding="utf-8")
    text = _clean(text)
    if not text:
        raise ValueError(f"No text could be extracted from {path}.")
    return text
