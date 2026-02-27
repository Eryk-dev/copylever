"""
Copy endpoints — POST /api/copy, GET /api/copy/logs, GET /api/copy/preview
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.db.supabase import get_db
from app.routers.auth import require_user
from app.services.item_copier import copy_items, copy_with_dimensions
from app.services.ml_api import get_item, get_item_description, get_item_compatibilities

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/copy", tags=["copy"])


def _check_seller_permission(user: dict, seller_slug: str, direction: str) -> bool:
    """Check if user has permission for a seller. direction: 'from' or 'to'."""
    if user["role"] == "admin":
        return True
    key = "can_copy_from" if direction == "from" else "can_copy_to"
    return any(
        p["seller_slug"] == seller_slug and p.get(key, False)
        for p in user.get("permissions", [])
    )


class CopyRequest(BaseModel):
    source: str
    destinations: list[str]
    item_ids: list[str]


class Dimensions(BaseModel):
    height: float | None = None
    width: float | None = None
    length: float | None = None
    weight: float | None = None


class CopyWithDimensionsRequest(BaseModel):
    source: str
    destinations: list[str]
    item_id: str
    dimensions: Dimensions


@router.post("")
async def copy_anuncios(req: CopyRequest, user: dict = Depends(require_user)):
    """Copy listings from source seller to destination seller(s)."""
    if not req.source:
        raise HTTPException(status_code=400, detail="source is required")
    if not req.destinations:
        raise HTTPException(status_code=400, detail="At least one destination is required")
    if not req.item_ids:
        raise HTTPException(status_code=400, detail="At least one item_id is required")
    if req.source in req.destinations:
        raise HTTPException(status_code=400, detail="Source cannot be in destinations")

    # Permission checks (admins bypass)
    if not _check_seller_permission(user, req.source, "from"):
        raise HTTPException(status_code=403, detail=f"Sem permissão de origem para o seller '{req.source}'")
    denied_dests = [d for d in req.destinations if not _check_seller_permission(user, d, "to")]
    if denied_dests:
        raise HTTPException(status_code=403, detail=f"Sem permissão de destino para o(s) seller(s): {', '.join(denied_dests)}")

    # Clean item_ids (support comma-separated and newline-separated)
    clean_ids = []
    for raw in req.item_ids:
        for part in raw.replace(",", "\n").split("\n"):
            part = part.strip()
            if part:
                clean_ids.append(part)

    if not clean_ids:
        raise HTTPException(status_code=400, detail="No valid item IDs provided")

    results = await copy_items(
        source_seller=req.source,
        dest_sellers=req.destinations,
        item_ids=clean_ids,
    )

    success_count = sum(1 for r in results if r["status"] == "success")
    error_count = sum(1 for r in results if r["status"] == "error")
    dim_count = sum(1 for r in results if r["status"] == "needs_dimensions")

    return {
        "total": len(results),
        "success": success_count,
        "errors": error_count,
        "needs_dimensions": dim_count,
        "results": results,
    }


@router.post("/with-dimensions")
async def copy_with_dims(req: CopyWithDimensionsRequest, user: dict = Depends(require_user)):
    """Apply dimensions to source item, then copy to destinations."""
    dims = req.dimensions.model_dump(exclude_none=True)
    if not dims:
        raise HTTPException(status_code=400, detail="At least one dimension is required")

    # Permission checks (admins bypass)
    if not _check_seller_permission(user, req.source, "from"):
        raise HTTPException(status_code=403, detail=f"Sem permissão de origem para o seller '{req.source}'")
    denied_dests = [d for d in req.destinations if not _check_seller_permission(user, d, "to")]
    if denied_dests:
        raise HTTPException(status_code=403, detail=f"Sem permissão de destino para o(s) seller(s): {', '.join(denied_dests)}")

    results = await copy_with_dimensions(
        source_seller=req.source,
        dest_sellers=req.destinations,
        item_id=req.item_id.strip(),
        dimensions=dims,
    )

    success_count = sum(1 for r in results if r["status"] == "success")
    error_count = sum(1 for r in results if r["status"] == "error")

    return {
        "total": len(results),
        "success": success_count,
        "errors": error_count,
        "results": results,
    }


@router.get("/logs")
async def copy_logs(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_user),
):
    """Get copy history."""
    db = get_db()
    result = db.table("copy_logs").select("*").order(
        "created_at", desc=True
    ).range(offset, offset + limit - 1).execute()
    return result.data or []


@router.get("/preview/{item_id}")
async def preview_item(item_id: str, seller: str = Query(...), user: dict = Depends(require_user)):
    """Preview an item before copying."""
    try:
        item = await get_item(seller, item_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Item not found: {e}")

    # Fetch description
    description = ""
    try:
        desc_data = await get_item_description(seller, item_id)
        description = desc_data.get("plain_text", "")
    except Exception:
        pass

    # Check compatibilities
    has_compatibilities = False
    try:
        compat = await get_item_compatibilities(seller, item_id)
        has_compatibilities = compat is not None and bool(compat)
    except Exception:
        pass

    return {
        "id": item.get("id"),
        "title": item.get("title"),
        "price": item.get("price"),
        "currency_id": item.get("currency_id"),
        "available_quantity": item.get("available_quantity"),
        "sold_quantity": item.get("sold_quantity"),
        "category_id": item.get("category_id"),
        "listing_type_id": item.get("listing_type_id"),
        "condition": item.get("condition"),
        "status": item.get("status"),
        "thumbnail": item.get("secure_thumbnail") or item.get("thumbnail"),
        "permalink": item.get("permalink"),
        "pictures_count": len(item.get("pictures", [])),
        "variations_count": len(item.get("variations", [])),
        "attributes_count": len(item.get("attributes", [])),
        "has_compatibilities": has_compatibilities,
        "description_length": len(description),
        "channels": item.get("channels", []),
    }
