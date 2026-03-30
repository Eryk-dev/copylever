"""
Service for applying a set of photos to multiple ML items.
"""
import asyncio
import logging
from typing import Any

from app.db.supabase import get_db
from app.services.item_copier import _log_api_debug
from app.services.ml_api import MlApiError, update_item

logger = logging.getLogger(__name__)


async def apply_photos_to_targets(
    source_item_id: str,
    sku: str | None,
    pictures: list[dict[str, str]],
    targets: list[dict[str, str]],
    user_id: str | None = None,
    org_id: str | None = None,
) -> list[dict[str, Any]]:
    """Apply a set of photos to multiple target items via ML API.

    Parameters:
        source_item_id: The MLB from which photos were edited.
        sku: Optional SKU associated with the operation.
        pictures: List of dicts, each with 'id' (existing picture) or 'source' (URL).
        targets: List of dicts with 'seller_slug' and 'item_id'.
        user_id: ID of the user who triggered the operation.
        org_id: Organization ID for multi-tenant scoping.

    Returns per-target results with status/error.
    """
    db = get_db()

    # Create photo_logs record with status 'processing'
    log_row: dict[str, Any] = {
        "source_item_id": source_item_id,
        "sku": sku or "",
        "targets": [
            {"seller_slug": t["seller_slug"], "item_id": t["item_id"], "status": "pending", "error": None}
            for t in targets
        ],
        "total_targets": len(targets),
        "success_count": 0,
        "error_count": 0,
        "status": "processing",
    }
    if user_id:
        log_row["user_id"] = user_id
    if org_id:
        log_row["org_id"] = org_id

    insert_resp = db.table("photo_logs").insert(log_row).execute()
    log_id = insert_resp.data[0]["id"] if insert_resp.data else None

    # Build the pictures payload for ML PUT /items/{id}
    ml_pictures = []
    for pic in pictures:
        if pic.get("id"):
            ml_pictures.append({"id": pic["id"]})
        elif pic.get("source"):
            ml_pictures.append({"source": pic["source"]})

    results: list[dict[str, Any]] = []
    success_count = 0
    error_count = 0

    for idx, target in enumerate(targets):
        if idx > 0:
            await asyncio.sleep(1)  # pace between targets to respect ML rate limits

        try:
            await update_item(
                target["seller_slug"],
                target["item_id"],
                {"pictures": ml_pictures},
                org_id=org_id or "",
            )
            results.append({
                "seller_slug": target["seller_slug"],
                "item_id": target["item_id"],
                "status": "ok",
                "error": None,
            })
            success_count += 1
        except Exception as exc:
            error_msg = str(exc) or repr(exc)
            logger.error(
                "Failed to apply photos to %s (seller %s): %s",
                target["item_id"], target["seller_slug"], error_msg,
            )
            results.append({
                "seller_slug": target["seller_slug"],
                "item_id": target["item_id"],
                "status": "error",
                "error": error_msg,
            })
            error_count += 1
            _log_api_debug(
                action="apply_photos_to_target",
                source_seller=None,
                dest_seller=target["seller_slug"],
                source_item_id=source_item_id,
                dest_item_id=target["item_id"],
                user_id=user_id,
                copy_log_id=log_id,
                api_method=exc.method if isinstance(exc, MlApiError) else None,
                api_url=exc.url if isinstance(exc, MlApiError) else None,
                response_status=exc.status_code if isinstance(exc, MlApiError) else None,
                response_body=exc.payload if isinstance(exc, MlApiError) and isinstance(exc.payload, dict) else None,
                error_message=error_msg,
                org_id=org_id,
            )

    # Determine final status
    if error_count == 0:
        final_status = "completed"
    elif success_count == 0:
        final_status = "error"
    else:
        final_status = "partial"

    # Update photo_logs with final results
    if log_id:
        db.table("photo_logs").update({
            "targets": results,
            "success_count": success_count,
            "error_count": error_count,
            "status": final_status,
        }).eq("id", log_id).execute()

    return results
