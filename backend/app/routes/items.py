from fastapi import APIRouter, HTTPException
from typing import List
from app.models import ItemCreate, ItemResponse
from app.db import supabase_client

router = APIRouter()

@router.get("/api/items", response_model=List[ItemResponse])
def get_items():
    if not supabase_client:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    try:
        response = supabase_client.table("app_items").select("*").execute()
        return response.data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/api/items", response_model=ItemResponse)
def create_item(item: ItemCreate):
    if not supabase_client:
        raise HTTPException(status_code=500, detail="Supabase not configured")
    try:
        data = item.model_dump()
        response = supabase_client.table("app_items").insert(data).execute()
        if not response.data:
            raise HTTPException(status_code=500, detail="Failed to insert item")
        return response.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
