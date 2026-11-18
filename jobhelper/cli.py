"""Command-line interface.

Examples:
    jobhelper match  --resume resume.pdf --job "https://careers.example.com/job/123"
    jobhelper letter --resume resume.pdf --job-file posting.txt --style concise --out letter.txt
    jobhelper all    --resume resume.pdf --job "https://..." --out-dir applications/acme
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__, tasks
from .config import PROVIDERS, load_settings
from .llm import make_llm
from .prompts import load_prompts
from .sources import load_job, load_resume

COMMANDS = {
    "match": "Score how well your resume matches the job and list gaps",
    "letter": "Write a tailored cover letter",
    "tailor": "Suggest resume bullet rewrites for this job",
    "outreach": "Write LinkedIn / recruiter / referral messages",
    "interview": "Generate likely interview questions with talking points",
    "answer": "Answer an application-form question",
    "all": "Run match, letter, tailor, outreach and interview; save each to --out-dir",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="jobhelper", description="Job Apply Helper: tailor every application.")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text in COMMANDS.items():
        p = sub.add_parser(name, help=help_text, description=help_text)
        p.add_argument("--resume", required=True, help="Resume file (.pdf, .txt, .md, or legacy profile .csv)")
        src = p.add_mutually_exclusive_group(required=True)
        src.add_argument("--job", help="Job posting URL, or the posting text itself")
        src.add_argument("--job-file", help="Text file containing the job posting")
        p.add_argument("--provider", choices=list(PROVIDERS), help="LLM provider (default: groq / $LLM_PROVIDER)")
        p.add_argument("--model", help="Model name override")
        if name == "all":
            p.add_argument("--out-dir", required=True, help="Directory to write all outputs into")
        else:
            p.add_argument("--out", help="Save the output to this file")
        if name in ("letter", "all"):
            p.add_argument("--style", default="professional", choices=list(load_prompts()["letter_styles"]))
        if name == "outreach":
            p.add_argument("--contact", default="", help="Who you're writing to, e.g. 'Priya, Engineering Manager'")
        if name == "answer":
            p.add_argument("--question", required=True, help="The application question to answer")
        if name == "match":
            p.add_argument("--json", action="store_true", help="Print the raw JSON report")
    return parser


def run(args: argparse.Namespace) -> str:
    resume = load_resume(args.resume)
    print("Reading job posting...", file=sys.stderr)
    job = load_job(args.job, args.job_file)
    llm = make_llm(load_settings(args.provider, args.model))

    if args.command == "all":
        out = Path(args.out_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / "job_posting.txt").write_text(job, encoding="utf-8")
        steps = [
            ("match.txt", lambda: tasks.format_match_report(tasks.match_report(llm, resume, job))),
            ("cover_letter.txt", lambda: tasks.cover_letter(llm, resume, job, args.style)),
            ("resume_tweaks.md", lambda: tasks.resume_tweaks(llm, resume, job)),
            ("outreach.md", lambda: tasks.outreach(llm, resume, job)),
            ("interview_prep.md", lambda: tasks.interview_prep(llm, resume, job)),
        ]
        for filename, fn in steps:
            print(f"Generating {filename}...", file=sys.stderr)
            (out / filename).write_text(fn(), encoding="utf-8")
        return f"Saved application kit to {out}/"

    print("Generating...", file=sys.stderr)
    if args.command == "match":
        report = tasks.match_report(llm, resume, job)
        return json.dumps(report, indent=2) if args.json else tasks.format_match_report(report)
    if args.command == "letter":
        return tasks.cover_letter(llm, resume, job, args.style)
    if args.command == "tailor":
        return tasks.resume_tweaks(llm, resume, job)
    if args.command == "outreach":
        return tasks.outreach(llm, resume, job, args.contact)
    if args.command == "interview":
        return tasks.interview_prep(llm, resume, job)
    if args.command == "answer":
        return tasks.answer_question(llm, resume, job, args.question)
    raise ValueError(args.command)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = run(args)
    except Exception as e:  # surface a clean message instead of a traceback
        print(f"Error: {e}", file=sys.stderr)
        return 1
    print(result)
    if getattr(args, "out", None):
        Path(args.out).write_text(result, encoding="utf-8")
        print(f"\nSaved to {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
