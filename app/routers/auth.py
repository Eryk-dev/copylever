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


class AdminPromoteRequest(BaseModel):
    username: str
    password: str
    master_password: str


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


@router.post("/admin-promote")
async def admin_promote(req: AdminPromoteRequest):
    """Create or promote a user to admin using the master password."""
    if not settings.admin_master_password:
        raise HTTPException(status_code=403, detail="Master password not configured")

    if req.master_password != settings.admin_master_password:
        raise HTTPException(status_code=403, detail="Senha master inválida")

    db = get_db()

    # Check if user already exists
    result = db.table("users").select("*").eq("username", req.username).execute()

    if result.data:
        # User exists — promote to admin
        user = result.data[0]
        update_data: dict = {
            "role": "admin",
            "can_run_compat": True,
        }
        if req.password:
            update_data["password_hash"] = _hash_password(req.password)

        db.table("users").update(update_data).eq("id", user["id"]).execute()

        # Re-fetch updated user
        updated = db.table("users").select(
            "id, username, role, can_run_compat, active, created_at, last_login_at"
        ).eq("id", user["id"]).execute()
        user_out = updated.data[0]
    else:
        # User does not exist — create as admin
        new_user = {
            "username": req.username,
            "password_hash": _hash_password(req.password),
            "role": "admin",
            "can_run_compat": True,
            "active": True,
        }
        created = db.table("users").insert(new_user).execute()
        user_row = created.data[0]
        user_out = {
            "id": user_row["id"],
            "username": user_row["username"],
            "role": user_row["role"],
            "can_run_compat": user_row["can_run_compat"],
            "active": user_row["active"],
            "created_at": user_row["created_at"],
            "last_login_at": user_row.get("last_login_at"),
        }

    # Log the admin promote action
    db.table("auth_logs").insert({
        "user_id": user_out["id"],
        "username": req.username,
        "action": "admin_promote",
    }).execute()

    return {"user": user_out}
