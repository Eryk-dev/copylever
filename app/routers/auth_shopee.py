"""
OAuth2 flow for Shopee Open Platform + shop management.
Uses shopee_sellers table (separate from ML copy_sellers).
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from app.routers.auth import require_active_org
from app.services.shopee_api import (
    exchange_code,
    fetch_shop_info,
    generate_auth_url,
)
from app.db.supabase import get_db

logger = logging.getLogger(__name__)
router = APIRouter(tags=["shopee"])


@router.get("/api/shopee/install")
async def install(user: dict = Depends(require_active_org)):
    """Return Shopee OAuth URL with org_id encoded in redirect."""
    from app.config import settings

    org_id = user["org_id"]
    # Shopee passes state back as query param on redirect
    redirect = settings.shopee_redirect_uri
    if "?" in redirect:
        redirect += f"&state=org_{org_id}"
    else:
        redirect += f"?state=org_{org_id}"

    auth_url = generate_auth_url(redirect_url=redirect)
    return {"redirect_url": auth_url}


@router.get("/api/shopee/callback")
async def callback(code: str, shop_id: int, state: str = ""):
    """Callback from Shopee OAuth. Exchange code for tokens, save to shopee_sellers."""
    if not state:
        raise HTTPException(status_code=400, detail="Missing state")

    org_id = None
    if state.startswith("org_"):
        org_id = state[4:]
    if not org_id:
        raise HTTPException(status_code=400, detail="Missing org_id in state")

    try:
        token_data = await exchange_code(code, shop_id)
    except Exception as e:
        logger.error(f"Shopee OAuth exchange failed: {e}")
        raise HTTPException(status_code=502, detail=f"Shopee OAuth failed: {e}")

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expire_in = token_data.get("expire_in", 14400)  # 4 hours

    if not access_token:
        raise HTTPException(
            status_code=502,
            detail=f"Shopee OAuth returned no access_token. Response: {token_data}",
        )

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expire_in)
    # Shopee refresh tokens expire in ~30 days
    refresh_expires_at = datetime.now(timezone.utc) + timedelta(days=30)

    # Fetch shop info
    try:
        shop_info = await fetch_shop_info(access_token, shop_id)
        shop_response = shop_info.get("response", shop_info)
        shop_name = shop_response.get("shop_name", f"shop_{shop_id}")
    except Exception as e:
        logger.warning(f"Failed to fetch Shopee shop info: {e}")
        shop_name = f"shop_{shop_id}"

    slug = shop_name.lower().replace(" ", "-")[:50]

    try:
        db = get_db()

        # Check for existing seller by shop_id within org
        result = db.table("shopee_sellers").select(
            "id, slug, refresh_token"
        ).eq("shop_id", shop_id).eq("org_id", org_id).execute()
        existing = result.data[0] if result.data else None

        effective_refresh = refresh_token or (existing or {}).get("refresh_token")

        seller_data = {
            "shop_id": shop_id,
            "access_token": access_token,
            "refresh_token": effective_refresh,
            "token_expires_at": expires_at.isoformat(),
            "refresh_token_expires_at": refresh_expires_at.isoformat(),
            "active": True,
            "org_id": org_id,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        if existing:
            db.table("shopee_sellers").update({
                "name": shop_name,
                **seller_data,
            }).eq("id", existing["id"]).execute()
            logger.info(f"Shopee OAuth: updated tokens for shop {shop_id} (org={org_id})")
            return _success_page(shop_name, already_exists=True)

        # Create new
        db.table("shopee_sellers").insert({
            "slug": slug,
            "name": shop_name,
            **seller_data,
        }).execute()
        logger.info(f"Shopee OAuth: new shop connected — shop_id={shop_id}, name={shop_name}, org={org_id}")
        return _success_page(shop_name, already_exists=False)

    except Exception as e:
        logger.error(f"Database error during Shopee OAuth callback: {e}")
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


@router.get("/api/shopee/sellers")
async def list_sellers(user: dict = Depends(require_active_org)):
    """List connected Shopee shops for the user's org."""
    db = get_db()
    result = db.table("shopee_sellers").select(
        "slug, name, shop_id, token_expires_at, active, created_at"
    ).eq("active", True).eq("org_id", user["org_id"]).order("created_at").execute()

    sellers = []
    now = datetime.now(timezone.utc)
    for s in result.data or []:
        token_valid = False
        if s.get("token_expires_at"):
            expires = datetime.fromisoformat(s["token_expires_at"])
            token_valid = expires > now
        sellers.append({
            "slug": s["slug"],
            "name": s["name"],
            "shop_id": s["shop_id"],
            "token_valid": token_valid,
            "token_expires_at": s["token_expires_at"],
            "created_at": s["created_at"],
        })

    return sellers


class RenameShopRequest(BaseModel):
    name: str


@router.put("/api/shopee/sellers/{slug}/name")
async def rename_seller(slug: str, body: RenameShopRequest, user: dict = Depends(require_active_org)):
    """Rename a connected Shopee shop."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome nao pode ser vazio")
    if len(name) > 100:
        raise HTTPException(status_code=400, detail="Nome muito longo (max. 100 caracteres)")

    db = get_db()
    result = db.table("shopee_sellers").update({
        "name": name,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("slug", slug).eq("org_id", user["org_id"]).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail=f"Shop '{slug}' nao encontrado")

    return {"status": "ok", "slug": slug, "name": name}


@router.delete("/api/shopee/sellers/{slug}")
async def disconnect_seller(slug: str, user: dict = Depends(require_active_org)):
    """Disconnect a Shopee shop (clear tokens), scoped by org."""
    db = get_db()
    result = db.table("shopee_sellers").update({
        "access_token": None,
        "refresh_token": None,
        "token_expires_at": None,
        "refresh_token_expires_at": None,
        "active": False,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("slug", slug).eq("org_id", user["org_id"]).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail=f"Shop '{slug}' not found")

    return {"status": "ok", "slug": slug}


def _success_page(shop_name: str, already_exists: bool) -> HTMLResponse:
    if already_exists:
        message = f"Loja <strong>{shop_name}</strong> j&aacute; estava cadastrada. Tokens atualizados com sucesso."
    else:
        message = f"Loja <strong>{shop_name}</strong> conectada com sucesso!"

    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Copy An&uacute;ncios &mdash; Conex&atilde;o Shopee</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: 'Inter', -apple-system, sans-serif; background: #0f0f0f; color: #f2f2f2; min-height: 100vh; display: flex; align-items: center; justify-content: center; }}
        .card {{ background: #161616; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 48px; max-width: 460px; text-align: center; }}
        .icon {{ font-size: 40px; margin-bottom: 16px; color: #10b981; }}
        h1 {{ font-size: 20px; font-weight: 600; margin-bottom: 12px; }}
        p {{ font-size: 15px; line-height: 1.6; color: #b3b3b3; }}
        p strong {{ color: #EE4D2D; }}
        .back {{ display: inline-block; margin-top: 20px; color: #EE4D2D; text-decoration: none; font-size: 13px; font-weight: 500; }}
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
