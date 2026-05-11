# pyrefly: ignore [missing-import]
from pydantic import BaseModel
from typing import Optional

class ChatRequest(BaseModel):
    message: str

class ChatResponse(BaseModel):
    answer: str

class ItemCreate(BaseModel):
    title: str
    description: Optional[str] = None

class ItemResponse(ItemCreate):
    id: str
    created_at: str
