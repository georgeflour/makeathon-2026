# pyrefly: ignore [missing-import]
from supabase import create_client, Client
# pyrefly: ignore [missing-import]
from app.config import settings

def get_supabase() -> Client | None:
    if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_ROLE_KEY:
        try:
            return create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY)
        except Exception as e:
            print(f"Error initializing Supabase client: {e}")
            return None
    return None

supabase_client = get_supabase()
