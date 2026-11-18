"""High-level application helpers. Each takes an LLM callable, resume text and job text."""

from __future__ import annotations

from .llm import LLM, parse_json
from .prompts import load_prompts, render


def _run(llm: LLM, task: str, resume: str, job: str, extra: str = "") -> str:
    system, user = render(task, resume, job, extra)
    return llm(system, user)


def match_report(llm: LLM, resume: str, job: str) -> dict:
    report = parse_json(_run(llm, "match", resume, job))
    if not isinstance(report, dict):
        raise ValueError("Unexpected match report format.")
    try:
        report["score"] = max(0, min(100, int(report.get("score", 0))))
    except (TypeError, ValueError):
        report["score"] = 0
    for key in ("matched_skills", "missing_skills", "keywords_to_add", "strengths", "gaps"):
        value = report.get(key) or []
        report[key] = [str(v) for v in value] if isinstance(value, list) else [str(value)]
    return report


def cover_letter(llm: LLM, resume: str, job: str, style: str = "professional") -> str:
    styles = load_prompts()["letter_styles"]
    if style not in styles:
        raise KeyError(f"Unknown style '{style}'. Choose one of: {', '.join(styles)}")
    return _run(llm, "letter", resume, job, styles[style])


def resume_tweaks(llm: LLM, resume: str, job: str) -> str:
    return _run(llm, "tailor", resume, job)


def outreach(llm: LLM, resume: str, job: str, contact: str = "") -> str:
    extra = f"The recipient is: {contact}." if contact else ""
    return _run(llm, "outreach", resume, job, extra)


def interview_prep(llm: LLM, resume: str, job: str) -> str:
    return _run(llm, "interview", resume, job)


def answer_question(llm: LLM, resume: str, job: str, question: str) -> str:
    if not question.strip():
        raise ValueError("Question must not be empty.")
    return _run(llm, "answer", resume, job, question.strip())


def format_match_report(r: dict) -> str:
    bar = "#" * (r["score"] // 5) + "-" * (20 - r["score"] // 5)
    title = " at ".join(x for x in (r.get("role"), r.get("company")) if x)
    lines = [f"Match: {r['score']}/100  [{bar}]  {title}".rstrip(), r.get("verdict", ""), ""]
    sections = [
        ("Matched", "matched_skills"),
        ("Missing", "missing_skills"),
        ("Keywords to add", "keywords_to_add"),
        ("Lead with", "strengths"),
        ("Gaps", "gaps"),
    ]
    for label, key in sections:
        if r.get(key):
            lines.append(f"{label}:")
            lines += [f"  - {item}" for item in r[key]]
    if r.get("advice"):
        lines += ["", f"Advice: {r['advice']}"]
    return "\n".join(lines)
