"""
agent.py — Generic Azure AI Foundry agent wrapper.

Provides call_llm() for one-shot LLM calls via the Azure AI Foundry
ChatCompletionsClient (azure-ai-inference SDK).
"""

from __future__ import annotations

# pyrefly: ignore [missing-import]
from azure.ai.inference import ChatCompletionsClient
# pyrefly: ignore [missing-import]
from azure.ai.inference.models import (
    AssistantMessage,
    SystemMessage,
    UserMessage,
)
# pyrefly: ignore [missing-import]
from azure.identity import DefaultAzureCredential

from app.config import settings


def _get_client() -> ChatCompletionsClient:
    """Create and return an Azure AI Foundry ChatCompletionsClient."""
    return ChatCompletionsClient(
        endpoint=settings.AZURE_AI_PROJECT_ENDPOINT,
        credential=DefaultAzureCredential(),
    )


def call_llm(
    prompt: str,
    *,
    system: str | None = None,
    history: list[dict] | None = None,
    temperature: float = 0.0,
) -> str:
    """
    Call the Azure AI Foundry LLM with any prompt and return the response text.

    Args:
        prompt:      The user message / instruction to send.
        system:      Optional system prompt. Defaults to a generic assistant persona.
        history:     Optional prior conversation turns as dicts
                     [{"role": "user"|"assistant", "content": "..."}].
        temperature: Sampling temperature (default 0 for deterministic output).

    Returns:
        The model's response as a plain string.

    Raises:
        RuntimeError: If Azure AI is not configured or the LLM call fails.
    """
    if not settings.AZURE_AI_PROJECT_ENDPOINT:
        raise RuntimeError("AZURE_AI_PROJECT_ENDPOINT is not configured.")

    try:
        client = _get_client()
    except Exception as exc:
        raise RuntimeError(f"Failed to connect to Azure AI Foundry: {exc}") from exc

    messages = [SystemMessage(content=system or "You are a helpful AI assistant.")]

    if history:
        for turn in history:
            role = turn.get("role", "user")
            content = turn.get("content", "")
            if not content:
                continue
            if role == "assistant":
                messages.append(AssistantMessage(content=content))
            elif role == "user":
                messages.append(UserMessage(content=content))

    messages.append(UserMessage(content=prompt))

    try:
        response = client.complete(
            model=settings.AZURE_DEPLOYMENT_NAME,
            messages=messages,
            temperature=temperature,
        )
        return response.choices[0].message.content or ""
    except Exception as exc:
        raise RuntimeError(f"LLM call failed: {exc}") from exc
