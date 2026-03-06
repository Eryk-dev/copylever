"""
Cliente para APIs da Shopee Open Platform v2.
HMAC-SHA256 request signing, per-shop token management.
"""
import asyncio
import hashlib
import hmac
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import settings
from app.db.supabase import get_db

SHOPEE_API_PROD = "https://partner.shopeemobile.com"
SHOPEE_API_SANDBOX = "https://partner.test-stable.shopeemobile.com"

logger = logging.getLogger(__name__)

# Per-shop locks to prevent concurrent token refreshes
_token_locks: dict[int, asyncio.Lock] = {}

_RATE_LIMIT_RETRIES = 5
_RATE_LIMIT_BASE_WAIT = 2  # seconds


def _get_shop_lock(shop_id: int) -> asyncio.Lock:
    return _token_locks.setdefault(shop_id, asyncio.Lock())


def _base_url() -> str:
    return SHOPEE_API_SANDBOX if settings.shopee_sandbox else SHOPEE_API_PROD


def _sign(path: str, timestamp: int, access_token: str = "", shop_id: int = 0) -> str:
    """Generate HMAC-SHA256 signature for Shopee API request.

    Public API: sign = HMAC(partner_key, partner_id + path + timestamp)
    Shop API:   sign = HMAC(partner_key, partner_id + path + timestamp + access_token + shop_id)
    """
    base = f"{settings.shopee_partner_id}{path}{timestamp}"
    if access_token and shop_id:
        base += f"{access_token}{shop_id}"
    return hmac.new(
        settings.shopee_partner_key.encode(),
        base.encode(),
        hashlib.sha256,
    ).hexdigest()


class ShopeeApiError(RuntimeError):
    """Structured Shopee API error."""

    def __init__(
        self,
        status_code: int,
        method: str,
        url: str,
        error_code: str = "",
        message: str = "",
        payload: Any = None,
    ) -> None:
        self.status_code = status_code
        self.method = method
        self.url = url
        self.error_code = error_code
        self.message = message
        self.payload = payload
        detail = f"{error_code}: {message}" if error_code else message
        super().__init__(f"Shopee {status_code} {method} {url}: {detail}")


def _extract_shopee_error(resp: httpx.Response) -> tuple[str, str, Any]:
    """Parse Shopee error response. Returns (error_code, message, payload)."""
    try:
        payload = resp.json()
    except ValueError:
        return "", resp.text[:600], None

    if isinstance(payload, dict):
        error = payload.get("error", "")
        message = payload.get("message", "") or payload.get("msg", "")
        return str(error), str(message), payload

    return "", str(payload)[:600], payload


def _raise_for_shopee(resp: httpx.Response) -> None:
    """Check Shopee response for errors. Shopee returns 200 with error field."""
    try:
        body = resp.json()
    except ValueError:
        if resp.status_code >= 400:
            raise ShopeeApiError(
                status_code=resp.status_code,
                method=resp.request.method,
                url=str(resp.request.url),
                message=resp.text[:600],
            )
        return

    # Shopee returns HTTP 200 with an "error" field for API errors
    error = body.get("error", "")
    if error and error != "":
        message = body.get("message", "") or body.get("msg", "")
        raise ShopeeApiError(
            status_code=resp.status_code,
            method=resp.request.method,
            url=str(resp.request.url),
            error_code=error,
            message=message,
            payload=body,
        )

    # Also check HTTP status
    if resp.status_code >= 400:
        error_code, message, payload = _extract_shopee_error(resp)
        raise ShopeeApiError(
            status_code=resp.status_code,
            method=resp.request.method,
            url=str(resp.request.url),
            error_code=error_code,
            message=message,
            payload=payload,
        )


# ── Auth ────────────────────────────────────────────────────


def generate_auth_url(redirect_url: str, state: str = "") -> str:
    """Generate Shopee OAuth authorization URL."""
    path = "/api/v2/shop/auth_partner"
    ts = int(time.time())
    sign = _sign(path, ts)
    base = _base_url()
    url = (
        f"{base}{path}"
        f"?partner_id={settings.shopee_partner_id}"
        f"&timestamp={ts}"
        f"&sign={sign}"
        f"&redirect={redirect_url}"
    )
    if state:
        url += f"&state={state}"
    return url


async def exchange_code(code: str, shop_id: int) -> dict:
    """Exchange authorization code for access + refresh tokens."""
    path = "/api/v2/auth/token/get"
    ts = int(time.time())
    sign = _sign(path, ts)
    base = _base_url()

    body = {
        "code": code,
        "shop_id": shop_id,
        "partner_id": settings.shopee_partner_id,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{base}{path}",
            params={
                "partner_id": settings.shopee_partner_id,
                "timestamp": ts,
                "sign": sign,
            },
            json=body,
        )
        _raise_for_shopee(resp)
        return resp.json()


async def refresh_access_token(refresh_token_value: str, shop_id: int) -> dict:
    """Refresh an expired access token."""
    path = "/api/v2/auth/access_token/get"
    ts = int(time.time())
    sign = _sign(path, ts)
    base = _base_url()

    body = {
        "refresh_token": refresh_token_value,
        "shop_id": shop_id,
        "partner_id": settings.shopee_partner_id,
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{base}{path}",
            params={
                "partner_id": settings.shopee_partner_id,
                "timestamp": ts,
                "sign": sign,
            },
            json=body,
        )
        _raise_for_shopee(resp)
        return resp.json()


async def fetch_shop_info(access_token: str, shop_id: int) -> dict:
    """GET /api/v2/shop/get_shop_info — returns shop profile."""
    return await _shop_get("/api/v2/shop/get_shop_info", access_token, shop_id)


# ── Token management ───────────────────────────────────────


async def _get_token(shop_id: int, org_id: str) -> str:
    """Get access_token for shop. Auto-refresh if expired.

    Uses a per-shop lock to prevent concurrent refreshes.
    """
    db = get_db()
    result = db.table("shopee_sellers").select(
        "access_token, refresh_token, token_expires_at, refresh_token_expires_at, active"
    ).eq("shop_id", shop_id).eq("org_id", org_id).execute()

    if not result.data:
        raise RuntimeError(f"Shopee shop '{shop_id}' not found")

    s = result.data[0]

    if not s.get("active"):
        raise RuntimeError(f"Shopee shop '{shop_id}' is disconnected. Reconnect via /api/shopee/install")

    expires_at = datetime.fromisoformat(s["token_expires_at"]) if s.get("token_expires_at") else None
    if expires_at and expires_at > datetime.now(timezone.utc):
        return s["access_token"]

    # Token expired — acquire per-shop lock before refreshing
    lock = _get_shop_lock(shop_id)
    try:
        await asyncio.wait_for(lock.acquire(), timeout=30)
    except asyncio.TimeoutError:
        raise RuntimeError(f"Timeout waiting for token refresh lock for shop '{shop_id}'")

    try:
        # Double-check after acquiring lock
        result2 = db.table("shopee_sellers").select(
            "access_token, refresh_token, token_expires_at, refresh_token_expires_at, active"
        ).eq("shop_id", shop_id).eq("org_id", org_id).execute()

        if not result2.data:
            raise RuntimeError(f"Shopee shop '{shop_id}' not found")

        s = result2.data[0]
        expires_at = datetime.fromisoformat(s["token_expires_at"]) if s.get("token_expires_at") else None
        if expires_at and expires_at > datetime.now(timezone.utc):
            return s["access_token"]

        # Check refresh token validity
        old_refresh = s.get("refresh_token")
        if not old_refresh:
            raise RuntimeError(f"Shopee shop '{shop_id}' has no refresh_token. Reconnect via /api/shopee/install")

        rt_expires = datetime.fromisoformat(s["refresh_token_expires_at"]) if s.get("refresh_token_expires_at") else None
        if rt_expires and rt_expires <= datetime.now(timezone.utc):
            logger.warning("Refresh token expired for shop %d — clearing tokens", shop_id)
            db.table("shopee_sellers").update({
                "access_token": None,
                "refresh_token": None,
                "token_expires_at": None,
                "refresh_token_expires_at": None,
            }).eq("shop_id", shop_id).eq("org_id", org_id).execute()
            raise RuntimeError(
                f"Shopee shop '{shop_id}': refresh token expirado. "
                f"Reconecte via /api/shopee/install"
            )

        # Do the refresh
        data = await refresh_access_token(old_refresh, shop_id)

        new_access = data.get("access_token")
        new_refresh = data.get("refresh_token")
        expire_in = data.get("expire_in", 14400)  # 4 hours default
        new_expires = datetime.now(timezone.utc) + timedelta(seconds=expire_in)

        # Shopee refresh tokens last ~30 days from original grant
        update_data: dict[str, Any] = {
            "access_token": new_access,
            "token_expires_at": new_expires.isoformat(),
        }
        if new_refresh:
            update_data["refresh_token"] = new_refresh

        db.table("shopee_sellers").update(update_data).eq(
            "shop_id", shop_id
        ).eq("org_id", org_id).execute()

        return new_access
    finally:
        lock.release()


# ── HTTP helpers ────────────────────────────────────────────


async def _shop_get(
    path: str,
    access_token: str,
    shop_id: int,
    extra_params: dict | None = None,
) -> dict:
    """Signed GET request to a shop-level Shopee API."""
    ts = int(time.time())
    sign = _sign(path, ts, access_token, shop_id)
    base = _base_url()
    params = {
        "partner_id": settings.shopee_partner_id,
        "timestamp": ts,
        "sign": sign,
        "access_token": access_token,
        "shop_id": shop_id,
    }
    if extra_params:
        params.update(extra_params)

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{base}{path}", params=params)
        _raise_for_shopee(resp)
        return resp.json()


async def _shop_post(
    path: str,
    access_token: str,
    shop_id: int,
    body: dict,
    extra_params: dict | None = None,
    timeout: float = 30.0,
) -> dict:
    """Signed POST request to a shop-level Shopee API."""
    ts = int(time.time())
    sign = _sign(path, ts, access_token, shop_id)
    base = _base_url()
    params = {
        "partner_id": settings.shopee_partner_id,
        "timestamp": ts,
        "sign": sign,
        "access_token": access_token,
        "shop_id": shop_id,
    }
    if extra_params:
        params.update(extra_params)

    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(f"{base}{path}", params=params, json=body)
        _raise_for_shopee(resp)
        return resp.json()


# ── Shop-level API wrappers ─────────────────────────────────


async def get_item(shop_id: int, item_id: int, org_id: str) -> dict:
    """GET /api/v2/product/get_item_base_info"""
    token = await _get_token(shop_id, org_id)
    return await _shop_get(
        "/api/v2/product/get_item_base_info",
        token,
        shop_id,
        extra_params={"item_id_list": str(item_id)},
    )


async def get_item_extra(shop_id: int, item_id: int, org_id: str) -> dict:
    """GET /api/v2/product/get_item_extra_info"""
    token = await _get_token(shop_id, org_id)
    return await _shop_get(
        "/api/v2/product/get_item_extra_info",
        token,
        shop_id,
        extra_params={"item_id_list": str(item_id)},
    )


async def get_model_list(shop_id: int, item_id: int, org_id: str) -> dict:
    """GET /api/v2/product/get_model_list — variations/models for an item."""
    token = await _get_token(shop_id, org_id)
    return await _shop_get(
        "/api/v2/product/get_model_list",
        token,
        shop_id,
        extra_params={"item_id": item_id},
    )


async def get_item_list(shop_id: int, org_id: str, offset: int = 0, page_size: int = 50) -> dict:
    """GET /api/v2/product/get_item_list — paginated item listing."""
    token = await _get_token(shop_id, org_id)
    return await _shop_get(
        "/api/v2/product/get_item_list",
        token,
        shop_id,
        extra_params={
            "offset": offset,
            "page_size": page_size,
            "item_status": "NORMAL",
        },
    )


async def get_categories(shop_id: int, org_id: str, language: str = "pt-BR") -> dict:
    """GET /api/v2/product/get_category — category tree."""
    token = await _get_token(shop_id, org_id)
    return await _shop_get(
        "/api/v2/product/get_category",
        token,
        shop_id,
        extra_params={"language": language},
    )


async def get_logistics_channels(shop_id: int, org_id: str) -> dict:
    """GET /api/v2/logistics/get_channel_list — available logistics."""
    token = await _get_token(shop_id, org_id)
    return await _shop_get(
        "/api/v2/logistics/get_channel_list",
        token,
        shop_id,
    )


async def upload_image(shop_id: int, image_url: str, org_id: str) -> dict:
    """POST /api/v2/media_space/upload_image — upload image by URL.

    Returns {"image_info": {"image_id": "..."}} on success.
    """
    token = await _get_token(shop_id, org_id)
    path = "/api/v2/media_space/upload_image"
    ts = int(time.time())
    sign = _sign(path, ts, token, shop_id)
    base = _base_url()
    params = {
        "partner_id": settings.shopee_partner_id,
        "timestamp": ts,
        "sign": sign,
        "access_token": token,
        "shop_id": shop_id,
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            f"{base}{path}",
            params=params,
            data={"url": image_url},
        )
        _raise_for_shopee(resp)
        return resp.json()


async def add_item(shop_id: int, payload: dict, org_id: str) -> dict:
    """POST /api/v2/product/add_item — create new product listing."""
    token = await _get_token(shop_id, org_id)
    return await _shop_post(
        "/api/v2/product/add_item",
        token,
        shop_id,
        payload,
        timeout=60.0,
    )


async def update_item(shop_id: int, item_id: int, payload: dict, org_id: str) -> dict:
    """POST /api/v2/product/update_item — update existing product."""
    token = await _get_token(shop_id, org_id)
    payload["item_id"] = item_id
    return await _shop_post(
        "/api/v2/product/update_item",
        token,
        shop_id,
        payload,
    )
