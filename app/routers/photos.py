"""
Photos endpoints — preview item photos, upload, search SKU, apply, logs.
"""
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.db.supabase import get_db
from app.routers.auth import require_active_org
from app.services.ml_api import get_item

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/photos", tags=["photos"])


async def _resolve_item_seller(
    item_id: str, org_id: str, skip_seller: str | None = None
) -> tuple[str | None, dict | None]:
    """Try all connected ML sellers in parallel to find one that can fetch the item."""
    db = get_db()
    sellers = (
        db.table("copy_sellers")
        .select("slug")
        .eq("active", True)
        .eq("org_id", org_id)
        .execute()
    )
    if not sellers.data:
        return None, None

    slugs = [r["slug"] for r in sellers.data if r["slug"] != skip_seller]
    if not slugs:
        return None, None

    async def _try(slug: str) -> tuple[str, dict]:
        item = await get_item(slug, item_id, org_id=org_id)
        return slug, item

    tasks = [asyncio.create_task(_try(s)) for s in slugs]

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
async def preview_item(
    item_id: str,
    seller: str = Query(None),
    user: dict = Depends(require_active_org),
):
    """Preview an item's photos and SKUs."""
    org_id = user["org_id"]

    if not seller:
        db = get_db()
        result = (
            db.table("copy_sellers")
            .select("slug")
            .eq("org_id", org_id)
            .eq("active", True)
            .limit(1)
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=400, detail="Nenhum seller conectado")
        seller = result.data[0]["slug"]

    try:
        item = await get_item(seller, item_id, org_id=org_id)
    except Exception as first_err:
        resolved_seller, resolved_item = await _resolve_item_seller(
            item_id, org_id=org_id, skip_seller=seller
        )
        if resolved_seller and resolved_item:
            seller = resolved_seller
            item = resolved_item
        else:
            raise HTTPException(status_code=404, detail=f"Item não encontrado: {first_err}")

    # Extract pictures
    pictures = []
    for pic in item.get("pictures", []):
        pictures.append({
            "id": pic.get("id"),
            "url": pic.get("url"),
            "secure_url": pic.get("secure_url"),
            "size": pic.get("size"),
        })

    # Extract SKUs (same logic as compat preview)
    skus: list[str] = []
    item_sku = item.get("seller_custom_field")
    if item_sku:
        skus.append(item_sku)
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
    # Deduplicate preserving order
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
        "pictures": pictures,
        "skus": unique_skus,
        "seller": seller,
    }
