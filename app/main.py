"""
Copy Anuncios ML — Backend FastAPI
Copia anuncios do Mercado Livre entre contas internas.
"""
import logging
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import admin_users, auth, auth_ml, auth_shopee, billing, compat, copy, photos, shopee_copy, super_admin
from app.routers.auth import require_super_admin

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


@app.on_event("startup")
async def cleanup_stale_tasks():
    """Mark abandoned in_progress copy logs as error on server restart."""
    try:
        from app.db.supabase import get_db
        db = get_db()
        stale_error = {"_system": "Interrompido por reinicio do servidor"}
        for table in ["copy_logs", "shopee_copy_logs"]:
            db.table(table).update({
                "status": "error",
                "error_details": stale_error,
            }).eq("status", "in_progress").execute()
        # photo_logs uses "processing" instead of "in_progress"
        db.table("photo_logs").update({
            "status": "error",
        }).eq("status", "processing").execute()
        logger.info("Cleaned up stale in_progress tasks on startup")
    except Exception as e:
        logger.warning("Failed to clean up stale tasks: %s", e)

@app.on_event("shutdown")
async def shutdown_http_clients():
    """Close shared HTTP clients on app shutdown."""
    from app.services.shopee_api import close_client
    from app.services.ml_api import close_ml_client
    await close_client()
    await close_ml_client()

# CORS
origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    max_age=3600,
)

# Routers
app.include_router(admin_users.router)
app.include_router(auth.router)
app.include_router(auth_ml.router)
app.include_router(billing.router)
app.include_router(copy.router)
app.include_router(compat.router)
app.include_router(super_admin.router)
app.include_router(auth_shopee.router)
app.include_router(shopee_copy.router)
app.include_router(photos.router)


@app.get("/api/health")
@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/debug/env")
async def debug_env(user: dict = Depends(require_super_admin)):
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
        "shopee_partner_id": str(settings.shopee_partner_id) if settings.shopee_partner_id else "MISSING",
        "shopee_partner_key": "SET" if settings.shopee_partner_key else "MISSING",
        "shopee_redirect_uri": settings.shopee_redirect_uri or "MISSING",
        "shopee_sandbox": settings.shopee_sandbox,
    }


@app.get("/api/debug/shopee-sign-test")
async def debug_shopee_sign(user: dict = Depends(require_super_admin)):
    """Debug Shopee HMAC sign computation (super_admin only)."""
    import hashlib
    import hmac
    import time

    partner_id = settings.shopee_partner_id
    partner_key = settings.shopee_partner_key
    path = "/api/v2/shop/auth_partner"
    ts = int(time.time())

    base_string = f"{partner_id}{path}{ts}"
    sign = hmac.new(
        partner_key.encode(), base_string.encode(), hashlib.sha256
    ).hexdigest()

    return {
        "partner_id": partner_id,
        "partner_id_type": type(partner_id).__name__,
        "partner_key_length": len(partner_key),
        "partner_key_first4": partner_key[:4],
        "partner_key_last4": partner_key[-4:],
        "partner_key_repr": repr(partner_key[:10]) + "...",
        "path": path,
        "timestamp": ts,
        "base_string": base_string,
        "sign": sign,
        "sandbox": settings.shopee_sandbox,
        "base_url": "https://partner.test-stable.shopeemobile.com" if settings.shopee_sandbox else "https://partner.shopeemobile.com",
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
