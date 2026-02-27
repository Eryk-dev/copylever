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

logger = logging.getLogger(__name__)


class MlApiError(RuntimeError):
    """Structured Mercado Livre/Mercado Pago HTTP error."""

    def __init__(
        self,
        service_name: str,
        status_code: int,
        method: str,
        url: str,
        detail: str,
        payload: Any = None,
    ) -> None:
        self.service_name = service_name
        self.status_code = status_code
        self.method = method
        self.url = url
        self.detail = detail
        self.payload = payload
        super().__init__(f"{service_name} {status_code} {method} {url}: {detail}")


def _extract_api_error(resp: httpx.Response) -> tuple[str, Any]:
    """Parse structured API errors (ML/MP) into a concise message."""
    try:
        payload = resp.json()
    except ValueError:
        text = (resp.text or "").strip()
        if text:
            return text[:600], None
        return f"{resp.status_code} {resp.reason_phrase}", None

    if isinstance(payload, dict):
        parts: list[str] = []
        error = payload.get("error")
        message = (
            payload.get("message")
            or payload.get("error_description")
            or payload.get("detail")
        )
        if error:
            parts.append(str(error))
        if message and str(message) not in parts:
            parts.append(str(message))

        causes = payload.get("cause")
        if isinstance(causes, list):
            cause_parts = []
            for cause in causes:
                if isinstance(cause, dict):
                    code = cause.get("code")
                    cause_msg = cause.get("message") or cause.get("description")
                    if code and cause_msg:
                        cause_parts.append(f"{code}: {cause_msg}")
                    elif cause_msg:
                        cause_parts.append(str(cause_msg))
                    elif code:
                        cause_parts.append(str(code))
                elif cause:
                    cause_parts.append(str(cause))
            if cause_parts:
                parts.append(" | ".join(cause_parts))

        if parts:
            return "; ".join(parts), payload

    return str(payload)[:600], payload


def _raise_for_status(resp: httpx.Response, service_name: str) -> None:
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        method = resp.request.method if resp.request else "?"
        url = str(resp.request.url) if resp.request else "?"
        detail, payload = _extract_api_error(resp)
        raise MlApiError(
            service_name=service_name,
            status_code=resp.status_code,
            method=method,
            url=url,
            detail=detail,
            payload=payload,
        ) from exc


def _get_seller_credentials(seller: dict) -> tuple[str, str]:
    from app.config import settings
    app_id = seller.get("ml_app_id") or settings.ml_app_id
    secret = seller.get("ml_secret_key") or settings.ml_secret_key
    return app_id, secret


async def _get_token(seller_slug: str) -> str:
    """Get access_token for seller. Auto-refresh if expired."""
    db = get_db()
    result = db.table("copy_sellers").select(
        "ml_access_token, ml_refresh_token, ml_token_expires_at, ml_app_id, ml_secret_key, active"
    ).eq("slug", seller_slug).execute()

    if not result.data:
        raise RuntimeError(f"Seller '{seller_slug}' not found")

    s = result.data[0]

    if not s.get("active"):
        raise RuntimeError(f"Seller '{seller_slug}' is disconnected. Reconnect via /api/ml/install")

    expires_at = datetime.fromisoformat(s["ml_token_expires_at"]) if s.get("ml_token_expires_at") else None
    if expires_at and expires_at > datetime.now(timezone.utc):
        return s["ml_access_token"]

    # Refresh token
    old_refresh = s["ml_refresh_token"]
    if not old_refresh:
        raise RuntimeError(f"Seller '{seller_slug}' has no refresh_token. Reconnect via /api/ml/install")

    app_id, secret = _get_seller_credentials(s)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{ML_API}/oauth/token", data={
            "grant_type": "refresh_token",
            "client_id": app_id,
            "client_secret": secret,
            "refresh_token": old_refresh,
        })
        _raise_for_status(resp, "Mercado Livre API")
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
        resp = await client.post(f"{ML_API}/oauth/token", data={
            "grant_type": "authorization_code",
            "client_id": settings.ml_app_id,
            "client_secret": settings.ml_secret_key,
            "code": code,
            "redirect_uri": settings.ml_redirect_uri,
        })
        _raise_for_status(resp, "Mercado Livre API")
        return resp.json()


async def fetch_user_info(access_token: str) -> dict:
    """GET /users/me — returns ML user profile."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{ML_API}/users/me",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        _raise_for_status(resp, "Mercado Livre API")
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
        _raise_for_status(resp, "Mercado Livre API")
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
        _raise_for_status(resp, "Mercado Livre API")
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
        _raise_for_status(resp, "Mercado Livre API")
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
        _raise_for_status(resp, "Mercado Livre API")
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
        _raise_for_status(resp, "Mercado Livre API")
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
        _raise_for_status(resp, "Mercado Livre API")
        return resp.json()


async def search_items_by_sku(seller_slug: str, sku: str) -> list[str]:
    """GET /users/{user_id}/items/search with seller_sku and sku params."""
    db = get_db()
    seller = db.table("copy_sellers").select("ml_user_id").eq("slug", seller_slug).single().execute()
    user_id = seller.data["ml_user_id"]

    token = await _get_token(seller_slug)
    item_ids: set[str] = set()
    async with httpx.AsyncClient(timeout=30.0) as client:
        for params in ({"seller_sku": sku}, {"sku": sku}):
            resp = await client.get(
                f"{ML_API}/users/{user_id}/items/search",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
            )
            if resp.status_code == 404:
                continue
            _raise_for_status(resp, "Mercado Livre API")
            for item_id in resp.json().get("results", []):
                if item_id:
                    item_ids.add(item_id)
    return list(item_ids)


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
        _raise_for_status(resp, "Mercado Livre API")
        return resp.json()
