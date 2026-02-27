from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Mercado Livre App (separate app for copy-anuncios)
    ml_app_id: str = ""
    ml_secret_key: str = ""
    ml_redirect_uri: str = ""

    # Supabase (same project as lever money)
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_key: str = ""

    # Auth
    admin_master_password: str = ""

    # Server
    base_url: str = "http://localhost:8000"

    # Dashboard CORS origins (comma-separated)
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
