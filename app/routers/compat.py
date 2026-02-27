"""
Compat endpoints — preview, search-sku, copy, logs for vehicle compatibilities.
"""
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

from app.db.supabase import get_db
from app.routers.auth import require_admin
from app.services.compat_copier import copy_compat_to_targets, search_sku_all_sellers
from app.services.ml_api import get_item, get_item_compatibilities

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/compat", tags=["compat"], dependencies=[Depends(require_admin)])


@router.get("/preview/{item_id}")
async def preview_item(item_id: str, seller: str = Query(None)):
    """Preview an item's compatibility info."""
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
async def search_sku(req: SearchSkuRequest):
    """Search for items by SKU across all connected sellers."""
    if not req.skus:
        raise HTTPException(status_code=400, detail="At least one SKU is required")
    results = await search_sku_all_sellers(req.skus)
    return results


class CopyTarget(BaseModel):
    seller_slug: str
    item_id: str


class CopyRequest(BaseModel):
    source_item_id: str
    targets: list[CopyTarget]
    skus: list[str] = []


@router.post("/copy")
async def copy_compat(req: CopyRequest, bg: BackgroundTasks):
    """Queue compatibility copy — returns immediately, results appear in logs."""
    if not req.targets:
        raise HTTPException(status_code=400, detail="At least one target is required")

    targets = [{"seller_slug": t.seller_slug, "item_id": t.item_id} for t in req.targets]

    # Create in_progress log row before starting background task
    db = get_db()
    pending_targets = [
        {**t, "status": "pending", "error": None} for t in targets
    ]
    log_row = db.table("compat_logs").insert({
        "source_item_id": req.source_item_id,
        "skus": req.skus or [],
        "targets": pending_targets,
        "total_targets": len(targets),
        "success_count": 0,
        "error_count": 0,
        "status": "in_progress",
    }).execute()
    log_id = log_row.data[0]["id"]

    bg.add_task(copy_compat_to_targets, req.source_item_id, targets, req.skus, log_id)

    return {
        "status": "queued",
        "total_targets": len(targets),
        "log_id": log_id,
    }


@router.get("/logs")
async def compat_logs(
    limit: int = Query(50, le=200),
):
    """Get compat copy history."""
    db = get_db()
    result = db.table("compat_logs").select("*").order(
        "created_at", desc=True
    ).limit(limit).execute()
    return result.data or []
