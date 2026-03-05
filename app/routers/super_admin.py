"""
Super-admin router — platform-wide organization management.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.db.supabase import get_db
from app.routers.auth import require_super_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/super", tags=["super-admin"])


class UpdateOrgRequest(BaseModel):
    active: Optional[bool] = None
    payment_active: Optional[bool] = None


@router.get("/orgs")
async def list_orgs(user: dict = Depends(require_super_admin)):
    """List all organizations with usage stats."""
    db = get_db()
    orgs_result = db.table("orgs").select("*").order("created_at", desc=False).execute()
    orgs = orgs_result.data or []

    thirty_days_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    enriched = []
    for org in orgs:
        org_id = org["id"]

        user_count = db.table("users").select("id", count="exact").eq("org_id", org_id).execute().count or 0
        seller_count = db.table("copy_sellers").select("id", count="exact").eq("org_id", org_id).eq("active", True).execute().count or 0
        copy_count = db.table("copy_logs").select("id", count="exact").eq("org_id", org_id).gte("created_at", thirty_days_ago).execute().count or 0
        compat_count = db.table("compat_logs").select("id", count="exact").eq("org_id", org_id).gte("created_at", thirty_days_ago).execute().count or 0

        enriched.append({
            **org,
            "user_count": user_count,
            "seller_count": seller_count,
            "copy_count": copy_count,
            "compat_count": compat_count,
        })

    return enriched


@router.put("/orgs/{org_id}")
async def update_org(org_id: str, req: UpdateOrgRequest, user: dict = Depends(require_super_admin)):
    """Toggle org active/payment status."""
    db = get_db()

    # Verify org exists
    existing = db.table("orgs").select("id").eq("id", org_id).execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Organizacao nao encontrada")

    updates = {}
    if req.active is not None:
        updates["active"] = req.active
    if req.payment_active is not None:
        updates["payment_active"] = req.payment_active

    if not updates:
        raise HTTPException(status_code=400, detail="Nenhum campo para atualizar")

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    result = db.table("orgs").update(updates).eq("id", org_id).execute()
    return result.data[0] if result.data else updates
