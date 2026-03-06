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

USER_FIELDS = "id, username, email, role, org_id, can_run_compat, active, created_at, last_login_at"


def _check_last_admin(db, org_id: str, target_user_id: str):
    """Raise 400 if removing/demoting target would leave org with zero admins."""
    result = (
        db.table("users")
        .select("id", count="exact")
        .eq("org_id", org_id)
        .eq("role", "admin")
        .eq("active", True)
        .neq("id", target_user_id)
        .execute()
    )
    if result.count == 0:
        raise HTTPException(
            status_code=400,
            detail="Não é possível remover o último administrador da organização",
        )


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
    result = db.table("users").select(USER_FIELDS).eq("org_id", user["org_id"]).execute()
    return result.data or []


@router.post("/users")
async def create_user(req: CreateUserRequest, user: dict = Depends(require_admin)):
    """Create a new user account (admin only)."""
    db = get_db()

    # Check for duplicate username within org
    existing = (
        db.table("users")
        .select("id")
        .eq("username", req.username)
        .eq("org_id", user["org_id"])
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=409, detail="Usuário já existe")

    new_user = {
        "username": req.username,
        "password_hash": _hash_password(req.password),
        "role": req.role,
        "can_run_compat": req.can_run_compat,
        "active": True,
        "org_id": user["org_id"],
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

    # Verify target user belongs to same org
    target = db.table("users").select("id, org_id, role, active").eq("id", user_id).execute()
    if not target.data or target.data[0]["org_id"] != user["org_id"]:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    target_user = target.data[0]

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

    # Prevent removing the last admin (demote or deactivate)
    if target_user["role"] == "admin" and target_user["active"]:
        would_lose_admin = False
        if req.role is not None and req.role != "admin":
            would_lose_admin = True
        if req.active is False:
            would_lose_admin = True
        if would_lose_admin:
            _check_last_admin(db, user["org_id"], user_id)

    db.table("users").update(update_data).eq("id", user_id).execute()

    # Return updated user without password_hash
    updated = db.table("users").select(USER_FIELDS).eq("id", user_id).execute()
    return updated.data[0]


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_admin)):
    """Delete a user (admin only)."""
    db = get_db()

    # Verify target user belongs to same org
    target = db.table("users").select("id, org_id, role, active").eq("id", user_id).execute()
    if not target.data or target.data[0]["org_id"] != user["org_id"]:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Prevent deleting the last admin
    target_user = target.data[0]
    if target_user["role"] == "admin" and target_user["active"]:
        _check_last_admin(db, user["org_id"], user_id)

    db.table("users").delete().eq("id", user_id).execute()

    return {"status": "ok"}


@router.get("/users/{user_id}/permissions")
async def get_user_permissions(user_id: str, user: dict = Depends(require_admin)):
    """Get per-seller permissions for a user. Returns all connected sellers with defaults."""
    db = get_db()

    # Verify target user belongs to same org
    target = db.table("users").select("id, org_id").eq("id", user_id).execute()
    if not target.data or target.data[0]["org_id"] != user["org_id"]:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Fetch all connected ML sellers for this org
    ml_result = (
        db.table("copy_sellers")
        .select("slug, name")
        .eq("org_id", user["org_id"])
        .execute()
    )
    ml_sellers = ml_result.data or []

    # Fetch all connected Shopee shops for this org
    shopee_result = (
        db.table("shopee_sellers")
        .select("slug, name")
        .eq("org_id", user["org_id"])
        .execute()
    )
    shopee_shops = shopee_result.data or []

    # Fetch existing permissions for this user
    perms_result = db.table("user_permissions").select(
        "seller_slug, can_copy_from, can_copy_to"
    ).eq("user_id", user_id).execute()
    perms_map = {p["seller_slug"]: p for p in (perms_result.data or [])}

    # Merge: all sellers with permission defaults and platform tag
    result = []
    for seller in ml_sellers:
        perm = perms_map.get(seller["slug"], {})
        result.append({
            "seller_slug": seller["slug"],
            "seller_name": seller["name"],
            "platform": "ml",
            "can_copy_from": perm.get("can_copy_from", False),
            "can_copy_to": perm.get("can_copy_to", False),
        })
    for shop in shopee_shops:
        perm = perms_map.get(shop["slug"], {})
        result.append({
            "seller_slug": shop["slug"],
            "seller_name": shop["name"],
            "platform": "shopee",
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

    # Verify target user belongs to same org
    target = db.table("users").select("id, org_id").eq("id", user_id).execute()
    if not target.data or target.data[0]["org_id"] != user["org_id"]:
        raise HTTPException(status_code=404, detail="Usuário não encontrado")

    # Upsert each permission entry
    for entry in req.permissions:
        db.table("user_permissions").upsert(
            {
                "user_id": user_id,
                "seller_slug": entry.seller_slug,
                "can_copy_from": entry.can_copy_from,
                "can_copy_to": entry.can_copy_to,
                "org_id": user["org_id"],
            },
            on_conflict="user_id,seller_slug",
        ).execute()

    return {"status": "ok"}
