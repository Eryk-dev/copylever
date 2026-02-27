"""
Copy Anuncios ML — Backend FastAPI
Copia anuncios do Mercado Livre entre contas internas.
"""
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import admin_users, auth, auth_ml, compat, copy

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logging.getLogger("httpx").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Copy Anuncios ML",
    description="Copia anuncios do Mercado Livre entre contas",
    version="1.0.0",
)

# CORS
origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(admin_users.router)
app.include_router(auth.router)
app.include_router(auth_ml.router)
app.include_router(copy.router)
app.include_router(compat.router)


@app.get("/api/health")
@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/debug/env")
async def debug_env():
    """Check which env vars are configured (values masked)."""
    return {
        "ml_app_id": f"...{settings.ml_app_id[-4:]}" if settings.ml_app_id else "MISSING",
        "ml_secret_key": f"...{settings.ml_secret_key[-4:]}" if settings.ml_secret_key else "MISSING",
        "ml_redirect_uri": settings.ml_redirect_uri or "MISSING",
        "supabase_url": settings.supabase_url or "MISSING",
        "supabase_service_role_key": "SET" if settings.supabase_service_role_key else "MISSING",
        "supabase_key": "SET" if settings.supabase_key else "MISSING",
        "base_url": settings.base_url,
        "cors_origins": settings.cors_origins,
    }


# Serve frontend SPA (built React app)
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "dist"

API_PREFIXES = ("api",)

if FRONTEND_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="frontend-assets")

    @app.get("/{path:path}")
    async def serve_frontend(request: Request, path: str):
        first_segment = path.split("/")[0] if path else ""
        if first_segment in API_PREFIXES:
            return JSONResponse({"detail": "Not Found"}, status_code=404)

        file = FRONTEND_DIR / path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(FRONTEND_DIR / "index.html")
