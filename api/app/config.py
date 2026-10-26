from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Reads secret values from the .env file so they never sit inside the code."""

    supabase_url: str
    supabase_service_key: str
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"
    azure_speech_key: str = ""
    azure_speech_region: str = ""
    frontend_url: str = "http://localhost:3000"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
