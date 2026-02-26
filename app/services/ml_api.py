"""
Cliente para APIs do Mercado Livre.
Supports per-seller ML app credentials with fallback to global settings.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.db.supabase import get_db

ML_API = "https://api.mercadolibre.com"
MP_API = "https://api.mercadopago.com"

logger = logging.getLogger(__name__)


def _get_seller_credentials(seller: dict) -> tuple[str, str]:
    from app.config import settings
    app_id = seller.get("ml_app_id") or settings.ml_app_id
    secret = seller.get("ml_secret_key") or settings.ml_secret_key
    return app_id, secret


async def _get_token(seller_slug: str) -> str:
    """Get access_token for seller. Auto-refresh if expired."""
    db = get_db()
    seller = db.table("copy_sellers").select(
        "ml_access_token, ml_refresh_token, ml_token_expires_at, ml_app_id, ml_secret_key"
    ).eq("slug", seller_slug).single().execute()
    s = seller.data

    expires_at = datetime.fromisoformat(s["ml_token_expires_at"]) if s.get("ml_token_expires_at") else None
    if expires_at and expires_at > datetime.now(timezone.utc):
        return s["ml_access_token"]

    # Refresh token
    old_refresh = s["ml_refresh_token"]
    if not old_refresh:
        raise RuntimeError(f"Seller '{seller_slug}' has no refresh_token. Reconnect via /api/ml/install")

    app_id, secret = _get_seller_credentials(s)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{MP_API}/oauth/token", json={
            "grant_type": "refresh_token",
            "client_id": app_id,
            "client_secret": secret,
            "refresh_token": old_refresh,
        })
        resp.raise_for_status()
        data = resp.json()

    new_expires = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 21600))
    new_refresh = data.get("refresh_token") or old_refresh
    db.table("copy_sellers").update({
        "ml_access_token": data["access_token"],
        "ml_refresh_token": new_refresh,
        "ml_token_expires_at": new_expires.isoformat(),
    }).eq("slug", seller_slug).execute()

    return data["access_token"]


async def exchange_code(code: str) -> dict:
    """Exchange authorization_code for access_token + refresh_token."""
    from app.config import settings
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{MP_API}/oauth/token", json={
            "grant_type": "authorization_code",
            "client_id": settings.ml_app_id,
            "client_secret": settings.ml_secret_key,
            "code": code,
            "redirect_uri": settings.ml_redirect_uri,
        })
        resp.raise_for_status()
        return resp.json()


async def fetch_user_info(access_token: str) -> dict:
    """GET /users/me — returns ML user profile."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{ML_API}/users/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        return resp.json()


# ── Item operations ──────────────────────────────────────


async def get_item(seller_slug: str, item_id: str) -> dict:
    """GET /items/{item_id} — full item data."""
    token = await _get_token(seller_slug)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{ML_API}/items/{item_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
        return resp.json()


async def get_item_description(seller_slug: str, item_id: str) -> dict:
    """GET /items/{item_id}/description — item description."""
    token = await _get_token(seller_slug)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{ML_API}/items/{item_id}/description",
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code == 404:
            return {}
        resp.raise_for_status()
        return resp.json()


async def get_item_compatibilities(seller_slug: str, item_id: str) -> dict | None:
    """GET /items/{item_id}/compatibilities?extended=true — autoparts compatibilities."""
    token = await _get_token(seller_slug)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{ML_API}/items/{item_id}/compatibilities",
            headers={"Authorization": f"Bearer {token}"},
            params={"extended": "true"},
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()


async def create_item(seller_slug: str, payload: dict) -> dict:
    """POST /items — create new listing."""
    token = await _get_token(seller_slug)
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{ML_API}/items",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()


async def set_item_description(seller_slug: str, item_id: str, plain_text: str) -> dict:
    """POST /items/{item_id}/description — set description."""
    token = await _get_token(seller_slug)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{ML_API}/items/{item_id}/description",
            headers={"Authorization": f"Bearer {token}"},
            json={"plain_text": plain_text},
        )
        resp.raise_for_status()
        return resp.json()


async def set_item_compatibilities(seller_slug: str, item_id: str, compat_data: dict) -> dict:
    """POST /items/{item_id}/compatibilities — set compatibilities."""
    token = await _get_token(seller_slug)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{ML_API}/items/{item_id}/compatibilities",
            headers={"Authorization": f"Bearer {token}"},
            json=compat_data,
        )
        resp.raise_for_status()
        return resp.json()


async def search_items_by_sku(seller_slug: str, sku: str) -> list[str]:
    """GET /users/{user_id}/items/search?seller_sku={sku} — find items by seller SKU."""
    db = get_db()
    seller = db.table("copy_sellers").select("ml_user_id").eq("slug", seller_slug).single().execute()
    user_id = seller.data["ml_user_id"]

    token = await _get_token(seller_slug)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{ML_API}/users/{user_id}/items/search",
            headers={"Authorization": f"Bearer {token}"},
            params={"seller_sku": sku},
        )
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        return resp.json().get("results", [])


async def copy_item_compatibilities(seller_slug: str, new_item_id: str, source_item_id: str) -> dict:
    """POST /items/{new_item_id}/compatibilities — copy from source item (ML native)."""
    token = await _get_token(seller_slug)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{ML_API}/items/{new_item_id}/compatibilities",
            headers={"Authorization": f"Bearer {token}"},
            json={"item_to_copy": {"item_id": source_item_id, "extended_information": True}},
        )
        if resp.status_code == 404:
            return {}
        resp.raise_for_status()
        return resp.json()
