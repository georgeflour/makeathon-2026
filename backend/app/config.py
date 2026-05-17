# pyrefly: ignore [missing-import]
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    FRONTEND_URL: str = "http://localhost:3000"

    # Supabase
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""

    # Azure AI
    AZURE_AI_PROJECT_ENDPOINT: str = ""
    AZURE_AGENT_ID: str = ""
    AZURE_AGENT_VERSION: str = "1"
    AZURE_DEPLOYMENT_NAME: str = "gpt-4o"
    AZURE_FAST_DEPLOYMENT_NAME: str = ""          # optional: faster/cheaper model for agents 1 & 3
    AZURE_EMBEDDING_DEPLOYMENT_NAME: str = ""     # your text-embedding deployment name in Azure
    AZURE_OPENAI_API_KEY: str = ""
    AZURE_OPENAI_ENDPOINT: str = "https://makeathon-ai-foundry.cognitiveservices.azure.com/"

    # Email (scheduled report emails) — uses Resend API
    RESEND_API_KEY: str = ""
    REPORT_FROM_EMAIL: str = "reports@makeathon-2026.com"

    # Supabase direct DB connection (for SQL queries)
    SUPABASE_DB_URL: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()