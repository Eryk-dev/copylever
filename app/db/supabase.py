import asyncio
import base64
import json
import logging
from functools import partial

from supabase import create_client, Client

from app.config import settings

_client: Client | None = None
_role_checked = False

logger = logging.getLogger(__name__)


def _decode_jwt_role(token: str) -> str | None:
    parts = token.split(".")
    if len(parts) != 3:
        return None

    try:
        payload = parts[1]
        padding = "=" * (-len(payload) % 4)
        data = base64.urlsafe_b64decode(f"{payload}{padding}").decode("utf-8")
        parsed = json.loads(data)
        role = parsed.get("role")
        return role if isinstance(role, str) else None
    except Exception:
        return None


def _is_service_role_key(key: str) -> bool:
    if key.startswith("sb_secret_"):
        return True
    if key.startswith("sb_publishable_") or key.startswith("sbp_"):
        return False

    role = _decode_jwt_role(key)
    return role == "service_role"


def _effective_key() -> str:
    return settings.supabase_service_role_key or settings.supabase_key


def get_db() -> Client:
    global _client, _role_checked
    if _client is None:
        key = _effective_key()
        if not _role_checked:
            if not _is_service_role_key(key):
                logger.critical(
                    "Supabase backend key is not service-role. "
                    "Writes may fail under RLS. "
                    "Configure SUPABASE_SERVICE_ROLE_KEY."
                )
            _role_checked = True
        _client = create_client(settings.supabase_url, key)
    return _client


async def db_execute(query_fn):
    """Run a synchronous Supabase query in a thread pool to avoid blocking the event loop.

    The Supabase Python client is entirely synchronous. Calling it directly from an
    async handler blocks the asyncio event loop for the duration of the network round-trip.
    This wrapper offloads the call to a thread-pool worker so the event loop remains free.

    Usage:
        result = await db_execute(lambda: get_db().table("users").select("*").execute())
        result = await db_execute(partial(get_db().table("copy_logs").select("*").eq("status", "done").execute))
    """
    return await asyncio.to_thread(query_fn)
