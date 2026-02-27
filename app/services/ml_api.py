"""
Cliente para APIs do Mercado Livre.
Supports per-seller ML app credentials with fallback to global settings.
"""
import asyncio
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


async def get_seller_official_store_id(seller_slug: str) -> int | None:
    """Get the official_store_id for a brand seller by checking one of their existing items."""
    db = get_db()
    seller = db.table("copy_sellers").select("ml_user_id").eq("slug", seller_slug).single().execute()
    user_id = seller.data["ml_user_id"]

    token = await _get_token(seller_slug)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{ML_API}/users/{user_id}/items/search",
            headers={"Authorization": f"Bearer {token}"},
            params={"limit": "1"},
        )
        if resp.status_code != 200:
            return None
        results = resp.json().get("results", [])
        if not results:
            return None
        item_resp = await client.get(
            f"{ML_API}/items/{results[0]}",
            headers={"Authorization": f"Bearer {token}"},
        )
        if item_resp.status_code != 200:
            return None
        return item_resp.json().get("official_store_id")


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


async def update_item(seller_slug: str, item_id: str, payload: dict) -> dict:
    """PUT /items/{item_id} — update existing listing."""
    token = await _get_token(seller_slug)
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.put(
            f"{ML_API}/items/{item_id}",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
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


_RATE_LIMIT_RETRIES = 5
_RATE_LIMIT_BASE_WAIT = 3  # seconds


async def _post_with_retry(
    client: httpx.AsyncClient, url: str, headers: dict, json: dict,
) -> httpx.Response:
    """POST with automatic retry on 429 Too Many Requests."""
    for attempt in range(_RATE_LIMIT_RETRIES):
        resp = await client.post(url, headers=headers, json=json)
        if resp.status_code != 429:
            return resp
        retry_after = resp.headers.get("retry-after")
        wait = int(retry_after) if retry_after and retry_after.isdigit() else _RATE_LIMIT_BASE_WAIT * (2 ** attempt)
        logger.warning("Rate-limited on %s — waiting %ds (attempt %d/%d)", url, wait, attempt + 1, _RATE_LIMIT_RETRIES)
        await asyncio.sleep(wait)
    return resp  # return last 429 response so caller can raise


async def _put_with_retry(
    client: httpx.AsyncClient, url: str, headers: dict, json: dict,
) -> httpx.Response:
    """PUT with automatic retry on 429 Too Many Requests."""
    for attempt in range(_RATE_LIMIT_RETRIES):
        resp = await client.put(url, headers=headers, json=json)
        if resp.status_code != 429:
            return resp
        retry_after = resp.headers.get("retry-after")
        wait = int(retry_after) if retry_after and retry_after.isdigit() else _RATE_LIMIT_BASE_WAIT * (2 ** attempt)
        logger.warning("Rate-limited on %s — waiting %ds (attempt %d/%d)", url, wait, attempt + 1, _RATE_LIMIT_RETRIES)
        await asyncio.sleep(wait)
    return resp  # return last 429 response so caller can raise


async def _copy_user_product_copy_paste(
    client: httpx.AsyncClient,
    headers: dict,
    user_product_id: str,
    category_id: str,
    source_item_id: str,
    source_domain_id: str | None,
    seller_slug: str,
) -> dict:
    """Copy compatibilities via /user-products/{id}/compatibilities/copy-paste endpoint."""
    domain_id = source_domain_id
    if not domain_id:
        source_compat = await get_item_compatibilities(seller_slug, source_item_id)
        if source_compat and source_compat.get("products"):
            domain_id = source_compat["products"][0].get("domain_id")
        if not domain_id:
            raise MlApiError(
                service_name="Mercado Livre API",
                status_code=400,
                method="POST",
                url=f"{ML_API}/user-products/{user_product_id}/compatibilities/copy-paste",
                detail=f"Cannot determine domain_id for User Product copy-paste (source: {source_item_id})",
            )

    url = f"{ML_API}/user-products/{user_product_id}/compatibilities/copy-paste"
    body = {
        "domain_id": domain_id,
        "category_id": category_id,
        "item_id": source_item_id,
        "extended_information": True,
    }
    logger.info(
        "User Product copy-paste %s → UP %s (domain=%s, category=%s)",
        source_item_id, user_product_id, domain_id, category_id,
    )
    resp = await _post_with_retry(client, url, headers, body)
    _raise_for_status(resp, "Mercado Livre API")
    return resp.json()


async def copy_item_compatibilities(
    seller_slug: str,
    new_item_id: str,
    source_item_id: str,
    source_compat_products: list[dict] | None = None,
    mode: str = "add",
    source_domain_id: str | None = None,
) -> dict:
    """Copy compatibilities from source item to destination.

    Uses POST when the destination has no compatibilities, and PUT when it does.
    mode='add' appends to existing compats; mode='replace' deletes then creates.

    Pre-detects User Product items and uses /copy-paste endpoint for them.
    """
    token = await _get_token(seller_slug)
    headers = {"Authorization": f"Bearer {token}"}

    # Pre-detect User Product items via dest item info
    dest_item = await get_item(seller_slug, new_item_id)
    user_product_id = dest_item.get("user_product_id")

    if user_product_id:
        async with httpx.AsyncClient(timeout=30.0) as client:
            return await _copy_user_product_copy_paste(
                client, headers, user_product_id,
                dest_item.get("category_id", ""),
                source_item_id, source_domain_id, seller_slug,
            )

    url = f"{ML_API}/items/{new_item_id}/compatibilities"
    copy_body = {"item_to_copy": {"item_id": source_item_id, "extended_information": True}}

    # Check if destination already has compatibilities
    dest_compat = await get_item_compatibilities(seller_slug, new_item_id)
    has_existing = dest_compat is not None and bool(dest_compat.get("products"))

    async with httpx.AsyncClient(timeout=30.0) as client:
        if has_existing:
            # Destination has compats → use PUT
            put_body: dict = {"create": copy_body}
            if mode == "replace":
                product_ids = [
                    p["catalog_product_id"]
                    for p in dest_compat.get("products", [])  # type: ignore[union-attr]
                    if p.get("catalog_product_id")
                ]
                if product_ids:
                    put_body["delete"] = {"product_ids": product_ids}
            logger.info("Compat copy %s → %s: using PUT (mode=%s, existing=%d products)", source_item_id, new_item_id, mode, len(dest_compat.get("products", [])))  # type: ignore[union-attr]
            resp = await _put_with_retry(client, url, headers, put_body)
        else:
            # No existing compats → use POST
            logger.info("Compat copy %s → %s: using POST (no existing compats)", source_item_id, new_item_id)
            resp = await _post_with_retry(client, url, headers, copy_body)

        if resp.status_code == 404:
            return {}

        _raise_for_status(resp, "Mercado Livre API")
        return resp.json()


