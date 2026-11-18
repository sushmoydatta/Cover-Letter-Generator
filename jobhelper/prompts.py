"""Loads the shared prompt definitions from prompts.json."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

PROMPTS_PATH = Path(__file__).with_name("prompts.json")


@lru_cache(maxsize=1)
def load_prompts() -> dict:
    return json.loads(PROMPTS_PATH.read_text(encoding="utf-8"))


def render(task: str, resume: str, job: str, extra: str = "") -> tuple[str, str]:
    """Return (system_prompt, user_prompt) for a task."""
    data = load_prompts()
    if task not in data["tasks"]:
        raise KeyError(f"Unknown task '{task}'. Choose one of: {', '.join(data['tasks'])}")
    template = data["tasks"][task]["prompt"]
    # Plain replacement (not str.format) so braces inside resumes/postings are safe.
    user = template.replace("{extra}", extra).replace("{resume}", resume).replace("{job}", job)
    return data["system"], user
