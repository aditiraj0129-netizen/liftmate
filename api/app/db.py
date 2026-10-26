from supabase import Client, create_client

from app.config import settings

# One shared Supabase client for the whole backend.
# It uses the service key, so every route MUST filter by the logged-in user's id.
supabase: Client = create_client(settings.supabase_url, settings.supabase_service_key)
