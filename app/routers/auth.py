"""
User authentication — bcrypt password + per-user session tokens (Supabase).
"""
import logging
import secrets
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel

from app.config import settings
from app.db.supabase import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])

SESSION_EXPIRY_DAYS = 7


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _get_user_permissions(user_id: str) -> list[dict]:
    db = get_db()
    result = db.table("user_permissions").select(
        "seller_slug, can_copy_from, can_copy_to"
    ).eq("user_id", user_id).execute()
    return result.data or []


async def require_user(x_auth_token: str = Header(...)) -> dict:
    """Dependency: verify user session token, return user dict with permissions."""
    db = get_db()

    # Look up session
    session_result = db.table("user_sessions").select("*").eq(
        "token", x_auth_token
    ).execute()
    if not session_result.data:
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")

    session = session_result.data[0]

    # Check expiry
    expires_at = session["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if datetime.now(timezone.utc) > expires_at:
        # Clean up expired session
        db.table("user_sessions").delete().eq("id", session["id"]).execute()
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")

    # Fetch user
    user_result = db.table("users").select("*").eq("id", session["user_id"]).execute()
    if not user_result.data or not user_result.data[0].get("active"):
        raise HTTPException(status_code=401, detail="Token inválido ou expirado")

    user = user_result.data[0]
    permissions = _get_user_permissions(user["id"])

    return {
        "id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "can_run_compat": user["can_run_compat"],
        "permissions": permissions,
    }


async def require_admin(x_auth_token: str = Header(...)) -> dict:
    """Dependency: verify user is an admin."""
    user = await require_user(x_auth_token)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return user


class LoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login")
async def login(req: LoginRequest):
    """Authenticate with username and password. Returns session token + user info."""
    db = get_db()

    # Find user
    result = db.table("users").select("*").eq("username", req.username).execute()
    if not result.data:
        raise HTTPException(status_code=401, detail="Credenciais inválidas")

    user = result.data[0]

    if not user.get("active"):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")

    if not _verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Credenciais inválidas")

    # Create session
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_EXPIRY_DAYS)

    db.table("user_sessions").insert({
        "user_id": user["id"],
        "token": token,
        "expires_at": expires_at.isoformat(),
    }).execute()

    # Update last_login_at
    db.table("users").update({
        "last_login_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", user["id"]).execute()

    return {
        "token": token,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
            "can_run_compat": user["can_run_compat"],
        },
    }


@router.post("/logout")
async def logout(x_auth_token: str = Header(None)):
    """Invalidate session token."""
    if x_auth_token:
        db = get_db()
        db.table("user_sessions").delete().eq("token", x_auth_token).execute()
    return {"status": "ok"}


@router.get("/me")
async def me(user: dict = Depends(require_user)):
    """Return current user info with permissions."""
    return user
