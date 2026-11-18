"""Settings loaded from environment variables (or a local .env file).

Any OpenAI-compatible chat-completions endpoint works: Groq (default, free tier),
OpenAI, OpenRouter, a local Ollama server, etc.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # python-dotenv is optional
    pass

PROVIDERS = {
    "groq": ("https://api.groq.com/openai/v1", "llama-3.3-70b-versatile", "GROQ_API_KEY"),
    "openai": ("https://api.openai.com/v1", "gpt-4o-mini", "OPENAI_API_KEY"),
    "openrouter": ("https://openrouter.ai/api/v1", "meta-llama/llama-3.3-70b-instruct", "OPENROUTER_API_KEY"),
    "ollama": ("http://localhost:11434/v1", "llama3.1", None),
}


@dataclass
class Settings:
    base_url: str
    model: str
    api_key: str | None
    temperature: float = 0.4


def load_settings(provider: str | None = None, model: str | None = None) -> Settings:
    provider = (provider or os.environ.get("LLM_PROVIDER", "groq")).lower()
    if provider not in PROVIDERS:
        raise ValueError(f"Unknown provider '{provider}'. Choose one of: {', '.join(PROVIDERS)}")
    base_url, default_model, key_var = PROVIDERS[provider]
    base_url = os.environ.get("LLM_BASE_URL", base_url)
    api_key = os.environ.get("LLM_API_KEY") or (os.environ.get(key_var) if key_var else None)
    if key_var and not api_key:
        raise EnvironmentError(
            f"Missing API key: set {key_var} (or LLM_API_KEY). Copy .env.example to .env and fill it in."
        )
    return Settings(
        base_url=base_url.rstrip("/"),
        model=model or os.environ.get("LLM_MODEL", default_model),
        api_key=api_key,
        temperature=float(os.environ.get("LLM_TEMPERATURE", "0.4")),
    )
