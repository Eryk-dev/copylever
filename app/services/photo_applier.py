"""
Service for applying a set of photos to multiple ML items.

Strategy for cross-account photo application:
1. Download each photo from its source URL
2. Upload to the TARGET seller via POST /pictures/items/upload
3. PUT /items/{target_id} with the target-seller-owned picture IDs
4. Update variations with the new picture IDs

This avoids user_product.repeated.conflict errors that occur when
picture IDs from a different seller/item are used directly.
"""
import asyncio
import logging
from typing import Any

import httpx

from app.db.supabase import get_db
from app.services.item_copier import _log_api_debug
from app.services.ml_api import MlApiError, get_item, update_item, upload_picture

logger = logging.getLogger(__name__)

# Timeout for downloading source images
_DOWNLOAD_TIMEOUT = 30.0


async def _download_image(url: str) -> tuple[bytes, str]:
    """Download an image from a URL and return (bytes, content_type)."""
    async with httpx.AsyncClient(timeout=_DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "image/jpeg")
        # Normalize content type
        if "png" in content_type:
            content_type = "image/png"
        elif "jpeg" in content_type or "jpg" in content_type:
            content_type = "image/jpeg"
        else:
            content_type = "image/jpeg"
        return resp.content, content_type


async def _upload_photos_to_seller(
    pictures: list[dict[str, str]],
    seller_slug: str,
    org_id: str,
) -> list[str]:
    """Upload photos to a target seller and return their new picture IDs.

    For each picture:
    - If it has a 'source' URL: download and re-upload to the target seller
    - If it has an 'id': try to get its URL from ML CDN and re-upload

    Returns list of new picture IDs owned by the target seller.
    """
    new_pic_ids: list[str] = []

    for i, pic in enumerate(pictures):
        url = pic.get("source")
        if not url and pic.get("id"):
            # Construct ML CDN URL from picture ID
            url = f"https://http2.mlstatic.com/D_{pic['id']}-F.jpg"

        if not url:
            logger.warning("Skipping picture %d: no source URL or id", i)
            continue

        try:
            img_bytes, content_type = await _download_image(url)
            ext = "png" if "png" in content_type else "jpg"
            filename = f"photo_{i}.{ext}"

            result = await upload_picture(
                seller_slug=seller_slug,
                file_bytes=img_bytes,
                filename=filename,
                content_type=content_type,
                org_id=org_id,
            )
            pic_id = result.get("id")
            if pic_id:
                new_pic_ids.append(pic_id)
                logger.info(
                    "Uploaded photo %d to seller %s: %s", i, seller_slug, pic_id,
                )
            else:
                logger.warning("Upload returned no id for photo %d to seller %s", i, seller_slug)
        except Exception as exc:
            logger.error("Failed to download/upload photo %d (%s) to %s: %s", i, url, seller_slug, exc)
            # Continue with remaining photos rather than failing all

        # Pace uploads to avoid rate limits
        if i < len(pictures) - 1:
            await asyncio.sleep(0.5)

    return new_pic_ids


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

    # Build source URL list for fallback/upload
    source_urls = []
    for pic in pictures:
        url = pic.get("source")
        if not url and pic.get("id"):
            url = f"https://http2.mlstatic.com/D_{pic['id']}-F.jpg"
        if url:
            source_urls.append(url)

    # Guard: never send empty pictures (would wipe all photos from listings)
    if not source_urls:
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

    # Group targets by seller_slug so we upload photos once per seller
    seller_targets: dict[str, list[dict[str, str]]] = {}
    for t in targets:
        seller_targets.setdefault(t["seller_slug"], []).append(t)

    # Pre-upload photos to each unique target seller
    seller_pic_ids: dict[str, list[str]] = {}
    for seller_slug in seller_targets:
        logger.info(
            "Uploading %d photos to seller %s for %d targets",
            len(pictures), seller_slug, len(seller_targets[seller_slug]),
        )
        pic_ids = await _upload_photos_to_seller(pictures, seller_slug, org_id or "")
        if pic_ids:
            seller_pic_ids[seller_slug] = pic_ids
        else:
            logger.warning("No photos uploaded to seller %s, will try source URLs", seller_slug)

    results: list[dict[str, Any]] = []
    success_count = 0
    error_count = 0

    try:
        for idx, target in enumerate(targets):
            if idx > 0:
                await asyncio.sleep(1)  # pace between targets to respect ML rate limits

            try:
                # Determine which pictures payload to use
                uploaded_ids = seller_pic_ids.get(target["seller_slug"])
                if uploaded_ids:
                    # Use pre-uploaded picture IDs (owned by the target seller)
                    ml_pictures = [{"id": pid} for pid in uploaded_ids]
                else:
                    # Fallback: use source URLs directly
                    ml_pictures = [{"source": url} for url in source_urls]

                # Step 1: PUT item-level pictures with retry for transient errors.
                max_retries = 3
                for attempt in range(1, max_retries + 1):
                    try:
                        await update_item(
                            target["seller_slug"],
                            target["item_id"],
                            {"pictures": ml_pictures},
                            org_id=org_id or "",
                        )
                        break  # success
                    except MlApiError as ml_exc:
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
                # actually assigned and update variations.
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
