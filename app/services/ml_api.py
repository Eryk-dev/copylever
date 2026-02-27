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


_UP_COMPAT_BATCH = 200  # ML limit per request
_RATE_LIMIT_RETRIES = 5
_RATE_LIMIT_BASE_WAIT = 3  # seconds
_COMPAT_PACE = 1.0  # seconds between compat API calls to avoid 429s


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


def _is_user_product_error(resp: httpx.Response) -> bool:
    """Check if the response indicates a User Product compat fallback is needed."""
    if resp.status_code not in (400, 403):
        return False
    try:
        body = resp.json()
    except Exception:
        return False
    msg = str(body.get("message") or body.get("error") or "")
    return "User Product" in msg or "seller of the user product" in msg


async def copy_item_compatibilities(
    seller_slug: str,
    new_item_id: str,
    source_item_id: str,
    source_compat_products: list[dict] | None = None,
) -> dict:
    """POST /items/{id}/compatibilities — copy from source item.

    Falls back to /user-products/{user_product_id}/compatibilities when the
    target item uses User Product compatibilities.  In that case the source
    products must be supplied via *source_compat_products* (pre-fetched by the
    caller with the source seller's token).
    """
    token = await _get_token(seller_slug)
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"item_to_copy": {"item_id": source_item_id, "extended_information": True}}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await _post_with_retry(
            client, f"{ML_API}/items/{new_item_id}/compatibilities", headers, payload,
        )
        if resp.status_code == 404:
            return {}

        # If the target uses User Product compatibilities, retry via that endpoint
        if _is_user_product_error(resp):
            return await _copy_user_product_compatibilities(
                client, token, new_item_id, source_compat_products,
            )

        _raise_for_status(resp, "Mercado Livre API")
        return resp.json()


async def _copy_user_product_compatibilities(
    client: httpx.AsyncClient,
    token: str,
    item_id: str,
    source_products: list[dict] | None,
) -> dict:
    """POST source products to /user-products/…/compatibilities in batches."""
    if not source_products:
        raise MlApiError(
            service_name="Mercado Livre API",
            status_code=400,
            method="POST",
            url=f"{ML_API}/items/{item_id}/compatibilities",
            detail=f"Item {item_id} is a User Product but no source compat products were provided",
        )

    headers = {"Authorization": f"Bearer {token}"}

    # 1. Fetch the target item to get its user_product_id
    item_resp = await client.get(f"{ML_API}/items/{item_id}", headers=headers)
    _raise_for_status(item_resp, "Mercado Livre API")
    user_product_id = item_resp.json().get("user_product_id")
    if not user_product_id:
        raise MlApiError(
            service_name="Mercado Livre API",
            status_code=400,
            method="POST",
            url=f"{ML_API}/items/{item_id}/compatibilities",
            detail=f"Item {item_id} requires User Product compat but has no user_product_id",
        )

    # 2. Format products for the user-products endpoint
    products = [
        {
            "id": p["catalog_product_id"],
            "domain_id": p["domain_id"],
            "restrictions": p.get("restrictions", []),
        }
        for p in source_products
        if p.get("catalog_product_id")
    ]
    if not products:
        return {}

    # 3. POST in batches of 200 with rate-limit pacing
    logger.info(
        "Item %s is User Product %s — copying %d products via /user-products",
        item_id, user_product_id, len(products),
    )
    domain_id = products[0]["domain_id"]
    url = f"{ML_API}/user-products/{user_product_id}/compatibilities"
    total_created = 0
    for i in range(0, len(products), _UP_COMPAT_BATCH):
        if i > 0:
            await asyncio.sleep(_COMPAT_PACE)
        batch = products[i : i + _UP_COMPAT_BATCH]
        resp = await _post_with_retry(
            client, url, headers, {"domain_id": domain_id, "products": batch},
        )
        _raise_for_status(resp, "Mercado Livre API")
        total_created += resp.json().get("created_compatibilities_count", 0)

    return {"created_compatibilities_count": total_created}
