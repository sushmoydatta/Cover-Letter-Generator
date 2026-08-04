"""
Configuration loader. All secrets and personal details come from environment
variables — nothing sensitive is hardcoded in source.

Copy .env.example to .env and fill in your own values before running.
"""

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _require(key: str) -> str:
    value = os.environ.get(key)
    if not value:
        raise EnvironmentError(
            f"Missing required environment variable: {key}. "
            f"Copy .env.example to .env and fill it in."
        )
    return value


@dataclass
class Settings:
    groq_api_key: str
    llm_model: str
    candidate_profile_path: str
    vectorstore_path: str


def load_settings() -> Settings:
    return Settings(
        groq_api_key=_require("GROQ_API_KEY"),
        llm_model=os.environ.get("LLM_MODEL", "llama-3.3-70b-versatile"),
        candidate_profile_path=os.environ.get("CANDIDATE_PROFILE_PATH", "data/profile.csv"),
        vectorstore_path=os.environ.get("VECTORSTORE_PATH", "vectorstore"),
    )
