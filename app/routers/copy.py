"""
Copy endpoints — POST /api/copy, GET /api/copy/logs, GET /api/copy/preview
"""
import asyncio
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.db.supabase import get_db
from app.routers.auth import require_active_org, require_user
from app.services.item_copier import copy_items, copy_with_dimensions
from app.services.ml_api import get_item, get_item_description, get_item_compatibilities

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/copy", tags=["copy"])


async def _resolve_item_seller(item_id: str, org_id: str, skip_seller: str | None = None) -> tuple[str | None, dict | None]:
    """Try all connected sellers IN PARALLEL to find one that can fetch the item.

    Returns (seller_slug, item_data) from the first seller that succeeds, or (None, None).
    """
    db = get_db()
    sellers = db.table("copy_sellers").select("slug").eq("active", True).eq("org_id", org_id).execute()
    if not sellers.data:
        return None, None

    slugs = [r["slug"] for r in sellers.data if r["slug"] != skip_seller]
    if not slugs:
        return None, None

    async def _try(slug: str) -> tuple[str, dict]:
        item = await get_item(slug, item_id, org_id=org_id)
        return slug, item

    tasks = [asyncio.create_task(_try(s)) for s in slugs]

    # Return the first successful result, cancel the rest
    for coro in asyncio.as_completed(tasks):
        try:
            slug, item = await coro
            for t in tasks:
                t.cancel()
            return slug, item
        except Exception:
            continue

    return None, None


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
async def copy_anuncios(req: CopyRequest, user: dict = Depends(require_active_org)):
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

    org_id = user["org_id"]
    results = await copy_items(
        source_seller=req.source,
        dest_sellers=req.destinations,
        item_ids=clean_ids,
        user_id=user["id"],
        org_id=org_id,
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
async def copy_with_dims(req: CopyWithDimensionsRequest, user: dict = Depends(require_active_org)):
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

    org_id = user["org_id"]
    item_id = req.item_id.strip()
    results = await copy_with_dimensions(
        source_seller=req.source,
        dest_sellers=req.destinations,
        item_id=item_id,
        dimensions=dims,
        org_id=org_id,
    )

    success_count = sum(1 for r in results if r["status"] == "success")
    error_count = sum(1 for r in results if r["status"] == "error")

    # Update any existing needs_dimensions log entries for this item
    if success_count > 0:
        db = get_db()
        dest_item_ids = {r["dest_seller"]: r["dest_item_id"] for r in results if r["status"] == "success"}
        new_errors = {r["dest_seller"]: r["error"] for r in results if r["status"] != "success" and r.get("error")}
        new_status = "success" if error_count == 0 else "partial"
        try:
            db.table("copy_logs").update({
                "status": new_status,
                "dest_item_ids": dest_item_ids or None,
                "error_details": new_errors or None,
            }).eq("source_item_id", item_id).eq(
                "source_seller", req.source
            ).eq("status", "needs_dimensions").eq("org_id", org_id).execute()
        except Exception as e:
            logger.warning(f"Failed to update needs_dimensions logs for {item_id}: {e}")

    return {
        "total": len(results),
        "success": success_count,
        "errors": error_count,
        "results": results,
    }


class RetryDimensionsRequest(BaseModel):
    log_id: int
    dimensions: Dimensions


@router.post("/retry-dimensions")
async def retry_dimensions(req: RetryDimensionsRequest, user: dict = Depends(require_active_org)):
    """Retry a dimension-failed copy from the logs history."""
    db = get_db()

    org_id = user["org_id"]

    # 1. Fetch the original log entry (scoped by org)
    log_query = db.table("copy_logs").select("*").eq("id", req.log_id)
    if not user.get("is_super_admin"):
        log_query = log_query.eq("org_id", org_id)
    log_result = log_query.execute()
    if not log_result.data:
        raise HTTPException(status_code=404, detail="Log nao encontrado")
    log = log_result.data[0]

    # 2. Verify it's a dimension error (new status or old error with dimension message)
    is_dim_error = log["status"] == "needs_dimensions"
    if not is_dim_error and log["status"] == "error" and log.get("error_details"):
        details = log["error_details"]
        if isinstance(details, dict):
            is_dim_error = any(
                isinstance(v, str) and ("dimenso" in v.lower() or "dimension" in v.lower())
                for v in details.values()
            )
    if not is_dim_error:
        raise HTTPException(status_code=400, detail="Este log nao e um erro de dimensoes")

    # 3. Permission checks
    source = log["source_seller"]
    destinations = log["dest_sellers"]
    if not _check_seller_permission(user, source, "from"):
        raise HTTPException(status_code=403, detail=f"Sem permissao de origem para '{source}'")
    denied = [d for d in destinations if not _check_seller_permission(user, d, "to")]
    if denied:
        raise HTTPException(status_code=403, detail=f"Sem permissao de destino para: {', '.join(denied)}")

    dims = req.dimensions.model_dump(exclude_none=True)
    if not dims:
        raise HTTPException(status_code=400, detail="Pelo menos uma dimensao e necessaria")

    # 4. Run copy with dimensions
    results = await copy_with_dimensions(
        source_seller=source,
        dest_sellers=destinations,
        item_id=log["source_item_id"],
        dimensions=dims,
        org_id=org_id,
    )

    success_count = sum(1 for r in results if r["status"] == "success")
    error_count = sum(1 for r in results if r["status"] == "error")

    # 5. Update the original log row
    dest_item_ids = {r["dest_seller"]: r["dest_item_id"] for r in results if r["status"] == "success"}
    new_errors = {r["dest_seller"]: r["error"] for r in results if r["status"] != "success" and r.get("error")}
    new_status = "success" if error_count == 0 else ("partial" if success_count > 0 else "error")

    db.table("copy_logs").update({
        "status": new_status,
        "dest_item_ids": dest_item_ids or None,
        "error_details": new_errors or None,
    }).eq("id", req.log_id).eq("org_id", org_id).execute()

    return {
        "log_id": req.log_id,
        "total": len(results),
        "success": success_count,
        "errors": error_count,
        "results": results,
    }


@router.get("/logs")
async def copy_logs(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None),
    user: dict = Depends(require_active_org),
):
    """Get copy history. Operators see only their own logs; admins see all."""
    db = get_db()
    query = db.table("copy_logs").select("*, users(username)").order(
        "created_at", desc=True
    )
    if user.get("is_super_admin"):
        pass  # super-admin sees all logs
    elif user["role"] == "admin":
        query = query.eq("org_id", user["org_id"])
    else:
        query = query.eq("user_id", user["id"])
    if status:
        query = query.eq("status", status)
    result = query.range(offset, offset + limit - 1).execute()
    # Flatten the joined username into each log entry
    logs = []
    for row in result.data or []:
        users_data = row.pop("users", None)
        row["username"] = users_data["username"] if users_data else None
        logs.append(row)
    return logs


@router.get("/preview/{item_id}")
async def preview_item(item_id: str, seller: str = Query(...), user: dict = Depends(require_active_org)):
    """Preview an item before copying. Auto-detects owner seller on 403."""
    org_id = user["org_id"]
    try:
        item = await get_item(seller, item_id, org_id=org_id)
    except Exception as first_err:
        # First seller failed — try all other connected sellers
        resolved_seller, resolved_item = await _resolve_item_seller(item_id, org_id=org_id, skip_seller=seller)
        if resolved_seller and resolved_item:
            seller = resolved_seller
            item = resolved_item
        else:
            raise HTTPException(status_code=404, detail=f"Item not found: {first_err}")

    # Fetch description
    description = ""
    try:
        desc_data = await get_item_description(seller, item_id, org_id=org_id)
        description = desc_data.get("plain_text", "")
    except Exception:
        pass

    # Check compatibilities
    has_compatibilities = False
    try:
        compat = await get_item_compatibilities(seller, item_id, org_id=org_id)
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
        "seller": seller,
    }


def _normalize_item_id(raw: str) -> str:
    """Normalize an item ID to MLB format."""
    clean = raw.strip()
    m = re.match(r"MLB[-]?(\d+)", clean, re.IGNORECASE)
    if m:
        return f"MLB{m.group(1)}"
    if clean.isdigit():
        return f"MLB{clean}"
    return clean


async def _resolve_items_sellers(item_ids: list[str], org_id: str) -> dict[str, str]:
    """Resolve source seller for multiple items in parallel.

    Returns {item_id: seller_slug} for items that were found.
    """

    async def _resolve_one(item_id: str) -> tuple[str, str | None]:
        slug, _ = await _resolve_item_seller(item_id, org_id=org_id)
        return item_id, slug

    tasks = await asyncio.gather(
        *[_resolve_one(iid) for iid in item_ids],
        return_exceptions=True,
    )

    result: dict[str, str] = {}
    for t in tasks:
        if isinstance(t, Exception):
            continue
        item_id, slug = t
        if slug:
            result[item_id] = slug
    return result


class ResolveSellersRequest(BaseModel):
    item_ids: list[str]


@router.post("/resolve-sellers")
async def resolve_sellers_endpoint(req: ResolveSellersRequest, user: dict = Depends(require_active_org)):
    """Bulk-resolve which seller owns each item."""
    clean_ids = [_normalize_item_id(iid) for iid in req.item_ids if iid.strip()]
    if not clean_ids:
        return {"results": [], "errors": []}

    org_id = user["org_id"]
    resolved = await _resolve_items_sellers(clean_ids, org_id=org_id)

    results = []
    errors = []
    for iid in clean_ids:
        if iid in resolved:
            results.append({"item_id": iid, "seller_slug": resolved[iid]})
        else:
            errors.append({"item_id": iid, "error": "Item nao encontrado em nenhum seller conectado"})

    return {"results": results, "errors": errors}
