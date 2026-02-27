"""
Orchestration service for copying vehicle compatibilities
from a source item to multiple target items across all sellers.
"""
import asyncio
import logging
from typing import Any

from app.db.supabase import get_db
from app.services.ml_api import (
    MlApiError,
    copy_item_compatibilities,
    get_item,
    get_item_compatibilities,
    search_items_by_sku,
)
from app.services.item_copier import _log_api_debug

logger = logging.getLogger(__name__)


async def search_sku_all_sellers(
    skus: list[str],
    allowed_sellers: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Search for items matching the given SKUs across connected sellers.

    If allowed_sellers is provided, only those sellers are searched.
    Returns a list of dicts with: seller_slug, seller_name, item_id, sku, title.
    """
    db = get_db()
    sellers_resp = db.table("copy_sellers").select("slug, name, ml_user_id").execute()
    sellers = sellers_resp.data or []

    if allowed_sellers is not None:
        sellers = [s for s in sellers if s["slug"] in allowed_sellers]

    # Build tasks: one per seller+SKU combination
    tasks: list[tuple[dict[str, Any], str, asyncio.Task[list[str]]]] = []
    for seller in sellers:
        for sku in skus:
            task = asyncio.create_task(search_items_by_sku(seller["slug"], sku))
            tasks.append((seller, sku, task))

    # Await all search tasks in parallel
    results: list[dict[str, Any]] = []
    item_info_tasks: list[tuple[dict[str, Any], str, str, asyncio.Task[dict[str, Any]]]] = []

    for seller, sku, task in tasks:
        item_ids = await task
        for item_id in item_ids:
            info_task = asyncio.create_task(get_item(seller["slug"], item_id))
            item_info_tasks.append((seller, sku, item_id, info_task))

    for seller, sku, item_id, info_task in item_info_tasks:
        try:
            item_data = await info_task
            title = item_data.get("title", "")
        except Exception:
            logger.warning("Failed to fetch item info for %s", item_id)
            title = ""
        results.append({
            "seller_slug": seller["slug"],
            "seller_name": seller["name"],
            "item_id": item_id,
            "sku": sku,
            "title": title,
        })

    return results


async def _resolve_source_seller(source_item_id: str) -> str | None:
    """Find which connected seller owns the source item."""
    db = get_db()
    sellers = (db.table("copy_sellers").select("slug").execute()).data or []
    for s in sellers:
        try:
            await get_item(s["slug"], source_item_id)
            return s["slug"]
        except Exception:
            continue
    return None


async def copy_compat_to_targets(
    source_item_id: str,
    targets: list[dict[str, str]],
    skus: list[str] | None = None,
    log_id: int | None = None,
) -> list[dict[str, Any]]:
    """Copy compatibilities from source item to each target item.

    Each target dict must have: seller_slug, item_id.
    If log_id is provided, updates the existing compat_logs row with final results.
    Otherwise, inserts a new row (legacy behavior).
    Returns per-target results with status/error.
    """
    # Pre-fetch source compatibilities once (needs source seller's token).
    source_compat_products: list[dict] | None = None
    source_seller = await _resolve_source_seller(source_item_id)
    if source_seller:
        try:
            compat = await get_item_compatibilities(source_seller, source_item_id)
            if compat and isinstance(compat, dict):
                source_compat_products = compat.get("products")
        except Exception:
            logger.warning("Could not pre-fetch source compats for %s", source_item_id)

    results: list[dict[str, Any]] = []
    success_count = 0
    error_count = 0

    for idx, target in enumerate(targets):
        if idx > 0:
            await asyncio.sleep(1)  # pace between targets to respect ML rate limits
        try:
            await copy_item_compatibilities(
                target["seller_slug"], target["item_id"], source_item_id,
                source_compat_products=source_compat_products,
            )
            results.append({
                "seller_slug": target["seller_slug"],
                "item_id": target["item_id"],
                "status": "ok",
                "error": None,
            })
            success_count += 1
        except Exception as exc:
            logger.error(
                "Failed to copy compat to %s: %s", target["item_id"], exc
            )
            results.append({
                "seller_slug": target["seller_slug"],
                "item_id": target["item_id"],
                "status": "error",
                "error": str(exc),
            })
            error_count += 1
            _log_api_debug(
                action="copy_compat_to_target",
                source_seller=source_seller,
                dest_seller=target["seller_slug"],
                source_item_id=source_item_id,
                dest_item_id=target["item_id"],
                copy_log_id=log_id,
                api_method=exc.method if isinstance(exc, MlApiError) else None,
                api_url=exc.url if isinstance(exc, MlApiError) else None,
                response_status=exc.status_code if isinstance(exc, MlApiError) else None,
                response_body=exc.payload if isinstance(exc, MlApiError) and isinstance(exc.payload, dict) else None,
                error_message=str(exc),
            )

    # Determine final status
    if error_count == 0:
        final_status = "success"
    elif success_count == 0:
        final_status = "error"
    else:
        final_status = "partial"

    # Update or insert compat_logs
    db = get_db()
    log_data = {
        "targets": results,
        "success_count": success_count,
        "error_count": error_count,
        "status": final_status,
    }
    if log_id:
        db.table("compat_logs").update(log_data).eq("id", log_id).execute()
    else:
        db.table("compat_logs").insert({
            "source_item_id": source_item_id,
            "skus": skus or [],
            "total_targets": len(targets),
            **log_data,
        }).execute()

    return results
