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
MP_API = "https://api.mercadopago.com"

logger = logging.getLogger(__name__)

# Per-seller locks to prevent concurrent token refreshes from invalidating each other
_token_locks: dict[str, asyncio.Lock] = {}

# ── Shared HTTP client (connection pooling) ───────────────
_ml_http_client: httpx.AsyncClient | None = None


def _get_ml_client() -> httpx.AsyncClient:
    """Return the shared httpx.AsyncClient, creating it on first call.

    Using a persistent client enables TCP/TLS connection reuse across
    requests, eliminating redundant handshakes for multi-item copy operations.
    """
    global _ml_http_client
    if _ml_http_client is None:
        _ml_http_client = httpx.AsyncClient(
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
            timeout=httpx.Timeout(30.0, connect=10.0),
        )
    return _ml_http_client


async def close_ml_client() -> None:
    """Close the shared ML HTTP client (call on app shutdown)."""
    global _ml_http_client
    if _ml_http_client is not None:
        await _ml_http_client.aclose()
        _ml_http_client = None


# ── In-memory token cache ─────────────────────────────────
# Maps "{org_id}:{seller_slug}" -> (access_token, expires_at)
_token_cache: dict[str, tuple[str, datetime]] = {}
_TOKEN_CACHE_MARGIN = timedelta(minutes=5)  # refresh token 5 min before actual expiry


def _get_seller_lock(seller_slug: str) -> asyncio.Lock:
    """Return (or create) an asyncio.Lock for the given seller."""
    if seller_slug not in _token_locks:
        _token_locks[seller_slug] = asyncio.Lock()
    return _token_locks[seller_slug]


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


# ── Generic ML request with 429 retry ────────────────────

_REQUEST_RATE_RETRIES = 5
_REQUEST_RATE_BASE_WAIT = 3  # seconds
_REQUEST_RATE_MAX_WAIT = 30  # seconds — cap individual backoff waits


async def _ml_request(
    method: str,
    url: str,
    token: str,
    json: dict | None = None,
    params: dict | None = None,
    timeout: float = 30.0,
) -> httpx.Response:
    """Make an ML API request with automatic 429 retry + exponential backoff.

    Uses a shared persistent HTTP client to reuse TCP/TLS connections.
    The timeout parameter is applied per-request so callers can override it
    (e.g. POST /items uses 60s).
    """
    headers = {"Authorization": f"Bearer {token}"}
    client = _get_ml_client()
    resp: httpx.Response | None = None
    for attempt in range(_REQUEST_RATE_RETRIES):
        resp = await client.request(
            method, url, headers=headers, json=json, params=params,
            timeout=timeout,
        )
        if resp.status_code != 429:
            return resp
        retry_after = resp.headers.get("retry-after")
        wait = min(
            int(retry_after) if retry_after and str(retry_after).isdigit()
            else _REQUEST_RATE_BASE_WAIT * (2 ** attempt),
            _REQUEST_RATE_MAX_WAIT,
        )
        logger.warning(
            "ML rate-limited (429) on %s %s — waiting %ds (attempt %d/%d)",
            method, url, wait, attempt + 1, _REQUEST_RATE_RETRIES,
        )
        await asyncio.sleep(wait)
    return resp  # type: ignore[return-value]


def _get_seller_credentials(seller: dict) -> tuple[str, str]:
    from app.config import settings
    app_id = seller.get("ml_app_id") or settings.ml_app_id
    secret = seller.get("ml_secret_key") or settings.ml_secret_key
    return app_id, secret


async def _get_token(seller_slug: str, org_id: str) -> str:
    """Get access_token for seller. Auto-refresh if expired.

    Uses an in-memory cache to avoid hitting Supabase on every API call.
    Falls back to a DB read on cache miss or near-expiry.

    Uses a per-seller lock so concurrent requests don't race to refresh
    the same token (which would invalidate the refresh_token and disconnect
    the seller).
    """
    cache_key = f"{org_id}:{seller_slug}"

    # Fast path: return cached token if it has more than 5 minutes remaining
    if cache_key in _token_cache:
        cached_token, cached_expires_at = _token_cache[cache_key]
        if datetime.now(timezone.utc) < cached_expires_at - _TOKEN_CACHE_MARGIN:
            return cached_token

    # Cache miss or token nearing expiry — hit database
    db = get_db()
    result = db.table("copy_sellers").select(
        "ml_access_token, ml_refresh_token, ml_token_expires_at, ml_app_id, ml_secret_key, active"
    ).eq("slug", seller_slug).eq("org_id", org_id).execute()

    if not result.data:
        raise RuntimeError(f"Seller '{seller_slug}' not found")

    s = result.data[0]

    if not s.get("active"):
        raise RuntimeError(f"Seller '{seller_slug}' is disconnected. Reconnect via /api/ml/install")

    expires_at = datetime.fromisoformat(s["ml_token_expires_at"]) if s.get("ml_token_expires_at") else None
    if expires_at and expires_at > datetime.now(timezone.utc):
        # Token is valid — populate cache and return
        _token_cache[cache_key] = (s["ml_access_token"], expires_at)
        return s["ml_access_token"]

    # Token expired — acquire per-seller lock before refreshing
    lock = _get_seller_lock(seller_slug)
    try:
        await asyncio.wait_for(lock.acquire(), timeout=30)
    except asyncio.TimeoutError:
        raise RuntimeError(f"Timeout waiting for token refresh lock for seller '{seller_slug}'")

    try:
        # Double-check: another coroutine may have refreshed while we waited
        result2 = db.table("copy_sellers").select(
            "ml_access_token, ml_refresh_token, ml_token_expires_at, ml_app_id, ml_secret_key, active"
        ).eq("slug", seller_slug).eq("org_id", org_id).execute()

        if not result2.data:
            raise RuntimeError(f"Seller '{seller_slug}' not found")

        s = result2.data[0]
        expires_at = datetime.fromisoformat(s["ml_token_expires_at"]) if s.get("ml_token_expires_at") else None
        if expires_at and expires_at > datetime.now(timezone.utc):
            # Another coroutine already refreshed — update cache and return
            _token_cache[cache_key] = (s["ml_access_token"], expires_at)
            return s["ml_access_token"]

        # Still expired — do the refresh
        old_refresh = s["ml_refresh_token"]
        if not old_refresh:
            raise RuntimeError(f"Seller '{seller_slug}' has no refresh_token. Reconnect via /api/ml/install")

        app_id, secret = _get_seller_credentials(s)
        client = _get_ml_client()
        resp = await client.post(f"{MP_API}/oauth/token", json={
            "grant_type": "refresh_token",
            "client_id": app_id,
            "client_secret": secret,
            "refresh_token": old_refresh,
        }, timeout=30.0)

        if resp.status_code in (400, 401):
            logger.warning("Refresh token invalid/revoked for seller '%s' — clearing tokens", seller_slug)
            db.table("copy_sellers").update({
                "ml_access_token": None,
                "ml_refresh_token": None,
                "ml_token_expires_at": None,
            }).eq("slug", seller_slug).eq("org_id", org_id).execute()
            # Evict stale cache entry
            _token_cache.pop(cache_key, None)
            raise RuntimeError(
                f"Seller '{seller_slug}': refresh token inválido ou revogado. "
                f"Reconecte via /api/ml/install"
            )

        _raise_for_status(resp, "Mercado Livre API")
        data = resp.json()

        new_expires = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 21600))
        db.table("copy_sellers").update({
            "ml_access_token": data["access_token"],
            "ml_refresh_token": data["refresh_token"],
            "ml_token_expires_at": new_expires.isoformat(),
        }).eq("slug", seller_slug).eq("org_id", org_id).execute()

        # Update cache with freshly refreshed token
        _token_cache[cache_key] = (data["access_token"], new_expires)
        return data["access_token"]
    finally:
        lock.release()


async def exchange_code(code: str, org_id: str = "") -> dict:
    """Exchange authorization_code for access_token + refresh_token."""
    from app.config import settings
    client = _get_ml_client()
    resp = await client.post(f"{MP_API}/oauth/token", json={
        "grant_type": "authorization_code",
        "client_id": settings.ml_app_id,
        "client_secret": settings.ml_secret_key,
        "code": code,
        "redirect_uri": settings.ml_redirect_uri,
    }, timeout=30.0)
    _raise_for_status(resp, "Mercado Livre API")
    return resp.json()


async def fetch_user_info(access_token: str, org_id: str = "") -> dict:
    """GET /users/me — returns ML user profile."""
    client = _get_ml_client()
    resp = await client.get(
        f"{ML_API}/users/me",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=30.0,
    )
    _raise_for_status(resp, "Mercado Livre API")
    return resp.json()


async def get_seller_official_store_id(seller_slug: str, org_id: str) -> int | None:
    """Get the official_store_id for a brand seller.

    Checks cached value in copy_sellers first; if not cached, searches
    the seller's items (up to 20) and caches the result.
    """
    db = get_db()
    seller = db.table("copy_sellers").select("ml_user_id, official_store_id").eq("slug", seller_slug).eq("org_id", org_id).single().execute()
    user_id = seller.data["ml_user_id"]

    # Return cached value if available
    cached = seller.data.get("official_store_id")
    if cached:
        return cached

    token = await _get_token(seller_slug, org_id)
    client = _get_ml_client()
    resp = await client.get(
        f"{ML_API}/users/{user_id}/items/search",
        headers={"Authorization": f"Bearer {token}"},
        params={"status": "active", "limit": "5"},
        timeout=30.0,
    )
    if resp.status_code != 200:
        logger.warning("Items search failed for %s (status %d)", seller_slug, resp.status_code)
        return None
    results = resp.json().get("results", [])
    if not results:
        logger.warning("No active items found for seller %s — cannot resolve official_store_id", seller_slug)
        return None

    for item_id in results:
        item_resp = await client.get(
            f"{ML_API}/items/{item_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30.0,
        )
        if item_resp.status_code != 200:
            continue
        osi = item_resp.json().get("official_store_id")
        if osi:
            # Cache in DB for future use
            try:
                db.table("copy_sellers").update({"official_store_id": osi}).eq("slug", seller_slug).eq("org_id", org_id).execute()
            except Exception:
                pass
            logger.info("Found official_store_id=%d for %s (from item %s)", osi, seller_slug, item_id)
            return osi

    logger.warning("No item with official_store_id found for %s (checked %d items)", seller_slug, len(results))
    return None


# ── Item operations ──────────────────────────────────────


async def get_item_public(item_id: str) -> dict | None:
    """GET /items/{item_id} — public (no auth). Returns item dict or None on error."""
    client = _get_ml_client()
    try:
        resp = await client.get(f"{ML_API}/items/{item_id}", timeout=15.0)
        if resp.status_code == 200:
            return resp.json()
    except Exception:
        pass
    return None


async def get_items_public(item_ids: list[str]) -> list[dict]:
    """GET /items?ids=... — public multi-get (up to 20 per call). Returns list of item dicts."""
    client = _get_ml_client()
    results: list[dict] = []
    # ML allows up to 20 IDs per multi-get call
    for i in range(0, len(item_ids), 20):
        batch = item_ids[i:i + 20]
        ids_param = ",".join(batch)
        try:
            resp = await client.get(
                f"{ML_API}/items",
                params={"ids": ids_param},
                timeout=15.0,
            )
            if resp.status_code == 200:
                for entry in resp.json():
                    if entry.get("code") == 200 and entry.get("body"):
                        results.append(entry["body"])
        except Exception:
            logger.warning("Failed to fetch items batch: %s", ids_param[:80])
    return results


async def get_item(seller_slug: str, item_id: str, org_id: str = "") -> dict:
    """GET /items/{item_id} — full item data (with 429 retry)."""
    token = await _get_token(seller_slug, org_id)
    resp = await _ml_request(
        "GET",
        f"{ML_API}/items/{item_id}",
        token,
        params={"include_attributes": "all"},
    )
    _raise_for_status(resp, "Mercado Livre API")
    return resp.json()


async def get_item_description(seller_slug: str, item_id: str, org_id: str = "") -> dict:
    """GET /items/{item_id}/description — item description (with 429 retry)."""
    token = await _get_token(seller_slug, org_id)
    resp = await _ml_request("GET", f"{ML_API}/items/{item_id}/description", token)
    if resp.status_code == 404:
        return {}
    _raise_for_status(resp, "Mercado Livre API")
    return resp.json()


async def get_item_compatibilities(seller_slug: str, item_id: str, org_id: str = "") -> dict | None:
    """GET /items/{item_id}/compatibilities?extended=true (with 429 retry)."""
    token = await _get_token(seller_slug, org_id)
    resp = await _ml_request("GET", f"{ML_API}/items/{item_id}/compatibilities", token, params={"extended": "true"})
    if resp.status_code == 404:
        return None
    _raise_for_status(resp, "Mercado Livre API")
    return resp.json()


async def create_item(seller_slug: str, payload: dict, org_id: str = "") -> dict:
    """POST /items — create new listing (with 429 retry)."""
    token = await _get_token(seller_slug, org_id)
    resp = await _ml_request("POST", f"{ML_API}/items", token, json=payload, timeout=60.0)
    _raise_for_status(resp, "Mercado Livre API")
    return resp.json()


async def set_item_description(seller_slug: str, item_id: str, plain_text: str, org_id: str = "") -> dict:
    """POST /items/{item_id}/description — set description (with 429 retry)."""
    token = await _get_token(seller_slug, org_id)
    resp = await _ml_request("POST", f"{ML_API}/items/{item_id}/description", token, json={"plain_text": plain_text})
    _raise_for_status(resp, "Mercado Livre API")
    return resp.json()


async def set_item_compatibilities(seller_slug: str, item_id: str, compat_data: dict, org_id: str = "") -> dict:
    """POST /items/{item_id}/compatibilities — set compatibilities (with 429 retry)."""
    token = await _get_token(seller_slug, org_id)
    resp = await _ml_request("POST", f"{ML_API}/items/{item_id}/compatibilities", token, json=compat_data)
    _raise_for_status(resp, "Mercado Livre API")
    return resp.json()


async def update_item(seller_slug: str, item_id: str, payload: dict, org_id: str = "") -> dict:
    """PUT /items/{item_id} — update existing listing (with 429 retry)."""
    token = await _get_token(seller_slug, org_id)
    resp = await _ml_request("PUT", f"{ML_API}/items/{item_id}", token, json=payload)
    _raise_for_status(resp, "Mercado Livre API")
    return resp.json()


async def search_items_by_sku(seller_slug: str, sku: str, org_id: str = "") -> list[str]:
    """GET /users/{user_id}/items/search with seller_sku and sku params."""
    db = get_db()
    seller = db.table("copy_sellers").select("ml_user_id").eq("slug", seller_slug).eq("org_id", org_id).single().execute()
    user_id = seller.data["ml_user_id"]

    token = await _get_token(seller_slug, org_id)
    item_ids: set[str] = set()
    client = _get_ml_client()
    for params in ({"seller_sku": sku}, {"sku": sku}):
        resp = await client.get(
            f"{ML_API}/users/{user_id}/items/search",
            headers={"Authorization": f"Bearer {token}"},
            params=params,
            timeout=30.0,
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
_RATE_LIMIT_MAX_WAIT = 30  # seconds — cap individual backoff waits
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
        wait = min(
            int(retry_after) if retry_after and retry_after.isdigit()
            else _RATE_LIMIT_BASE_WAIT * (2 ** attempt),
            _RATE_LIMIT_MAX_WAIT,
        )
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
    org_id: str = "",
) -> dict:
    """POST /items/{id}/compatibilities — copy from source item.

    Falls back to /user-products/{user_product_id}/compatibilities when the
    target item uses User Product compatibilities.  In that case the source
    products must be supplied via *source_compat_products* (pre-fetched by the
    caller with the source seller's token).
    """
    token = await _get_token(seller_slug, org_id)
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"item_to_copy": {"item_id": source_item_id, "extended_information": True}}
    client = _get_ml_client()
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
    item_resp = await client.get(f"{ML_API}/items/{item_id}", headers=headers, timeout=30.0)
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
