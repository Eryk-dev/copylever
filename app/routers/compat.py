"""
Compat endpoints — preview, search-sku, copy, logs for vehicle compatibilities.
"""
import asyncio
import logging
import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator

from app.db.supabase import get_db
from app.routers.auth import require_active_org, require_user
from app.services.compat_copier import copy_compat_to_targets, search_sku_all_sellers
from app.services.ml_api import get_item, get_item_compatibilities


def _normalize_mlb(raw: str) -> str:
    clean = raw.strip()
    m = re.match(r"MLB[-]?(\d+)", clean, re.IGNORECASE)
    if m:
        return f"MLB{m.group(1)}"
    if clean.isdigit():
        return f"MLB{clean}"
    return clean

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/compat", tags=["compat"])


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


@router.get("/preview/{item_id}")
async def preview_item(item_id: str, seller: str = Query(None), user: dict = Depends(require_active_org)):
    """Preview an item's compatibility info."""
    # Check can_run_compat (admins bypass)
    if user["role"] != "admin" and not user.get("can_run_compat"):
        raise HTTPException(status_code=403, detail="Sem permissão para rodar compatibilidade")
    org_id = user["org_id"]
    # If no seller provided, use the first connected seller
    if not seller:
        db = get_db()
        result = db.table("copy_sellers").select("slug").eq("org_id", org_id).eq("active", True).limit(1).execute()
        if not result.data:
            raise HTTPException(status_code=400, detail="No connected sellers found")
        seller = result.data[0]["slug"]

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

    has_compatibilities = False
    compat_count = 0
    try:
        compat = await get_item_compatibilities(seller, item_id, org_id=org_id)
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

    # Extract SKUs from item-level and variation-level fields
    skus: list[str] = []
    item_sku = item.get("seller_custom_field")
    if item_sku:
        skus.append(item_sku)
    # Check item-level attributes for SELLER_SKU
    for attr in item.get("attributes", []):
        if attr.get("id") == "SELLER_SKU" and attr.get("value_name"):
            skus.append(attr["value_name"])
    for var in item.get("variations", []):
        var_sku = var.get("seller_custom_field")
        if var_sku:
            skus.append(var_sku)
        for attr in var.get("attributes", []):
            if attr.get("id") == "SELLER_SKU" and attr.get("value_name"):
                skus.append(attr["value_name"])
    # Deduplicate while preserving order
    seen: set[str] = set()
    unique_skus: list[str] = []
    for s in skus:
        if s not in seen:
            seen.add(s)
            unique_skus.append(s)

    return {
        "id": item.get("id"),
        "title": item.get("title"),
        "thumbnail": item.get("secure_thumbnail") or item.get("thumbnail"),
        "has_compatibilities": has_compatibilities,
        "compat_count": compat_count,
        "skus": unique_skus,
        "seller": seller,
    }


class SearchSkuRequest(BaseModel):
    skus: list[str]

    @field_validator("skus")
    @classmethod
    def limit_skus(cls, v: list[str]) -> list[str]:
        if len(v) > 50:
            raise ValueError("Maximo de 50 SKUs por busca")
        return v


@router.post("/search-sku")
async def search_sku(req: SearchSkuRequest, user: dict = Depends(require_active_org)):
    """Search for items by SKU across connected sellers (filtered by permissions)."""
    if not req.skus:
        raise HTTPException(status_code=400, detail="At least one SKU is required")

    org_id = user["org_id"]
    # Filter sellers by can_copy_to permission (admins get all)
    allowed_sellers = None
    if user["role"] != "admin":
        allowed_sellers = [
            p["seller_slug"]
            for p in user.get("permissions", [])
            if p.get("can_copy_to")
        ]

    results = await search_sku_all_sellers(req.skus, allowed_sellers=allowed_sellers, org_id=org_id)
    return results


class ResolveMlbsRequest(BaseModel):
    item_ids: list[str]

    @field_validator("item_ids")
    @classmethod
    def limit_items(cls, v: list[str]) -> list[str]:
        if len(v) > 50:
            raise ValueError("Maximo de 50 MLBs por busca")
        return v


@router.post("/resolve-mlbs")
async def resolve_mlbs(req: ResolveMlbsRequest, user: dict = Depends(require_active_org)):
    """Resolve owning seller for each MLB ID, as compat targets.

    Same response shape as /search-sku. Filtered by can_copy_to (admins see all).
    """
    if not req.item_ids:
        raise HTTPException(status_code=400, detail="Informe pelo menos um MLB")

    org_id = user["org_id"]
    clean_ids = list(dict.fromkeys(_normalize_mlb(iid) for iid in req.item_ids if iid.strip()))
    if not clean_ids:
        return []

    db = get_db()
    sellers_resp = (
        db.table("copy_sellers")
        .select("slug, name")
        .eq("active", True)
        .eq("org_id", org_id)
        .execute()
    )
    sellers_by_slug = {s["slug"]: s["name"] for s in (sellers_resp.data or [])}

    allowed_slugs = set(sellers_by_slug.keys())
    if user["role"] != "admin":
        allowed_slugs &= {
            p["seller_slug"]
            for p in user.get("permissions", [])
            if p.get("can_copy_to")
        }

    if not allowed_slugs:
        return []

    sem = asyncio.Semaphore(10)

    async def _try(slug: str, item_id: str) -> tuple[str, dict | None]:
        async with sem:
            try:
                data = await get_item(slug, item_id, org_id=org_id)
                return slug, data
            except Exception:
                return slug, None

    async def _resolve_one(item_id: str) -> dict | None:
        tasks = [asyncio.create_task(_try(slug, item_id)) for slug in allowed_slugs]
        try:
            for coro in asyncio.as_completed(tasks):
                slug, data = await coro
                if data:
                    return {
                        "seller_slug": slug,
                        "seller_name": sellers_by_slug.get(slug, slug),
                        "item_id": data.get("id", item_id),
                        "sku": item_id,
                        "title": data.get("title", ""),
                        "thumbnail": data.get("secure_thumbnail") or data.get("thumbnail") or "",
                        "matched_by": "mlb",
                    }
            return None
        finally:
            for t in tasks:
                if not t.done():
                    t.cancel()

    resolved = await asyncio.gather(*[_resolve_one(iid) for iid in clean_ids])
    return [r for r in resolved if r]


class CopyTarget(BaseModel):
    seller_slug: str
    item_id: str


class CopyRequest(BaseModel):
    source_item_id: str
    targets: list[CopyTarget]
    skus: list[str] = []


@router.post("/copy")
async def copy_compat(req: CopyRequest, bg: BackgroundTasks, user: dict = Depends(require_active_org)):
    """Queue compatibility copy — returns immediately, results appear in logs."""
    # Check can_run_compat (admins bypass)
    if user["role"] != "admin" and not user.get("can_run_compat"):
        raise HTTPException(status_code=403, detail="Sem permissão para rodar compatibilidade")

    if not req.targets:
        raise HTTPException(status_code=400, detail="At least one target is required")

    org_id = user["org_id"]
    targets = [{"seller_slug": t.seller_slug, "item_id": t.item_id} for t in req.targets]

    # Create in_progress log row before starting background task
    db = get_db()
    pending_targets = [
        {**t, "status": "pending", "error": None} for t in targets
    ]
    log_insert = {
        "source_item_id": req.source_item_id,
        "skus": req.skus or [],
        "targets": pending_targets,
        "total_targets": len(targets),
        "success_count": 0,
        "error_count": 0,
        "status": "in_progress",
        "org_id": org_id,
    }
    if user.get("id"):
        log_insert["user_id"] = user["id"]
    log_row = db.table("compat_logs").insert(log_insert).execute()
    log_id = log_row.data[0]["id"]

    bg.add_task(copy_compat_to_targets, req.source_item_id, targets, req.skus, log_id, org_id=org_id)

    return {
        "status": "queued",
        "total_targets": len(targets),
        "log_id": log_id,
    }


@router.get("/logs")
async def compat_logs(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None),
    user: dict = Depends(require_active_org),
):
    """Get compat copy history. Operators see only their own logs; admins see all."""
    db = get_db()
    query = db.table("compat_logs").select("*, users(username)").order(
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
