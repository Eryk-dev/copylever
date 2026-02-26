"""
Admin authentication — bcrypt password + persistent session tokens (Supabase).
"""
import logging
import secrets
from datetime import datetime, timezone

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel

from app.db.supabase import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

SESSION_MAX_AGE = 7 * 86400  # 7 days


def _get_admin_config() -> dict | None:
    db = get_db()
    result = db.table("admin_config").select("*").eq("id", 1).execute()
    if result.data:
        return result.data[0]
    return None


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


async def require_admin(x_admin_token: str = Header(...)):
    """Dependency: verify admin session token."""
    config = _get_admin_config()
    if not config or config.get("session_token") != x_admin_token:
        raise HTTPException(status_code=401, detail="Invalid or expired admin token")
    created = config.get("session_created_at")
    if created:
        if isinstance(created, str):
            created = datetime.fromisoformat(created)
        if (datetime.now(timezone.utc) - created).total_seconds() > SESSION_MAX_AGE:
            db = get_db()
            db.table("admin_config").update(
                {"session_token": None, "session_created_at": None}
            ).eq("id", 1).execute()
            raise HTTPException(status_code=401, detail="Session expired")
    return True


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
async def login(req: LoginRequest):
    """Authenticate with admin password. Returns session token."""
    config = _get_admin_config()
    if not config or not config.get("password_hash"):
        # First-time setup: hash and store the provided password
        new_hash = bcrypt.hashpw(req.password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        db = get_db()
        db.table("admin_config").upsert({"id": 1, "password_hash": new_hash}).execute()
        config = {"password_hash": new_hash}

    if not _verify_password(req.password, config["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid password")

    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc).isoformat()
    db = get_db()
    db.table("admin_config").update(
        {"session_token": token, "session_created_at": now}
    ).eq("id", 1).execute()
    return {"token": token}


@router.post("/logout")
async def logout(x_admin_token: str = Header(None)):
    """Invalidate session token."""
    if x_admin_token:
        db = get_db()
        config = _get_admin_config()
        if config and config.get("session_token") == x_admin_token:
            db.table("admin_config").update(
                {"session_token": None, "session_created_at": None}
            ).eq("id", 1).execute()
    return {"status": "ok"}


@router.get("/me", dependencies=[Depends(require_admin)])
async def me():
    """Check if session is valid."""
    return {"authenticated": True}
