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
    
    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
