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
from app.services.email import send_reset_email

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
        "email": user.get("email"),
        "role": user["role"],
        "org_id": user["org_id"],
        "is_super_admin": user.get("is_super_admin", False),
        "can_run_compat": user["can_run_compat"],
        "permissions": permissions,
    }


async def require_admin(x_auth_token: str = Header(...)) -> dict:
    """Dependency: verify user is an admin."""
    user = await require_user(x_auth_token)
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")
    return user


async def require_super_admin(x_auth_token: str = Header(...)) -> dict:
    """Dependency: verify user is a super-admin."""
    user = await require_user(x_auth_token)
    if not user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Acesso restrito ao super-admin")
    return user


async def require_active_org(x_auth_token: str = Header(...)) -> dict:
    """Dependency: verify user belongs to an active org."""
    user = await require_user(x_auth_token)

    # Super-admins bypass org checks
    if user.get("is_super_admin"):
        return user

    db = get_db()
    org_result = db.table("orgs").select(
        "active, payment_active, trial_copies_used, trial_copies_limit"
    ).eq("id", user["org_id"]).single().execute()

    if not org_result.data or not org_result.data.get("active"):
        raise HTTPException(status_code=403, detail="Organizacao desativada")

    org = org_result.data
    if not org.get("payment_active"):
        # Allow access if still within trial limits
        used = org.get("trial_copies_used", 0)
        limit = org.get("trial_copies_limit", 20)
        if used >= limit:
            raise HTTPException(status_code=402, detail="Periodo de teste encerrado")

    return user


class LoginRequest(BaseModel):
    email: str
    password: str


class SignupRequest(BaseModel):
    email: str
    password: str
    company_name: str


class AdminPromoteRequest(BaseModel):
    username: str
    password: str
    master_password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/login")
async def login(req: LoginRequest):
    """Authenticate with email and password. Returns session token + user info."""
    db = get_db()

    # Find user by email
    result = db.table("users").select("*").eq("email", req.email).execute()
    if not result.data:
        # Log failed login attempt (user not found)
        try:
            db.table("auth_logs").insert({
                "username": req.email,
                "action": "login_failed",
            }).execute()
        except Exception:
            logger.warning("Failed to log login_failed for unknown user %s", req.email)
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")

    user = result.data[0]

    if not user.get("active"):
        # Log failed login attempt (inactive user)
        try:
            db.table("auth_logs").insert({
                "user_id": user["id"],
                "username": user["username"],
                "action": "login_failed",
            }).execute()
        except Exception:
            logger.warning("Failed to log login_failed for inactive user %s", user["username"])
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")

    if not _verify_password(req.password, user["password_hash"]):
        # Log failed login attempt (wrong password)
        try:
            db.table("auth_logs").insert({
                "user_id": user["id"],
                "username": user["username"],
                "action": "login_failed",
            }).execute()
        except Exception:
            logger.warning("Failed to log login_failed for user %s", user["username"])
        raise HTTPException(status_code=401, detail="Email ou senha incorretos")

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

    # Log successful login
    try:
        db.table("auth_logs").insert({
            "user_id": user["id"],
            "username": user["username"],
            "action": "login",
        }).execute()
    except Exception:
        logger.warning("Failed to log login for user %s", user["username"])

    return {
        "token": token,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
            "can_run_compat": user["can_run_compat"],
        },
    }


@router.post("/signup")
async def signup(req: SignupRequest):
    """Create a new org and admin user. Returns session token + user/org info."""
    db = get_db()

    # Validate inputs
    if not req.email or not req.email.strip():
        raise HTTPException(status_code=400, detail="Email e obrigatorio")
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="Senha deve ter pelo menos 6 caracteres")
    if not req.company_name or not req.company_name.strip():
        raise HTTPException(status_code=400, detail="Nome da empresa e obrigatorio")

    email = req.email.strip().lower()

    # Check if email already exists
    existing = db.table("users").select("id").eq("email", email).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail="Email ja cadastrado")

    # Create org
    org_result = db.table("orgs").insert({
        "name": req.company_name.strip(),
        "email": email,
        "active": True,
        "payment_active": False,
    }).execute()
    org = org_result.data[0]

    # Create user
    user_result = db.table("users").insert({
        "email": email,
        "username": email,
        "password_hash": _hash_password(req.password),
        "role": "admin",
        "can_run_compat": True,
        "org_id": org["id"],
        "is_super_admin": False,
        "active": True,
    }).execute()
    user = user_result.data[0]

    # Create session
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_EXPIRY_DAYS)

    db.table("user_sessions").insert({
        "user_id": user["id"],
        "token": token,
        "expires_at": expires_at.isoformat(),
    }).execute()

    # Log signup
    try:
        db.table("auth_logs").insert({
            "user_id": user["id"],
            "username": user["username"],
            "org_id": org["id"],
            "action": "signup",
        }).execute()
    except Exception:
        logger.warning("Failed to log signup for user %s", email)

    return {
        "token": token,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
            "role": user["role"],
            "can_run_compat": user["can_run_compat"],
        },
        "org": {
            "id": org["id"],
            "name": org["name"],
        },
    }


@router.post("/logout")
async def logout(x_auth_token: str = Header(None)):
    """Invalidate session token."""
    if x_auth_token:
        db = get_db()
        # Look up session to identify user for audit log
        session_result = db.table("user_sessions").select("user_id").eq(
            "token", x_auth_token
        ).execute()
        if session_result.data:
            user_id = session_result.data[0]["user_id"]
            # Fetch username for the log
            user_result = db.table("users").select("username").eq("id", user_id).execute()
            username = user_result.data[0]["username"] if user_result.data else None
            try:
                db.table("auth_logs").insert({
                    "user_id": user_id,
                    "username": username,
                    "action": "logout",
                }).execute()
            except Exception:
                logger.warning("Failed to log logout for user_id %s", user_id)
        db.table("user_sessions").delete().eq("token", x_auth_token).execute()
    return {"status": "ok"}


@router.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest):
    """Generate a password reset token. Always returns 200 regardless of email existence."""
    db = get_db()

    email = req.email.strip().lower()
    result = db.table("users").select("id").eq("email", email).execute()
    if result.data:
        user_id = result.data[0]["id"]
        token = secrets.token_urlsafe(32)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
        db.table("password_reset_tokens").insert({
            "user_id": user_id,
            "token": token,
            "expires_at": expires_at.isoformat(),
        }).execute()
        logger.info("Password reset token created for user %s", user_id)

        try:
            send_reset_email(email, token)
        except Exception:
            logger.error("Failed to send reset email to %s, token still created", email)

    return {"message": "Se o email existir, enviaremos instrucoes"}


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest):
    """Reset password using a valid token."""
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Senha deve ter pelo menos 6 caracteres")

    db = get_db()

    # Look up token
    token_result = db.table("password_reset_tokens").select("*").eq("token", req.token).execute()
    if not token_result.data:
        raise HTTPException(status_code=400, detail="Link expirado ou invalido")

    token_row = token_result.data[0]

    # Check expiry
    expires_at = token_row["expires_at"]
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if datetime.now(timezone.utc) > expires_at:
        # Clean up expired token
        db.table("password_reset_tokens").delete().eq("id", token_row["id"]).execute()
        raise HTTPException(status_code=400, detail="Link expirado ou invalido")

    user_id = token_row["user_id"]

    # Update password
    db.table("users").update({
        "password_hash": _hash_password(req.new_password),
    }).eq("id", user_id).execute()

    # Invalidate ALL sessions for this user
    db.table("user_sessions").delete().eq("user_id", user_id).execute()

    # Delete ALL password reset tokens for this user (not just the used one)
    db.table("password_reset_tokens").delete().eq("user_id", user_id).execute()

    # Log the action
    try:
        db.table("auth_logs").insert({
            "user_id": user_id,
            "action": "password_reset_sessions_cleared",
        }).execute()
    except Exception:
        logger.warning("Failed to log password_reset_sessions_cleared for user %s", user_id)

    logger.info("Password reset completed for user %s (all sessions invalidated)", user_id)
    return {"message": "Senha alterada com sucesso"}


@router.get("/me")
async def me(user: dict = Depends(require_user)):
    """Return current user info with permissions and org context."""
    db = get_db()
    org_name = None
    if user.get("org_id"):
        org_result = db.table("orgs").select("name").eq("id", user["org_id"]).single().execute()
        if org_result.data:
            org_name = org_result.data["name"]
    return {**user, "org_name": org_name}


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
            "email": req.username,
            "password_hash": _hash_password(req.password),
            "role": "admin",
            "can_run_compat": True,
            "active": True,
            "org_id": "00000000-0000-0000-0000-000000000001",
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
