"""
Compat endpoints — preview, search-sku, copy, logs for vehicle compatibilities.
"""
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

from app.db.supabase import get_db
from app.routers.auth import require_user
from app.services.compat_copier import copy_compat_to_targets, search_sku_all_sellers
from app.services.ml_api import get_item, get_item_compatibilities

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/compat", tags=["compat"])


@router.get("/preview/{item_id}")
async def preview_item(item_id: str, seller: str = Query(None), user: dict = Depends(require_user)):
    """Preview an item's compatibility info."""
    # Check can_run_compat (admins bypass)
    if user["role"] != "admin" and not user.get("can_run_compat"):
        raise HTTPException(status_code=403, detail="Sem permissão para rodar compatibilidade")
    # If no seller provided, use the first connected seller
    if not seller:
        db = get_db()
        result = db.table("copy_sellers").select("slug").limit(1).execute()
        if not result.data:
            raise HTTPException(status_code=400, detail="No connected sellers found")
        seller = result.data[0]["slug"]

    try:
        item = await get_item(seller, item_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Item not found: {e}")

    has_compatibilities = False
    compat_count = 0
    try:
        compat = await get_item_compatibilities(seller, item_id)
        if compat is not None:
            has_compatibilities = bool(compat)
            # compat may have a list of products or a count
            if isinstance(compat, dict):
                products = compat.get("products", [])
                compat_count = len(products)
            elif isinstance(compat, list):
                compat_count = len(compat)
    except Exception:
        pass

    return {
        "id": item.get("id"),
        "title": item.get("title"),
        "thumbnail": item.get("secure_thumbnail") or item.get("thumbnail"),
        "has_compatibilities": has_compatibilities,
        "compat_count": compat_count,
    }


class SearchSkuRequest(BaseModel):
    skus: list[str]


@router.post("/search-sku")
async def search_sku(req: SearchSkuRequest, user: dict = Depends(require_user)):
    """Search for items by SKU across connected sellers (filtered by permissions)."""
    if not req.skus:
        raise HTTPException(status_code=400, detail="At least one SKU is required")

    # Filter sellers by can_copy_to permission (admins get all)
    allowed_sellers = None
    if user["role"] != "admin":
        allowed_sellers = [
            p["seller_slug"]
            for p in user.get("permissions", [])
            if p.get("can_copy_to")
        ]

    results = await search_sku_all_sellers(req.skus, allowed_sellers=allowed_sellers)
    return results


class CopyTarget(BaseModel):
    seller_slug: str
    item_id: str


class CopyRequest(BaseModel):
    source_item_id: str
    targets: list[CopyTarget]
    skus: list[str] = []


@router.post("/copy")
async def copy_compat(req: CopyRequest, bg: BackgroundTasks, user: dict = Depends(require_user)):
    """Queue compatibility copy — returns immediately, results appear in logs."""
    # Check can_run_compat (admins bypass)
    if user["role"] != "admin" and not user.get("can_run_compat"):
        raise HTTPException(status_code=403, detail="Sem permissão para rodar compatibilidade")

    if not req.targets:
        raise HTTPException(status_code=400, detail="At least one target is required")

    targets = [{"seller_slug": t.seller_slug, "item_id": t.item_id} for t in req.targets]
    bg.add_task(copy_compat_to_targets, req.source_item_id, targets, req.skus, user["id"])

    return {
        "status": "queued",
        "total_targets": len(targets),
    }


@router.get("/logs")
async def compat_logs(
    limit: int = Query(50, le=200),
    user: dict = Depends(require_user),
):
    """Get compat copy history. Operators see only their own logs; admins see all."""
    db = get_db()
    query = db.table("compat_logs").select("*, users(username)").order(
        "created_at", desc=True
    )
    if user["role"] != "admin":
        query = query.eq("user_id", user["id"])
    result = query.limit(limit).execute()
    # Flatten the joined username into each log entry
    logs = []
    for row in result.data or []:
        users_data = row.pop("users", None)
        row["username"] = users_data["username"] if users_data else None
        logs.append(row)
    return logs
