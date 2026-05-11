# pyrefly: ignore [missing-import]
from fastapi import APIRouter, HTTPException
# pyrefly: ignore [missing-import]
from app.models import ChatRequest, ChatResponse
from app.db import supabase_client
from app.azure_agent import call_agent

router = APIRouter()

@router.post("/api/chat", response_model=ChatResponse)
def chat_endpoint(request: ChatRequest):
    user_message = request.message
    
    # Save user message if configured
    if supabase_client:
        try:
            supabase_client.table("chat_messages").insert({
                "role": "user",
                "content": user_message
            }).execute()
        except Exception as e:
            print(f"Failed to log user message: {e}")
            
    # Call Azure agent
    assistant_response = call_agent(user_message)
    
    # Save assistant message if configured
    if supabase_client:
        try:
            supabase_client.table("chat_messages").insert({
                "role": "assistant",
                "content": assistant_response
            }).execute()
        except Exception as e:
            print(f"Failed to log assistant message: {e}")
            
    return ChatResponse(answer=assistant_response)
