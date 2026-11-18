"""Minimal client for OpenAI-compatible chat-completions APIs."""

from __future__ import annotations

import json
import re
from typing import Any, Callable

import requests

from .config import Settings

# A callable taking (system_prompt, user_prompt) and returning the model's text.
LLM = Callable[[str, str], str]


class LLMError(RuntimeError):
    pass


def make_llm(settings: Settings, timeout: int = 120) -> LLM:
    def call(system: str, user: str) -> str:
        headers = {"Content-Type": "application/json"}
        if settings.api_key:
            headers["Authorization"] = f"Bearer {settings.api_key}"
        resp = requests.post(
            f"{settings.base_url}/chat/completions",
            headers=headers,
            json={
                "model": settings.model,
                "temperature": settings.temperature,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
            },
            timeout=timeout,
        )
        if resp.status_code >= 400:
            raise LLMError(f"LLM request failed ({resp.status_code}): {resp.text[:300]}")
        return resp.json()["choices"][0]["message"]["content"].strip()

    return call


def parse_json(text: str) -> Any:
    """Parse JSON from a model reply, tolerating code fences and surrounding prose."""
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start, end = cleaned.find(open_ch), cleaned.rfind(close_ch)
        if start != -1 and end > start:
            try:
                return json.loads(cleaned[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise LLMError("The model did not return valid JSON. Try again.")
