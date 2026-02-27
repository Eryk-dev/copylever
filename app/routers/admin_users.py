"""
Admin user management — CRUD endpoints for managing operator accounts.
"""
import logging
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db.supabase import get_db
from app.routers.auth import require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])

USER_FIELDS = "id, username, role, can_run_compat, active, created_at, last_login_at"


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "operator"
    can_run_compat: bool = False


class UpdateUserRequest(BaseModel):
    password: Optional[str] = None
    role: Optional[str] = None
    can_run_compat: Optional[bool] = None
    active: Optional[bool] = None


class PermissionEntry(BaseModel):
    seller_slug: str
    can_copy_from: bool = False
    can_copy_to: bool = False


class UpdatePermissionsRequest(BaseModel):
    permissions: list[PermissionEntry]


@router.get("/users")
async def list_users(user: dict = Depends(require_admin)):
    """List all users (admin only). Never returns password_hash."""
    db = get_db()
    result = db.table("users").select(USER_FIELDS).execute()
    return result.data or []


@router.post("/users")
async def create_user(req: CreateUserRequest, user: dict = Depends(require_admin)):
    """Create a new user account (admin only)."""
    db = get_db()

    # Check for duplicate username
    existing = db.table("users").select("id").eq("username", req.username).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail="Usuário já existe")

    new_user = {
        "username": req.username,
        "password_hash": _hash_password(req.password),
        "role": req.role,
        "can_run_compat": req.can_run_compat,
        "active": True,
    }
    created = db.table("users").insert(new_user).execute()
    row = created.data[0]
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "can_run_compat": row["can_run_compat"],
        "active": row["active"],
        "created_at": row["created_at"],
        "last_login_at": row.get("last_login_at"),
    }


@router.put("/users/{user_id}")
async def update_user(user_id: str, req: UpdateUserRequest, user: dict = Depends(require_admin)):
    """Update an existing user (admin only)."""
    db = get_db()

    update_data: dict = {}
    if req.password is not None:
        update_data["password_hash"] = _hash_password(req.password)
    if req.role is not None:
        update_data["role"] = req.role
    if req.can_run_compat is not None:
        update_data["can_run_compat"] = req.can_run_compat
    if req.active is not None:
        update_data["active"] = req.active

    if not update_data:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar")

    result = db.table("users").update(update_data).eq("id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Return updated user without password_hash
    updated = db.table("users").select(USER_FIELDS).eq("id", user_id).execute()
    return updated.data[0]


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_admin)):
    """Delete a user (admin only). Cannot delete yourself."""
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Não é possível deletar a si mesmo")

    db = get_db()
    result = db.table("users").delete().eq("id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    return {"status": "ok"}


@router.get("/users/{user_id}/permissions")
async def get_user_permissions(user_id: str, user: dict = Depends(require_admin)):
    """Get per-seller permissions for a user. Returns all connected sellers with defaults."""
    db = get_db()

    # Fetch all connected sellers
    sellers_result = db.table("copy_sellers").select("slug, name").execute()
    all_sellers = sellers_result.data or []

    # Fetch existing permissions for this user
    perms_result = db.table("user_permissions").select(
        "seller_slug, can_copy_from, can_copy_to"
    ).eq("user_id", user_id).execute()
    perms_map = {p["seller_slug"]: p for p in (perms_result.data or [])}

    # Merge: all sellers with permission defaults
    result = []
    for seller in all_sellers:
        perm = perms_map.get(seller["slug"], {})
        result.append({
            "seller_slug": seller["slug"],
            "seller_name": seller["name"],
            "can_copy_from": perm.get("can_copy_from", False),
            "can_copy_to": perm.get("can_copy_to", False),
        })

    return result


@router.put("/users/{user_id}/permissions")
async def update_user_permissions(
    user_id: str,
    req: UpdatePermissionsRequest,
    user: dict = Depends(require_admin),
):
    """Upsert per-seller permissions for a user."""
    db = get_db()

    # Verify the user exists
    user_result = db.table("users").select("id").eq("id", user_id).execute()
    if not user_result.data:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Upsert each permission entry
    for entry in req.permissions:
        db.table("user_permissions").upsert(
            {
                "user_id": user_id,
                "seller_slug": entry.seller_slug,
                "can_copy_from": entry.can_copy_from,
                "can_copy_to": entry.can_copy_to,
            },
            on_conflict="user_id,seller_slug",
        ).execute()

    return {"status": "ok"}
