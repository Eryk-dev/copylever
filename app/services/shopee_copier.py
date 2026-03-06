"""
Core logic for copying Shopee product listings between shops.
"""
import asyncio
import json
import logging
from typing import Any

from app.db.supabase import get_db
from app.services.item_copier import CORRECTION_STATUS, _build_dimension_correction_details
from app.services.shopee_api import (
    ShopeeApiError,
    get_item,
    get_item_extra,
    get_model_list,
    get_logistics_channels,
    upload_image,
    add_item,
    init_tier_variation,
    add_model,
)

logger = logging.getLogger(__name__)

MAX_DEBUG_PAYLOAD_SIZE = 50_000
COPY_PACING_SECONDS = 0.7
MAX_RETRY_ATTEMPTS = 3

MAX_ITEM_NAME_LEN = 120
MAX_DESCRIPTION_LEN = 3000
MAX_IMAGES = 9


async def _fetch_source_item(shop_id: int, item_id: int, org_id: str) -> dict:
    """Fetch source item data: base info + extra info + models."""
    base_resp = await get_item(shop_id, item_id, org_id)
    extra_resp = await get_item_extra(shop_id, item_id, org_id)

    try:
        models_resp = await get_model_list(shop_id, item_id, org_id)
    except ShopeeApiError as e:
        logger.warning("Failed to fetch models for item %d shop %d: %s", item_id, shop_id, e)
        models_resp = {}

    base_info = {}
    if base_resp.get("response", {}).get("item_list"):
        base_info = base_resp["response"]["item_list"][0]

    extra_info = {}
    if extra_resp.get("response", {}).get("item_list"):
        extra_info = extra_resp["response"]["item_list"][0]

    models = []
    if models_resp.get("response", {}).get("model"):
        models = models_resp["response"]["model"]

    tier_variation = []
    if models_resp.get("response", {}).get("tier_variation"):
        tier_variation = models_resp["response"]["tier_variation"]

    return {
        "base_info": base_info,
        "extra_info": extra_info,
        "models": models,
        "tier_variation": tier_variation,
    }


_UPLOAD_CONCURRENCY = 3


async def _upload_images(
    dest_shop_id: int, image_urls: list[str], org_id: str
) -> list[str]:
    """Upload images to dest shop concurrently (max 3 at a time).

    Max 9 images. Retry 1x per image on failure.
    Order of returned image_ids matches input URL order (first = cover).
    """
    urls = image_urls[:MAX_IMAGES]
    if not urls:
        return []

    sem = asyncio.Semaphore(_UPLOAD_CONCURRENCY)

    async def _guarded_upload(url: str) -> str | None:
        async with sem:
            return await _upload_single_image(dest_shop_id, url, org_id)

    results = await asyncio.gather(*[_guarded_upload(u) for u in urls])

    # Preserve order but check if cover (first) image failed
    if results and results[0] is None:
        logger.warning(
            "Cover image (index 0) failed to upload for shop %d — aborting all images",
            dest_shop_id,
        )
        return []

    image_ids = [img_id for img_id in results if img_id is not None]

    logger.info(
        "Image upload complete: %d/%d successful for shop %d",
        len(image_ids), len(urls), dest_shop_id,
    )

    return image_ids


async def _upload_single_image(
    shop_id: int, url: str, org_id: str
) -> str | None:
    """Upload a single image with 1 retry on failure."""
    for attempt in range(2):
        try:
            resp = await upload_image(shop_id, url, org_id)
            img_info = resp.get("response", {}).get("image_info", {})
            image_id = img_info.get("image_id")
            if image_id:
                return image_id
            logger.warning("Upload returned no image_id for %s (attempt %d)", url, attempt + 1)
        except (ShopeeApiError, Exception) as e:
            logger.warning("Image upload failed for %s (attempt %d): %s", url, attempt + 1, e)
            if attempt == 0:
                continue
    return None


async def _fetch_dest_logistics(dest_shop_id: int, org_id: str) -> list[dict]:
    """Fetch enabled logistics channels for destination shop."""
    resp = await get_logistics_channels(dest_shop_id, org_id)
    channels = resp.get("response", {}).get("logistics_channel_list", [])
    return [ch for ch in channels if ch.get("enabled")]


def _build_shopee_payload(
    source_data: dict,
    image_ids: list[str],
    logistics: list[dict],
    dimensions: dict | None = None,
) -> dict:
    """Build the add_item payload from source data, uploaded images, and logistics."""
    base = source_data.get("base_info", {})
    extra = source_data.get("extra_info", {})

    # Item name (max 120 chars)
    item_name = (base.get("item_name") or "")[:MAX_ITEM_NAME_LEN]

    # Description from extra info (max 3000 chars)
    description = (extra.get("description") or base.get("description") or "")[:MAX_DESCRIPTION_LEN]
    if not description:
        description = item_name  # Shopee requires description

    # Price — use original_price from base_info
    original_price = base.get("original_price", 0)

    # Stock
    normal_stock = 0
    stock_info = base.get("stock_info_v2", {})
    if stock_info:
        summary = stock_info.get("summary_info", {})
        normal_stock = summary.get("total_available_stock", 0)
    if normal_stock <= 0:
        # Fallback: try stock_info list
        for si in base.get("stock_info", []):
            if si.get("stock_type") == 2:  # normal stock
                normal_stock = si.get("normal_stock", 0) or si.get("current_stock", 0)
                break
    if normal_stock <= 0:
        normal_stock = 1  # Minimum stock

    # Category
    category_id = base.get("category_id", 0)

    # Weight in kg
    weight = base.get("weight", 0.5)
    if weight <= 0:
        weight = 0.5  # Default weight

    # Images
    image_id_list = image_ids if image_ids else []

    # Logistics info
    logistic_info = [
        {"logistic_id": ch["logistics_channel_id"], "enabled": True}
        for ch in logistics
        if ch.get("logistics_channel_id")
    ]

    # Build payload
    payload: dict = {
        "item_name": item_name,
        "description": description,
        "original_price": original_price,
        "normal_stock": normal_stock,
        "category_id": category_id,
        "image": {"image_id_list": image_id_list},
        "weight": weight,
        "logistic_info": logistic_info,
        "condition": base.get("condition", "NEW"),
    }

    # If item has variations, stock is managed per-model — exclude from add_item
    if base.get("has_model"):
        payload.pop("normal_stock", None)

    # Pre-order
    pre_order = base.get("pre_order", {})
    if pre_order and pre_order.get("is_pre_order"):
        payload["pre_order"] = {
            "is_pre_order": True,
            "days_to_ship": pre_order.get("days_to_ship", 7),
        }

    # Item SKU
    item_sku = base.get("item_sku")
    if item_sku:
        payload["item_sku"] = item_sku

    # Dimensions (from source or user-provided override)
    if dimensions:
        dim = {
            "package_height": dimensions.get("height", 0),
            "package_width": dimensions.get("width", 0),
            "package_length": dimensions.get("length", 0),
        }
        if any(v > 0 for v in dim.values()):
            payload["dimension"] = dim
        if dimensions.get("weight"):
            payload["weight"] = dimensions["weight"]
    else:
        # Try source dimensions
        src_dim = base.get("dimension", {})
        if src_dim:
            dim = {
                "package_height": src_dim.get("package_height", 0),
                "package_width": src_dim.get("package_width", 0),
                "package_length": src_dim.get("package_length", 0),
            }
            if any(v > 0 for v in dim.values()):
                payload["dimension"] = dim

    # Attributes from source
    attr_list = base.get("attribute_list", [])
    if attr_list:
        clean_attrs = []
        for attr in attr_list:
            attr_id = attr.get("attribute_id")
            if not attr_id:
                continue
            attr_values = attr.get("attribute_value_list", [])
            if attr_values:
                clean_attrs.append({
                    "attribute_id": attr_id,
                    "attribute_value_list": attr_values,
                })
        if clean_attrs:
            payload["attribute_list"] = clean_attrs

    return payload


# ── Debug logging ──────────────────────────────────────────


def _truncate_json(data: Any, max_size: int = MAX_DEBUG_PAYLOAD_SIZE) -> Any:
    """Truncate a JSON-serializable value if its serialized form exceeds max_size."""
    if data is None:
        return None
    try:
        raw = json.dumps(data, default=str)
        if len(raw) <= max_size:
            return data
        return {"_truncated": True, "_size": len(raw), "_preview": raw[:2000]}
    except Exception:
        return {"_error": "unserializable"}


def _log_debug(
    action: str,
    source_item_id: str | None = None,
    dest_seller: str | None = None,
    attempt_number: int = 1,
    error_message: str | None = None,
    request_payload: Any = None,
    response_body: Any = None,
    user_id: str | None = None,
    org_id: str | None = None,
    api_method: str | None = None,
    api_url: str | None = None,
    response_status: int | None = None,
) -> None:
    """Insert a debug log row into api_debug_logs. Never raises."""
    try:
        db = get_db()
        row: dict[str, Any] = {
            "action": action,
            "source_item_id": source_item_id,
            "dest_seller": dest_seller,
            "attempt_number": attempt_number,
            "error_message": str(error_message)[:2000] if error_message else None,
            "request_payload": _truncate_json(request_payload),
            "response_body": _truncate_json(response_body),
            "resolved": False,
            "api_method": api_method,
            "api_url": api_url,
            "response_status": response_status,
            "platform": "shopee",
        }
        if user_id:
            row["user_id"] = user_id
        if org_id:
            row["org_id"] = org_id
        db.table("api_debug_logs").insert(row).execute()
    except Exception as e:
        logger.warning("Failed to write api_debug_log: %s", e)


def _is_dimension_error(error_message: str) -> bool:
    """Check if the error relates to missing dimensions/weight."""
    msg = error_message.lower()
    return "dimension" in msg or "weight" in msg or "package" in msg


def _strip_attributes(payload: dict) -> dict:
    """Remove brand and non-essential attributes for retry attempt 2.

    Keeps attributes that have non-empty attribute_value_list (real values).
    Removes attributes with empty values (often brand or optional attrs that
    cause validation errors).
    """
    p = dict(payload)
    if "attribute_list" in p:
        p["attribute_list"] = [
            a for a in p["attribute_list"]
            if a.get("attribute_value_list")
        ]
        if not p["attribute_list"]:
            del p["attribute_list"]
    return p


def _minimal_payload(payload: dict) -> dict:
    """Build a minimal payload for retry attempt 3."""
    return {
        "item_name": payload.get("item_name", ""),
        "description": payload.get("description", ""),
        "original_price": payload.get("original_price", 0),
        "normal_stock": payload.get("normal_stock", 1),
        "category_id": payload.get("category_id", 0),
        "image": payload.get("image", {"image_id_list": []}),
        "weight": payload.get("weight", 0.5),
        "logistic_info": payload.get("logistic_info", []),
        "condition": payload.get("condition", "NEW"),
    }


# ── Variation copy ─────────────────────────────────────────


async def _copy_variations(
    dest_shop_id: int,
    new_item_id: int,
    source_data: dict,
    org_id: str,
    user_id: str | None = None,
) -> dict:
    """Copy tier variations and models to a newly created item.

    Returns {"models_copied": int, "models_total": int, "error": str | None}.
    """
    tier_variation = source_data.get("tier_variation", [])
    models = source_data.get("models", [])

    if not tier_variation or not models:
        return {"models_copied": 0, "models_total": 0, "error": None}

    models_total = len(models)

    # Build tier_variation payload — upload tier images if present
    tiers_payload: list[dict] = []
    for tier in tier_variation:
        tier_entry: dict[str, Any] = {"name": tier.get("name", "")}
        options: list[dict] = []
        for opt in tier.get("option_list", []):
            opt_entry: dict[str, Any] = {"option": opt.get("option", "")}
            img = opt.get("image") or {}
            img_url = img.get("image_url")
            if img_url:
                img_id = await _upload_single_image(dest_shop_id, img_url, org_id)
                if img_id:
                    opt_entry["image"] = {"image_id": img_id}
            options.append(opt_entry)
        tier_entry["option_list"] = options
        tiers_payload.append(tier_entry)

    # init_tier_variation — define tier structure
    try:
        await init_tier_variation(dest_shop_id, new_item_id, tiers_payload, org_id)
    except Exception as e:
        err_msg = f"init_tier_variation failed: {e}"
        logger.error(
            "Variation init failed for item %d shop %d: %s",
            new_item_id, dest_shop_id, e,
        )
        _log_debug(
            action="shopee_init_tier_variation",
            source_item_id=str(new_item_id),
            dest_seller=str(dest_shop_id),
            error_message=err_msg,
            request_payload={"tier_variation": tiers_payload},
            user_id=user_id,
            org_id=org_id,
        )
        return {"models_copied": 0, "models_total": models_total, "error": err_msg}

    # Build model_list from source models
    model_list: list[dict] = []
    for m in models:
        # Extract price
        price_info = m.get("price_info", [])
        original_price = price_info[0].get("original_price", 0) if price_info else 0

        # Extract stock
        stock = 0
        stock_v2 = m.get("stock_info_v2", {})
        if stock_v2:
            stock = stock_v2.get("summary_info", {}).get("total_available_stock", 0)
        if stock <= 0:
            for si in m.get("stock_info", []):
                if si.get("stock_type") == 2:
                    stock = si.get("normal_stock", 0) or si.get("current_stock", 0)
                    break
        if stock <= 0:
            stock = 1  # Minimum stock

        entry: dict[str, Any] = {
            "tier_index": m.get("tier_index", []),
            "normal_stock": stock,
            "original_price": original_price,
        }
        if m.get("model_sku"):
            entry["model_sku"] = m["model_sku"]
        model_list.append(entry)

    # add_model — create SKU combinations
    try:
        await add_model(dest_shop_id, new_item_id, model_list, org_id)
        logger.info(
            "Variations copied for item %d shop %d: %d models",
            new_item_id, dest_shop_id, len(model_list),
        )
        return {"models_copied": len(model_list), "models_total": models_total, "error": None}
    except Exception as e:
        err_msg = f"add_model failed: {e}"
        logger.error(
            "Model creation failed for item %d shop %d: %s",
            new_item_id, dest_shop_id, e,
        )
        _log_debug(
            action="shopee_add_model",
            source_item_id=str(new_item_id),
            dest_seller=str(dest_shop_id),
            error_message=err_msg,
            request_payload={"model_list": model_list},
            user_id=user_id,
            org_id=org_id,
        )
        return {"models_copied": 0, "models_total": models_total, "error": err_msg}


# ── Core copy functions ────────────────────────────────────


async def copy_single_item(
    source_shop_id: int,
    dest_shop_id: int,
    item_id: int,
    org_id: str,
    user_id: str | None = None,
    dimensions: dict | None = None,
    logistics: list[dict] | None = None,
    source_data: dict | None = None,
) -> dict:
    """
    Copy a single Shopee item from source shop to dest shop.
    Returns result dict with status/dest_item_id/error/sku.
    """
    result: dict[str, Any] = {
        "source_item_id": str(item_id),
        "dest_seller": str(dest_shop_id),
        "status": "pending",
        "dest_item_id": None,
        "error": None,
        "sku": None,
        "correction_details": None,
        "models_copied": 0,
        "models_total": 0,
    }

    try:
        # 1. Fetch source item (skip if pre-fetched)
        if source_data is None:
            logger.info("Fetching Shopee item %d from shop %d", item_id, source_shop_id)
            source_data = await _fetch_source_item(source_shop_id, item_id, org_id)
        result["sku"] = source_data.get("base_info", {}).get("item_sku") or None
        result["_title"] = source_data.get("base_info", {}).get("item_name") or ""
        image_url_list = source_data.get("base_info", {}).get("image", {}).get("image_url_list", [])
        result["_thumbnail"] = image_url_list[0] if image_url_list else ""

        # 2. Upload images
        image_urls = source_data.get("base_info", {}).get("image", {}).get("image_url_list", [])
        image_ids = await _upload_images(dest_shop_id, image_urls, org_id)
        if not image_ids:
            err_msg = "Falha no upload de todas as imagens — nao e possivel criar o anuncio"
            logger.error("No images uploaded for item %d -> shop %d — aborting", item_id, dest_shop_id)
            _log_debug(
                action="shopee_image_upload_failed",
                source_item_id=str(item_id),
                dest_seller=str(dest_shop_id),
                error_message=err_msg,
                request_payload={"image_urls": image_urls},
                user_id=user_id,
                org_id=org_id,
            )
            result["status"] = "error"
            result["error"] = err_msg
            return result

        # 3. Fetch dest logistics (skip if pre-fetched)
        if logistics is None:
            try:
                logistics = await _fetch_dest_logistics(dest_shop_id, org_id)
            except Exception as e:
                err_msg = "Falha ao buscar canais logisticos da loja destino"
                logger.error(
                    "Logistics fetch failed for shop %d: %s", dest_shop_id, e,
                )
                _log_debug(
                    action="shopee_logistics_fetch_failed",
                    source_item_id=str(item_id),
                    dest_seller=str(dest_shop_id),
                    error_message=f"{err_msg}: {e}",
                    user_id=user_id,
                    org_id=org_id,
                )
                result["status"] = "error"
                result["error"] = err_msg
                return result

        # 4. Build payload
        payload = _build_shopee_payload(source_data, image_ids, logistics, dimensions)

        # 5. Attempt to create item with retry logic
        last_error: str | None = None
        for attempt in range(1, MAX_RETRY_ATTEMPTS + 1):
            try:
                if attempt == 2:
                    payload = _strip_attributes(payload)
                elif attempt == 3:
                    payload = _minimal_payload(payload)

                resp = await add_item(dest_shop_id, payload, org_id)

                # Extract new item_id from response
                new_item_id = resp.get("response", {}).get("item_id")
                if new_item_id:
                    result["status"] = "success"
                    result["dest_item_id"] = str(new_item_id)
                    logger.info(
                        "Shopee item %d copied to shop %d as %s",
                        item_id, dest_shop_id, new_item_id,
                    )
                else:
                    result["status"] = "success"
                    logger.info(
                        "Shopee item %d copied to shop %d (no item_id in response)",
                        item_id, dest_shop_id,
                    )
                last_error = None
                break

            except ShopeeApiError as e:
                last_error = f"{e.error_code}: {e.message}" if e.error_code else e.message
                logger.warning(
                    "Shopee add_item failed for item %d -> shop %d (attempt %d): %s",
                    item_id, dest_shop_id, attempt, last_error,
                )
                _log_debug(
                    action="shopee_add_item",
                    source_item_id=str(item_id),
                    dest_seller=str(dest_shop_id),
                    attempt_number=attempt,
                    error_message=last_error,
                    request_payload=payload,
                    response_body=e.payload if isinstance(e.payload, dict) else {"raw": str(e.payload)},
                    user_id=user_id,
                    org_id=org_id,
                    api_method=e.method,
                    api_url=e.url,
                    response_status=e.status_code,
                )
                if attempt == MAX_RETRY_ATTEMPTS:
                    break  # exhausted retries

        # 6. Handle variations if item was created successfully
        if not last_error and result.get("dest_item_id"):
            has_model = source_data.get("base_info", {}).get("has_model", False)
            if has_model:
                var_result = await _copy_variations(
                    dest_shop_id, int(result["dest_item_id"]),
                    source_data, org_id, user_id,
                )
                result["models_copied"] = var_result["models_copied"]
                result["models_total"] = var_result["models_total"]
                if var_result["error"]:
                    result["status"] = "partial"
                    result["error"] = var_result["error"]

        if last_error:
            if _is_dimension_error(last_error):
                result["status"] = CORRECTION_STATUS
                result["error"] = "Item sem dimensoes/peso. Informe as dimensoes para continuar."
                result["correction_details"] = _build_dimension_correction_details()
            else:
                result["status"] = "error"
                result["error"] = last_error

    except ShopeeApiError as e:
        err_msg = f"{e.error_code}: {e.message}" if e.error_code else e.message
        logger.error("Shopee copy failed for item %d -> shop %d: %s", item_id, dest_shop_id, err_msg)
        if _is_dimension_error(err_msg):
            result["status"] = CORRECTION_STATUS
            result["error"] = "Item sem dimensoes/peso. Informe as dimensoes para continuar."
            result["correction_details"] = _build_dimension_correction_details()
        else:
            result["status"] = "error"
            result["error"] = err_msg
        _log_debug(
            action="shopee_copy_single_item_final",
            source_item_id=str(item_id),
            dest_seller=str(dest_shop_id),
            error_message=err_msg,
            request_payload=None,
            response_body=e.payload if isinstance(e.payload, dict) else {"raw": str(e.payload)},
            user_id=user_id,
            org_id=org_id,
            api_method=e.method,
            api_url=e.url,
            response_status=e.status_code,
        )
    except Exception as e:
        logger.error("Shopee copy failed for item %d -> shop %d: %s", item_id, dest_shop_id, e)
        result["status"] = "error"
        result["error"] = str(e)
        _log_debug(
            action="shopee_copy_single_item_final",
            source_item_id=str(item_id),
            dest_seller=str(dest_shop_id),
            error_message=str(e),
            user_id=user_id,
            org_id=org_id,
        )

    return result


def _resolve_shop_id(slug: str, org_id: str) -> int:
    """Resolve a Shopee seller slug to shop_id via shopee_sellers table."""
    db = get_db()
    result = (
        db.table("shopee_sellers")
        .select("shop_id")
        .eq("slug", slug)
        .eq("org_id", org_id)
        .single()
        .execute()
    )
    if not result.data:
        raise ValueError(f"Shopee seller '{slug}' not found for org")
    return result.data["shop_id"]


async def _run_copy_job(
    source_shop_id: int,
    item_ids: list[int],
    dest_shops: list[tuple[str, int]],
    org_id: str,
    user_id: str,
    source_slug: str,
    dimensions: dict | None = None,
) -> dict:
    """Core copy loop shared by copy_items and copy_with_dimensions.

    Pre-fetches logistics per dest shop and source data per item,
    then iterates items x destinations calling copy_single_item.
    Returns {total, success, errors, needs_dimensions, results}.
    """
    db = get_db()

    all_results: list[dict] = []
    total_success = 0
    total_errors = 0
    total_needs_correction = 0
    dest_slug_list = [slug for slug, _ in dest_shops]

    # Pre-fetch logistics for each destination shop (once per shop, not per item)
    logistics_cache: dict[int, list[dict]] = {}
    failed_dests: set[int] = set()
    for d_slug, d_shop_id in dest_shops:
        try:
            logistics_cache[d_shop_id] = await _fetch_dest_logistics(d_shop_id, org_id)
        except Exception as e:
            logger.error("Logistics pre-fetch failed for shop %d (%s): %s", d_shop_id, d_slug, e)
            failed_dests.add(d_shop_id)

    for item_id in item_ids:
        # Create in_progress log entry
        log_id: int | None = None
        try:
            log_insert: dict[str, Any] = {
                "user_id": user_id,
                "org_id": org_id,
                "source_seller": source_slug,
                "dest_sellers": dest_slug_list,
                "source_item_id": item_id,
                "status": "in_progress",
            }
            log_row = db.table("shopee_copy_logs").insert(log_insert).execute()
            log_id = log_row.data[0]["id"] if log_row.data else None
        except Exception as e:
            logger.error("Failed to create shopee_copy_logs entry for item %d: %s", item_id, e)

        dest_item_ids: dict[str, str] = {}
        item_errors: dict[str, str] = {}
        has_needs_correction = False
        correction_details: dict[str, Any] | None = None
        item_title = ""
        item_thumbnail = ""
        item_sku: str | None = None

        # Pre-fetch source item data (once per item, reused across destinations)
        prefetched_source: dict | None = None
        try:
            prefetched_source = await _fetch_source_item(source_shop_id, item_id, org_id)
        except Exception as e:
            logger.error("Source fetch failed for item %d shop %d: %s", item_id, source_shop_id, e)
            err_msg = f"Falha ao buscar item de origem: {e}"
            for d_slug, _ in dest_shops:
                err_result: dict[str, Any] = {
                    "source_item_id": str(item_id),
                    "dest_seller": d_slug,
                    "status": "error",
                    "dest_item_id": None,
                    "error": err_msg,
                    "sku": None,
                }
                all_results.append(err_result)
                total_errors += 1
                item_errors[d_slug] = err_msg
            # Update log and skip to next item
            try:
                err_update: dict[str, Any] = {
                    "status": "error",
                    "dest_item_ids": {},
                    "error_details": item_errors,
                }
                if log_id is not None:
                    db.table("shopee_copy_logs").update(err_update).eq("id", log_id).execute()
            except Exception as log_e:
                logger.error("Failed to update shopee_copy_logs for item %d: %s", item_id, log_e)
            continue

        for dest_slug, dest_shop_id in dest_shops:
            # Skip destinations where logistics pre-fetch failed
            if dest_shop_id in failed_dests:
                result: dict[str, Any] = {
                    "source_item_id": str(item_id),
                    "dest_seller": dest_slug,
                    "status": "error",
                    "dest_item_id": None,
                    "error": "Falha ao buscar canais logisticos da loja destino",
                    "sku": None,
                }
                all_results.append(result)
                total_errors += 1
                item_errors[dest_slug] = result["error"]
                continue

            result = await copy_single_item(
                source_shop_id, dest_shop_id, item_id, org_id,
                user_id=user_id,
                dimensions=dimensions,
                logistics=logistics_cache.get(dest_shop_id),
                source_data=prefetched_source,
            )
            result["dest_seller"] = dest_slug
            all_results.append(result)

            # Capture title/thumbnail from first result
            if not item_title and result.get("_title"):
                item_title = result["_title"]
                item_thumbnail = result.get("_thumbnail", "")
            if not item_sku and result.get("sku"):
                item_sku = result["sku"]

            if result["status"] == "success":
                total_success += 1
                if result.get("dest_item_id"):
                    dest_item_ids[dest_slug] = result["dest_item_id"]
            elif result["status"] == CORRECTION_STATUS:
                total_needs_correction += 1
                has_needs_correction = True
                if result.get("error"):
                    item_errors[dest_slug] = result["error"]
                if not correction_details and isinstance(result.get("correction_details"), dict):
                    correction_details = result["correction_details"]
            else:
                total_errors += 1
                if result.get("error"):
                    item_errors[dest_slug] = result["error"]

            await asyncio.sleep(COPY_PACING_SECONDS)

        # Determine final status for this item
        if dest_item_ids and not item_errors:
            item_status = "success"
        elif has_needs_correction:
            item_status = CORRECTION_STATUS
        elif dest_item_ids and item_errors:
            item_status = "partial"
        else:
            item_status = "error"

        # Update log entry
        try:
            update_data: dict[str, Any] = {
                "status": item_status,
                "dest_item_ids": dest_item_ids,
                "error_details": item_errors if item_errors else None,
                "correction_details": correction_details if item_status == CORRECTION_STATUS else None,
                "source_item_title": item_title or None,
                "source_item_thumbnail": item_thumbnail or None,
                "source_item_sku": item_sku,
            }
            if log_id is not None:
                db.table("shopee_copy_logs").update(update_data).eq("id", log_id).execute()
            else:
                fallback: dict[str, Any] = {
                    "user_id": user_id,
                    "org_id": org_id,
                    "source_seller": source_slug,
                    "dest_sellers": dest_slug_list,
                    "source_item_id": item_id,
                    "dest_item_ids": dest_item_ids,
                    "status": item_status,
                    "error_details": item_errors if item_errors else None,
                    "correction_details": correction_details if item_status == CORRECTION_STATUS else None,
                    "source_item_sku": item_sku,
                }
                db.table("shopee_copy_logs").insert(fallback).execute()
        except Exception as e:
            logger.error("Failed to update shopee_copy_logs for item %d: %s", item_id, e)

    return {
        "total": len(all_results),
        "success": total_success,
        "errors": total_errors,
        "needs_correction": total_needs_correction,
        "results": all_results,
    }


async def copy_items(
    source_slug: str,
    dest_slugs: list[str],
    item_ids: list[int],
    user_id: str,
    org_id: str,
) -> dict:
    """Copy multiple Shopee items to multiple destination shops."""
    source_shop_id = _resolve_shop_id(source_slug, org_id)
    dest_shops = [(slug, _resolve_shop_id(slug, org_id)) for slug in dest_slugs]
    return await _run_copy_job(
        source_shop_id, item_ids, dest_shops, org_id, user_id, source_slug,
    )


async def copy_with_dimensions(
    source_slug: str,
    dest_slugs: list[str],
    item_id: int,
    dimensions: dict,
    user_id: str,
    org_id: str,
) -> dict:
    """Copy a single Shopee item with user-provided dimensions."""
    source_shop_id = _resolve_shop_id(source_slug, org_id)
    dest_shops = [(slug, _resolve_shop_id(slug, org_id)) for slug in dest_slugs]
    return await _run_copy_job(
        source_shop_id, [item_id], dest_shops, org_id, user_id, source_slug,
        dimensions=dimensions,
    )
