# backend/app/models.py
# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional, Any, List


class ColorRules(BaseModel):
    threshold: float
    above: str
    below: str


class ChartSpec(BaseModel):
    type: str
    title: str
    data: Any
    sql: str
    explanation: Optional[str] = None
    color_rules: Optional[ColorRules] = None
    suggestions: Optional[list[str]] = []


class ChatMessage(BaseModel):
    role: str
    content: str
    # When an assistant message produced a chart, the frontend re-sends it here
    # so the agent can reference previous graphs in follow-up questions.
    chart: Optional[ChartSpec] = None


class ChatRequest(BaseModel):
    message: str
    history: List[ChatMessage] = []


class ChatResponse(BaseModel):
    answer: str
    chart: Optional[ChartSpec] = None


class ItemCreate(BaseModel):
    title: str
    description: Optional[str] = None


class ItemResponse(ItemCreate):
    id: str
    created_at: str