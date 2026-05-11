# pyrefly: ignore [missing-import]
import os
# pyrefly: ignore [missing-import]
from azure.ai.projects import AIProjectClient
# pyrefly: ignore [missing-import]
from azure.identity import DefaultAzureCredential
# pyrefly: ignore [missing-import]
from app.config import settings

def call_agent(user_message: str) -> str:
    if not all([
        settings.AZURE_AI_PROJECT_ENDPOINT,
        settings.AZURE_AGENT_ID,
        settings.AZURE_AGENT_VERSION
    ]):
        return "Azure agent is not configured yet."
        
    try:
        project_client = AIProjectClient(
            endpoint=settings.AZURE_AI_PROJECT_ENDPOINT,
            credential=DefaultAzureCredential()
        )
        
        openai_client = project_client.get_openai_client()
        
        # Reference the agent to get a response
        response = openai_client.responses.create(
            input=[{"role": "user", "content": user_message}],
            extra_body={"agent_reference": {"name": settings.AZURE_AGENT_ID, "version": settings.AZURE_AGENT_VERSION, "type": "agent_reference"}},
        )
        
        return response.output_text
    except Exception as e:
        return f"Error communicating with Azure Agent: {e}"
