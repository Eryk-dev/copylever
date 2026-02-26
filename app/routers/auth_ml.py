"""
OAuth2 flow for Mercado Livre + sellers management.
Uses copy_sellers table (separate from lever money sellers).
"""
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse

from app.config import settings
from app.db.supabase import get_db
from app.routers.auth import require_admin
from app.services.ml_api import exchange_code, fetch_user_info

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ml"])


@router.get("/api/ml/install")
async def install():
    """Redirect to ML OAuth for seller authorization."""
    params = urlencode({
        "response_type": "code",
        "client_id": settings.ml_app_id,
        "redirect_uri": settings.ml_redirect_uri,
        "state": "_install",
    })
    return RedirectResponse(f"https://auth.mercadolivre.com.br/authorization?{params}")


@router.get("/api/ml/callback")
async def callback(code: str, state: str = ""):
    """Callback from ML OAuth. Exchange code for tokens, save to copy_sellers."""
    if not state:
        raise HTTPException(status_code=400, detail="Missing state")

    try:
        token_data = await exchange_code(code)
    except Exception as e:
        logger.error(f"OAuth exchange failed: {e}")
        raise HTTPException(status_code=502, detail=f"ML OAuth failed: {e}")

    logger.info(f"OAuth token_data keys: {list(token_data.keys())}")

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in", 21600)
    ml_user_id_from_token = token_data.get("user_id")

    if not access_token:
        raise HTTPException(status_code=502, detail=f"ML OAuth returned no access_token. Keys: {list(token_data.keys())}")

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

    # Fetch ML user info
    try:
        user_info = await fetch_user_info(access_token)
    except Exception as e:
        logger.error(f"Failed to fetch ML user info: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch ML user info: {e}")

    ml_user_id = user_info["id"]
    nickname = user_info.get("nickname", f"seller_{ml_user_id}")
    slug = nickname.lower().replace(" ", "-")

    try:
        db = get_db()

        # Check if seller already exists in copy_sellers
        existing = db.table("copy_sellers").select("slug").or_(
            f"ml_user_id.eq.{ml_user_id},slug.eq.{slug}"
        ).execute()

        seller_data = {
            "ml_user_id": ml_user_id,
            "ml_access_token": access_token,
            "ml_refresh_token": refresh_token,
            "ml_token_expires_at": expires_at.isoformat(),
            "active": True,
        }

        if existing.data:
            db.table("copy_sellers").update(seller_data).eq(
                "slug", existing.data[0]["slug"]
            ).execute()
            logger.info(f"OAuth: updated tokens for existing copy_seller {existing.data[0]['slug']}")
            return _success_page(existing.data[0]["slug"], already_exists=True)

        # Create new seller
        db.table("copy_sellers").insert({
            "slug": slug,
            "name": nickname,
            **seller_data,
        }).execute()

        logger.info(f"OAuth: new copy_seller created — slug={slug}, ml_user_id={ml_user_id}")
        return _success_page(slug, already_exists=False)

    except Exception as e:
        logger.error(f"Supabase operation failed during OAuth callback: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


@router.get("/api/sellers", dependencies=[Depends(require_admin)])
async def list_sellers():
    """List all connected sellers with valid tokens."""
    db = get_db()
    result = db.table("copy_sellers").select(
        "slug, name, ml_user_id, ml_token_expires_at, active, created_at"
    ).eq("active", True).order("created_at").execute()

    sellers = []
    now = datetime.now(timezone.utc)
    for s in result.data or []:
        token_valid = False
        if s.get("ml_token_expires_at"):
            expires = datetime.fromisoformat(s["ml_token_expires_at"])
            token_valid = expires > now
        sellers.append({
            "slug": s["slug"],
            "name": s["name"],
            "ml_user_id": s["ml_user_id"],
            "token_valid": token_valid,
            "token_expires_at": s["ml_token_expires_at"],
            "created_at": s["created_at"],
        })

    return sellers


@router.delete("/api/sellers/{slug}", dependencies=[Depends(require_admin)])
async def disconnect_seller(slug: str):
    """Disconnect a seller (clear tokens)."""
    db = get_db()
    result = db.table("copy_sellers").update({
        "ml_access_token": None,
        "ml_refresh_token": None,
        "ml_token_expires_at": None,
        "active": False,
    }).eq("slug", slug).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail=f"Seller '{slug}' not found")

    return {"status": "ok", "seller": slug}


def _success_page(slug: str, already_exists: bool) -> HTMLResponse:
    if already_exists:
        message = f"Conta <strong>{slug}</strong> j&aacute; estava cadastrada. Tokens atualizados com sucesso."
    else:
        message = f"Conta <strong>{slug}</strong> conectada com sucesso!"

    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Copy An&uacute;ncios &mdash; Conex&atilde;o ML</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: 'Inter', -apple-system, sans-serif; background: #0f0f0f; color: #f2f2f2; min-height: 100vh; display: flex; align-items: center; justify-content: center; }}
        .card {{ background: #161616; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 48px; max-width: 460px; text-align: center; }}
        .icon {{ font-size: 40px; margin-bottom: 16px; color: #10b981; }}
        h1 {{ font-size: 20px; font-weight: 600; margin-bottom: 12px; }}
        p {{ font-size: 15px; line-height: 1.6; color: #b3b3b3; }}
        p strong {{ color: #23D8D3; }}
        .back {{ display: inline-block; margin-top: 20px; color: #23D8D3; text-decoration: none; font-size: 13px; font-weight: 500; }}
        .back:hover {{ text-decoration: underline; }}
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">&#10003;</div>
        <h1>Conex&atilde;o realizada!</h1>
        <p>{message}</p>
        <a href="/" class="back">&larr; Voltar ao painel</a>
    </div>
</body>
</html>"""
    return HTMLResponse(content=html)
