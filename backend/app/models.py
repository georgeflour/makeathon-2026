# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional, Any

class ChatMessage(BaseModel):
    role: str
    content: str

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

class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []

class ChatResponse(BaseModel):
    answer: str
    chart: Optional[ChartSpec] = None

class ItemCreate(BaseModel):
    title: str
    description: Optional[str] = None

class ItemResponse(ItemCreate):
    id: str
    created_at: str
