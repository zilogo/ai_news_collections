"""Abstraction for calling an LLM to translate and summarise news."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover - optional dependency
    OpenAI = None  # type: ignore


class MissingLLMLibraryError(RuntimeError):
    """Raised when the OpenAI SDK is not installed."""


class MissingAPIKeyError(RuntimeError):
    """Raised when the OpenAI API key is missing."""


@dataclass
class LLMClient:
    """Simple wrapper around the OpenAI chat completions API."""

    model: str = "gpt-4o-mini"
    api_key: Optional[str] = None
    temperature: float = 0.2

    def __post_init__(self) -> None:
        if OpenAI is None:
            raise MissingLLMLibraryError(
                "The openai package is required. Install it via `pip install openai`."
            )

        key = self.api_key or os.getenv("OPENAI_API_KEY")
        if not key:
            raise MissingAPIKeyError(
                "OPENAI_API_KEY environment variable is not set. "
                "Set it before running the collector or pass api_key explicitly."
            )

        self._client = OpenAI(api_key=key)

    def translate_and_summarise(self, title: str, summary: str, link: str) -> str:
        """Translate and summarise an article into Chinese using the LLM."""
        prompt = (
            "You are an assistant that summarises English AI news into concise, "
            "professionally written Simplified Chinese."
        )
        user_message = (
            "请阅读下面的AI新闻条目，基于标题、原始摘要和链接内容，"
            "输出一个不超过120字的中文摘要。摘要需要包含关键信息，并保持中立客观的语气。\n\n"
            f"标题: {title}\n"
            f"英文摘要: {summary or '无'}\n"
            f"新闻链接: {link}"
        )
        response = self._client.chat.completions.create(
            model=self.model,
            temperature=self.temperature,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_message},
            ],
        )
        return response.choices[0].message.content.strip()
