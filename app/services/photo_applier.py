"""
Service for applying a set of photos to multiple ML items.
"""
import asyncio
import logging
from typing import Any

from app.db.supabase import get_db
from app.services.item_copier import _log_api_debug
from app.services.ml_api import MlApiError, get_item, update_item

logger = logging.getLogger(__name__)


async def apply_photos_to_targets(
    source_item_id: str,
    sku: str | None,
    pictures: list[dict[str, str]],
    targets: list[dict[str, str]],
    user_id: str | None = None,
    org_id: str | None = None,
    log_id: int | None = None,
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

    # Create photo_logs record if no existing log_id was provided
    if log_id is None:
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

    # Guard: never send empty pictures (would wipe all photos from listings)
    if not ml_pictures:
        logger.error("apply_photos_to_targets called with no valid pictures for source=%s", source_item_id)
        if log_id:
            error_results = [
                {**t, "status": "error", "error": "Nenhuma foto válida para aplicar"}
                for t in targets
            ]
            db.table("photo_logs").update({
                "targets": error_results,
                "error_count": len(targets),
                "status": "error",
            }).eq("id", log_id).execute()
        return [{"seller_slug": t["seller_slug"], "item_id": t["item_id"], "status": "error", "error": "Nenhuma foto válida"} for t in targets]

    results: list[dict[str, Any]] = []
    success_count = 0
    error_count = 0

    try:
        for idx, target in enumerate(targets):
            if idx > 0:
                await asyncio.sleep(1)  # pace between targets to respect ML rate limits

            try:
                # Step 1: PUT item-level pictures only, with retry for transient errors.
                user_product_conflict = False
                max_retries = 3
                for attempt in range(1, max_retries + 1):
                    try:
                        await update_item(
                            target["seller_slug"],
                            target["item_id"],
                            {"pictures": list(ml_pictures)},
                            org_id=org_id or "",
                        )
                        break  # success
                    except MlApiError as ml_exc:
                        # ML returns 400 user_product.repeated.conflict but
                        # still applies the photo change — treat as success.
                        if (
                            ml_exc.status_code == 400
                            and "user_product" in (ml_exc.detail or "").lower()
                            and "repeated" in (ml_exc.detail or "").lower()
                        ):
                            logger.info(
                                "User product repeated conflict for %s — ML applies change despite 400, treating as success",
                                target["item_id"],
                            )
                            user_product_conflict = True
                            break
                        is_transient = (
                            ml_exc.status_code >= 500
                            or ml_exc.status_code == 409
                        )
                        if is_transient and attempt < max_retries:
                            wait = 3 * (2 ** (attempt - 1))  # 3s, 6s
                            logger.warning(
                                "Transient ML error %d for %s (attempt %d/%d), retrying in %ds: %s",
                                ml_exc.status_code, target["item_id"], attempt, max_retries, wait, ml_exc.detail,
                            )
                            await asyncio.sleep(wait)
                            continue
                        raise  # non-transient or last attempt — propagate

                # Step 2: Re-read the item to get the picture IDs that ML
                # actually assigned (they may differ from the source IDs when
                # photos are copied across sellers).
                # Skip variation update for User Product conflicts — they don't
                # accept variation updates and the photos are already applied.
                if not user_product_conflict:
                    try:
                        updated_item = await get_item(
                            target["seller_slug"], target["item_id"], org_id=org_id or "",
                        )
                        target_variations = updated_item.get("variations", [])
                        actual_pic_ids = [
                            p["id"] for p in updated_item.get("pictures", [])
                            if p.get("id")
                        ]
                        if target_variations and actual_pic_ids:
                            # Step 3: PUT variation picture_ids using the real IDs.
                            await update_item(
                                target["seller_slug"],
                                target["item_id"],
                                {"variations": [
                                    {"id": var["id"], "picture_ids": list(actual_pic_ids)}
                                    for var in target_variations
                                    if var.get("id")
                                ]},
                                org_id=org_id or "",
                            )
                    except Exception as var_err:
                        # Item-level photos succeeded; log variation failure as warning
                        logger.warning(
                            "Photos applied to %s but variation update failed: %s",
                            target["item_id"], var_err,
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
    except Exception as fatal:
        # Top-level handler: mark remaining targets as error
        logger.exception("Fatal error in apply_photos_to_targets: %s", fatal)
        for remaining in targets[len(results):]:
            results.append({
                "seller_slug": remaining["seller_slug"],
                "item_id": remaining["item_id"],
                "status": "error",
                "error": f"Erro inesperado: {fatal}",
            })
            error_count += 1

    # Determine final status
    if error_count == 0:
        final_status = "completed"
    elif success_count == 0:
        final_status = "error"
    else:
        final_status = "partial"

    # Update photo_logs with final results
    if log_id:
        try:
            db.table("photo_logs").update({
                "targets": results,
                "success_count": success_count,
                "error_count": error_count,
                "status": final_status,
            }).eq("id", log_id).execute()
        except Exception as db_err:
            logger.error("Failed to update photo_logs id=%s: %s", log_id, db_err)

    return results
