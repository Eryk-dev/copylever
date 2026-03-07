"""
OAuth2 flow for Shopee Open Platform + shop management.
Uses shopee_sellers table (separate from ML copy_sellers).
"""
import hmac as _hmac
import logging
import html as _html
import re
import time
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
    # CSRF protection: HMAC-sign the state with partner_key + timestamp
    ts = str(int(time.time()))
    token = _hmac.new(
        settings.shopee_partner_key.encode(),
        f"{org_id}:{ts}".encode(),
        "sha256",
    ).hexdigest()[:16]
    state_value = f"org_{org_id}_{token}_{ts}"

    redirect = settings.shopee_redirect_uri
    if "?" in redirect:
        redirect += f"&state={state_value}"
    else:
        redirect += f"?state={state_value}"

    auth_url = generate_auth_url(redirect_url=redirect)
    return {"redirect_url": auth_url}


@router.get("/api/shopee/callback")
async def callback(code: str, shop_id: int, state: str = ""):
    """Callback from Shopee OAuth. Exchange code for tokens, save to shopee_sellers."""
    from app.config import settings

    if not state:
        raise HTTPException(status_code=400, detail="Missing state")

    # Parse state: org_{org_id}_{token}_{ts}
    # rsplit from end: ts (digits), token (16 hex), then org_{org_id} as prefix
    if not state.startswith("org_"):
        raise HTTPException(status_code=400, detail="Estado OAuth invalido")

    # Strip "org_" prefix, then rsplit to extract ts and token from the end
    after_prefix = state[4:]  # '{org_id}_{token}_{ts}'
    r_parts = after_prefix.rsplit("_", 2)
    if len(r_parts) != 3:
        raise HTTPException(status_code=400, detail="Estado OAuth invalido")

    org_id, token, ts_str = r_parts[0], r_parts[1], r_parts[2]
    if not org_id or not token or not ts_str:
        raise HTTPException(status_code=400, detail="Estado OAuth invalido")

    # Validate HMAC token
    expected = _hmac.new(
        settings.shopee_partner_key.encode(),
        f"{org_id}:{ts_str}".encode(),
        "sha256",
    ).hexdigest()[:16]
    if not _hmac.compare_digest(token, expected):
        raise HTTPException(status_code=400, detail="Token CSRF invalido")

    # Validate timestamp (max 10 minutes)
    try:
        ts_val = int(ts_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Timestamp invalido no estado OAuth")
    if abs(int(time.time()) - ts_val) > 600:
        raise HTTPException(status_code=400, detail="Estado OAuth expirado (max 10 minutos)")

    try:
        token_data = await exchange_code(code, shop_id)
    except Exception as e:
        logger.error(f"Shopee OAuth exchange failed: {e}")
        raise HTTPException(status_code=502, detail=f"Shopee OAuth failed: {e}")

    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expire_in = token_data.get("expire_in", 14400)  # 4 hours

    if not access_token:
        logger.error("Shopee OAuth returned no access_token. Response: %s", token_data)
        raise HTTPException(
            status_code=502,
            detail="Shopee OAuth returned no access_token. Please try again.",
        )

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=expire_in)
    # Use refresh_token_expire_in from Shopee response if available, fallback to 30 days
    refresh_expire_in = token_data.get("refresh_token_expire_in")
    if refresh_expire_in:
        refresh_expires_at = datetime.now(timezone.utc) + timedelta(seconds=refresh_expire_in)
    else:
        logger.warning("Shopee token response missing refresh_token_expire_in — using 30-day default")
        refresh_expires_at = datetime.now(timezone.utc) + timedelta(days=30)

    # Fetch shop info
    try:
        shop_info = await fetch_shop_info(access_token, shop_id)
        shop_response = shop_info.get("response", shop_info)
        shop_name = shop_response.get("shop_name", f"shop_{shop_id}")
    except Exception as e:
        logger.warning(f"Failed to fetch Shopee shop info: {e}")
        shop_name = f"shop_{shop_id}"

    # Sanitize slug: only [a-z0-9-], fallback to shop-{shop_id}
    slug = re.sub(r"[^a-z0-9-]", "", shop_name.lower().replace(" ", "-"))[:50]
    if not slug:
        slug = f"shop-{shop_id}"

    try:
        db = get_db()

        # Anti-abuse: check if this Shopee shop is already connected to a DIFFERENT org
        global_check = db.table("shopee_sellers").select(
            "org_id"
        ).eq("shop_id", shop_id).neq("org_id", org_id).execute()
        if global_check.data:
            logger.warning(
                "Trial abuse blocked: shop_id=%s already in org=%s, attempted org=%s",
                shop_id, global_check.data[0]["org_id"], org_id,
            )
            return _error_page(
                "Loja j\u00e1 vinculada",
                "Esta loja Shopee j\u00e1 est\u00e1 conectada a outra organiza\u00e7\u00e3o. "
                "Cada loja Shopee s\u00f3 pode ser usada em uma organiza\u00e7\u00e3o.",
            )

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

        # Deduplicate slug within org
        existing_slugs = db.table("shopee_sellers").select("slug").eq(
            "org_id", org_id
        ).like("slug", f"{slug}%").execute()
        taken = {r["slug"] for r in (existing_slugs.data or [])}
        if slug in taken:
            suffix = 2
            while f"{slug}-{suffix}" in taken:
                suffix += 1
            slug = f"{slug}-{suffix}"

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


def _error_page(title: str, message: str) -> HTMLResponse:
    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Copy An&uacute;ncios &mdash; Erro</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: 'Inter', -apple-system, sans-serif; background: #0f0f0f; color: #f2f2f2; min-height: 100vh; display: flex; align-items: center; justify-content: center; }}
        .card {{ background: #161616; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 48px; max-width: 460px; text-align: center; }}
        .icon {{ font-size: 40px; margin-bottom: 16px; color: #ef4444; }}
        h1 {{ font-size: 20px; font-weight: 600; margin-bottom: 12px; }}
        p {{ font-size: 15px; line-height: 1.6; color: #b3b3b3; }}
        .back {{ display: inline-block; margin-top: 20px; color: #EE4D2D; text-decoration: none; font-size: 13px; font-weight: 500; }}
        .back:hover {{ text-decoration: underline; }}
    </style>
</head>
<body>
    <div class="card">
        <div class="icon">&#10007;</div>
        <h1>{title}</h1>
        <p>{message}</p>
        <a href="/" class="back">&larr; Voltar ao painel</a>
    </div>
</body>
</html>"""
    return HTMLResponse(content=html, status_code=403)


def _success_page(shop_name: str, already_exists: bool) -> HTMLResponse:
    safe_name = _html.escape(shop_name)
    if already_exists:
        message = f"Loja <strong>{safe_name}</strong> j&aacute; estava cadastrada. Tokens atualizados com sucesso."
    else:
        message = f"Loja <strong>{safe_name}</strong> conectada com sucesso!"

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
