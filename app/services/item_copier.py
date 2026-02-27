"""
Core logic for copying ML listings from one seller to another.
"""
import logging
import re
from typing import Any

from app.db.supabase import get_db
from app.services.ml_api import (
    MlApiError,
    get_item,
    get_item_description,
    get_item_compatibilities,
    create_item,
    update_item,
    set_item_description,
    copy_item_compatibilities,
)

logger = logging.getLogger(__name__)

# Attributes to exclude (read-only, auto-generated, or non-modifiable on create)
EXCLUDED_ATTRIBUTES = {
    "ITEM_CONDITION",       # set via `condition` field
    "SELLER_SKU",           # keep if present in variations
    "GTIN",                 # catalog / barcode — not modifiable
    "PACKAGE_WEIGHT",       # auto-calculated by ML
    "PACKAGE_HEIGHT",
    "PACKAGE_WIDTH",
    "PACKAGE_LENGTH",
    "SHIPMENT_PACKING",     # auto-calculated shipping type
    "CATALOG_TITLE",        # catalog-managed title
    "PRODUCT_FEATURES",     # catalog-managed features
}

# Top-level fields to NOT copy (auto-generated)
SKIP_FIELDS = {
    "id", "seller_id", "date_created", "start_time", "stop_time",
    "sold_quantity", "status", "permalink", "thumbnail", "thumbnail_id",
    "secure_thumbnail", "health", "tags", "catalog_listing",
    "automatic_relist", "last_updated", "base_price",
    "initial_quantity", "official_store_id", "catalog_product_id",
    "domain_id", "parent_item_id", "deal_ids", "subtitle",
    "differential_pricing", "original_price",
}

DIMENSION_ERROR_KEYWORDS = {
    "dimension", "dimensions", "dimensões", "dimensiones",
    "shipping.dimensions", "package_height", "package_width",
    "package_length", "package_weight", "seller_package",
}

USER_PRODUCT_LISTING_TAG = "user_product_listing"
BRACKET_FIELDS_RE = re.compile(r"\[([^\]]+)\]")
MAX_FAMILY_NAME_LEN = 120


def _is_dimension_error(exc: MlApiError) -> bool:
    """Check if an ML API error is caused by missing shipping dimensions."""
    text = str(exc).lower()
    if any(kw in text for kw in DIMENSION_ERROR_KEYWORDS):
        return True
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    causes = payload.get("cause", [])
    if isinstance(causes, list):
        for cause in causes:
            if not isinstance(cause, dict):
                continue
            for val in (cause.get("code", ""), cause.get("message", "")):
                if any(kw in str(val).lower() for kw in DIMENSION_ERROR_KEYWORDS):
                    return True
    return False


def _build_dimension_attributes(dimensions: dict) -> list[dict]:
    """Build SELLER_PACKAGE_* attributes from a dimensions dict."""
    attrs = []
    mapping = {
        "height": ("SELLER_PACKAGE_HEIGHT", "cm"),
        "width": ("SELLER_PACKAGE_WIDTH", "cm"),
        "length": ("SELLER_PACKAGE_LENGTH", "cm"),
        "weight": ("SELLER_PACKAGE_WEIGHT", "g"),
    }
    for key, (attr_id, unit) in mapping.items():
        value = dimensions.get(key)
        if value is not None:
            attrs.append({"id": attr_id, "value_name": f"{value} {unit}"})
    return attrs


def _clean_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, bool):
        return ""
    if isinstance(value, (int, float)):
        return str(value).strip()
    return ""


def _extract_value_pair(entry: dict[str, Any]) -> tuple[str, str]:
    """Extract ML value_id/value_name from direct or nested structures."""
    value_id = _clean_text(entry.get("value_id"))
    value_name = _clean_text(entry.get("value_name"))
    if value_id or value_name:
        return value_id, value_name

    values = entry.get("values")
    if isinstance(values, list):
        for raw in values:
            if not isinstance(raw, dict):
                continue
            nested_id = _clean_text(raw.get("id"))
            nested_name = _clean_text(raw.get("name"))
            if nested_id or nested_name:
                return nested_id, nested_name

    value_struct = entry.get("value_struct")
    if isinstance(value_struct, dict):
        number = _clean_text(value_struct.get("number"))
        unit = _clean_text(value_struct.get("unit"))
        if number:
            return "", f"{number} {unit}".strip()

    return "", ""


def _extract_seller_sku_from_attributes(attributes: Any) -> str:
    if not isinstance(attributes, list):
        return ""
    for attr in attributes:
        if not isinstance(attr, dict):
            continue
        if attr.get("id") != "SELLER_SKU":
            continue
        value_id, value_name = _extract_value_pair(attr)
        value = value_name or value_id
        if value:
            return value
    return ""


def _get_item_seller_custom_field(item: dict) -> str:
    direct = _clean_text(item.get("seller_custom_field"))
    if direct:
        return direct

    top_attr = _extract_seller_sku_from_attributes(item.get("attributes"))
    if top_attr:
        return top_attr

    variations = item.get("variations")
    if not isinstance(variations, list):
        return ""
    for var in variations:
        if not isinstance(var, dict):
            continue
        direct_var = _clean_text(var.get("seller_custom_field"))
        if direct_var:
            return direct_var
        var_attr = _extract_seller_sku_from_attributes(var.get("attributes"))
        if var_attr:
            return var_attr
    return ""


def _get_variation_seller_custom_field(variation: dict) -> str:
    direct = _clean_text(variation.get("seller_custom_field"))
    if direct:
        return direct
    return _extract_seller_sku_from_attributes(variation.get("attributes"))


def _get_family_name(item: dict) -> str:
    candidates = [
        item.get("family_name"),
        item.get("title"),
        _get_item_seller_custom_field(item),
        item.get("id"),
    ]
    for raw in candidates:
        value = _clean_text(raw)
        if value:
            return value[:MAX_FAMILY_NAME_LEN]
    return ""


def _is_user_product_item(item: dict) -> bool:
    tags = item.get("tags") or []
    if isinstance(tags, list) and USER_PRODUCT_LISTING_TAG in tags:
        return True
    return bool(_clean_text(item.get("family_name")))


def _extract_fields_from_text(text: str) -> set[str]:
    fields: set[str] = set()
    for group in BRACKET_FIELDS_RE.findall(text or ""):
        for raw in group.split(","):
            field = raw.strip().strip("'\"")
            if field:
                fields.add(field.lower())
    return fields


def _extract_ml_error_fields(exc: MlApiError, marker: str) -> set[str]:
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    texts: list[str] = [str(exc)]

    for key in ("message", "error", "detail"):
        value = payload.get(key)
        if isinstance(value, str):
            texts.append(value)

    causes = payload.get("cause")
    if isinstance(causes, list):
        for cause in causes:
            if not isinstance(cause, dict):
                continue
            for key in ("code", "message", "description"):
                value = cause.get(key)
                if isinstance(value, str):
                    texts.append(value)

    marker_lc = marker.lower().strip()
    lowered = [text.lower() for text in texts if isinstance(text, str)]
    marker_found = not marker_lc or any(marker_lc in text for text in lowered)
    if not marker_found and marker_lc == "required_fields":
        marker_found = any(
            "following properties" in text or "required field" in text
            for text in lowered
        )
    if not marker_found and marker_lc == "invalid_fields":
        marker_found = any("invalid field" in text for text in lowered)
    if not marker_found:
        return set()

    fields: set[str] = set()
    for text in texts:
        fields.update(_extract_fields_from_text(text))
    return fields


def _ensure_top_level_stock(payload: dict, item: dict) -> None:
    if "available_quantity" in payload:
        return

    qty = item.get("available_quantity")
    if qty is None and isinstance(item.get("variations"), list):
        qty = sum(
            v.get("available_quantity", 0)
            for v in item["variations"]
            if isinstance(v, dict)
        )
    if qty is not None:
        payload["available_quantity"] = qty


def _adjust_payload_for_ml_error(payload: dict, item: dict, exc: MlApiError) -> tuple[dict, list[str]]:
    adjusted = dict(payload)
    actions: list[str] = []

    invalid_raw = _extract_ml_error_fields(exc, "invalid_fields")
    required_raw = _extract_ml_error_fields(exc, "required_fields")
    invalid_top = {field.split(".", 1)[0] for field in invalid_raw}
    required_top = {field.split(".", 1)[0] for field in required_raw}

    if "shipping.methods" in invalid_raw and isinstance(adjusted.get("shipping"), dict):
        if "methods" in adjusted["shipping"]:
            adjusted["shipping"] = {k: v for k, v in adjusted["shipping"].items() if k != "methods"}
            actions.append("removed shipping.methods")

    removable_top_fields = {
        "title",
        "family_name",
        "variations",
        "channels",
        "video_id",
        "sale_terms",
        "attributes",
        "seller_custom_field",
    }
    for field in removable_top_fields:
        if field in invalid_top and field in adjusted:
            adjusted.pop(field, None)
            actions.append(f"removed {field}")

    if "shipping" in invalid_top and "shipping.methods" not in invalid_raw and "shipping" in adjusted:
        adjusted.pop("shipping", None)
        actions.append("removed shipping")

    if "title" in invalid_top:
        family_name = _get_family_name(item)
        if family_name and not adjusted.get("family_name"):
            adjusted["family_name"] = family_name
            actions.append("added family_name from source")

    if "family_name" in required_top and not adjusted.get("family_name"):
        family_name = _get_family_name(item)
        if family_name:
            adjusted["family_name"] = family_name
            actions.append("added required family_name")

    if "title" in required_top and not adjusted.get("title"):
        title = _clean_text(item.get("title"))
        if title:
            adjusted["title"] = title
            actions.append("added required title")

    if "pictures" in required_top and "pictures" not in adjusted and item.get("pictures"):
        adjusted["pictures"] = [
            {"source": pic.get("secure_url") or pic.get("url")}
            for pic in item["pictures"]
            if isinstance(pic, dict) and (pic.get("secure_url") or pic.get("url"))
        ]
        if adjusted["pictures"]:
            actions.append("added required pictures")
        else:
            adjusted.pop("pictures", None)

    if "condition" in required_top and "condition" not in adjusted and item.get("condition"):
        adjusted["condition"] = item["condition"]
        actions.append("added required condition")

    if "seller_custom_field" in required_top and not adjusted.get("seller_custom_field"):
        sku = _get_item_seller_custom_field(item)
        if sku:
            adjusted["seller_custom_field"] = sku
            actions.append("added required seller_custom_field")

    if "variations" not in adjusted:
        _ensure_top_level_stock(adjusted, item)

    return adjusted, actions


def _build_item_payload(item: dict, safe_mode: bool = False) -> dict:
    """Build POST /items payload from source item data."""
    payload: dict[str, Any] = {}
    is_user_product = _is_user_product_item(item)

    # Basic fields
    base_fields = [
        "category_id", "price", "currency_id",
        "available_quantity", "buying_mode", "listing_type_id",
        "condition",
    ]
    if not is_user_product:
        base_fields.insert(0, "title")

    if not safe_mode:
        base_fields.append("video_id")

    for field in base_fields:
        if field in item and item[field] is not None:
            payload[field] = item[field]

    seller_custom_field = _get_item_seller_custom_field(item)
    if seller_custom_field:
        payload["seller_custom_field"] = seller_custom_field

    family_name = _clean_text(item.get("family_name"))
    if not family_name and is_user_product:
        family_name = _get_family_name(item)
    if family_name:
        payload["family_name"] = family_name[:MAX_FAMILY_NAME_LEN]

    # Pictures — ML accepts source URLs
    if item.get("pictures"):
        payload["pictures"] = [
            {"source": pic.get("secure_url") or pic.get("url")}
            for pic in item["pictures"]
            if pic.get("secure_url") or pic.get("url")
        ]

    # Attributes — filter out read-only ones
    if item.get("attributes"):
        attrs = []
        for attr in item["attributes"]:
            attr_id = attr.get("id", "")
            if attr_id in EXCLUDED_ATTRIBUTES:
                continue
            value_id, value_name = _extract_value_pair(attr)
            if not value_id and not value_name:
                continue
            clean: dict[str, Any] = {"id": attr_id}
            if value_id:
                clean["value_id"] = value_id
            if value_name:
                clean["value_name"] = value_name
            attrs.append(clean)
        if attrs:
            payload["attributes"] = attrs

    # Sale terms
    if item.get("sale_terms"):
        terms = []
        for term in item["sale_terms"]:
            term_id = term.get("id")
            value_id, value_name = _extract_value_pair(term)
            if not term_id or (not value_id and not value_name):
                continue
            clean = {"id": term_id}
            if value_id:
                clean["value_id"] = value_id
            else:
                clean["value_name"] = value_name
            terms.append(clean)
        if terms:
            payload["sale_terms"] = terms

    # Shipping — always use me2; me1 (Full) is seller-specific
    if item.get("shipping"):
        ship = item["shipping"]
        payload["shipping"] = {
            "mode": "me2",
            "local_pick_up": ship.get("local_pick_up", False),
            "free_shipping": ship.get("free_shipping", False),
        }

    # Variations (User Products flow does not accept variations on create)
    if item.get("variations") and not is_user_product:
        variations = []
        for var in item["variations"]:
            v: dict[str, Any] = {}

            if var.get("available_quantity") is not None:
                v["available_quantity"] = var["available_quantity"]
            if var.get("price") is not None:
                v["price"] = var["price"]
            var_sku = _get_variation_seller_custom_field(var)
            if var_sku:
                v["seller_custom_field"] = var_sku

            # Variation pictures
            # Do not reuse source picture_ids: they frequently fail on create.

            # Variation attribute combinations
            if var.get("attribute_combinations"):
                combos = []
                for ac in var["attribute_combinations"]:
                    ac_id = ac.get("id")
                    value_id = ac.get("value_id")
                    value_name = ac.get("value_name")
                    if not ac_id or (not value_id and not value_name):
                        continue
                    clean_ac = {"id": ac_id}
                    if value_id:
                        clean_ac["value_id"] = value_id
                    else:
                        clean_ac["value_name"] = value_name
                    combos.append(clean_ac)
                if combos:
                    v["attribute_combinations"] = combos

            # Variation attributes (seller_custom_field, etc.)
            if var.get("attributes"):
                attrs = []
                for a in var["attributes"]:
                    attr_id = a.get("id")
                    value_id, value_name = _extract_value_pair(a)
                    if not attr_id:
                        continue
                    if safe_mode and attr_id != "SELLER_SKU":
                        continue
                    if not value_id and not value_name:
                        continue
                    clean = {"id": attr_id}
                    if value_id:
                        clean["value_id"] = value_id
                    else:
                        clean["value_name"] = value_name
                    attrs.append(clean)
                if attrs:
                    v["attributes"] = attrs

            if v.get("attribute_combinations"):
                variations.append(v)

        if variations:
            payload["variations"] = variations
            # With variations, ML expects stock on each variation.
            payload.pop("available_quantity", None)

    # Channels
    if item.get("channels") and not safe_mode:
        payload["channels"] = item["channels"]

    return payload


async def copy_single_item(
    source_seller: str,
    dest_seller: str,
    item_id: str,
    user_email: str | None = None,
) -> dict:
    """
    Copy a single item from source_seller to dest_seller.
    Returns result dict with status and details.
    """
    result = {
        "source_item_id": item_id,
        "dest_seller": dest_seller,
        "status": "pending",
        "dest_item_id": None,
        "error": None,
    }

    try:
        # 1. GET full item data from source
        logger.info(f"Fetching item {item_id} from {source_seller}")
        item = await get_item(source_seller, item_id)

        # 2. GET description
        description_data = await get_item_description(source_seller, item_id)
        plain_text = description_data.get("plain_text", "")

        # 3. Check for compatibilities
        has_compat = False
        try:
            compat = await get_item_compatibilities(source_seller, item_id)
            has_compat = compat is not None and bool(compat)
        except Exception as e:
            logger.warning(f"Could not fetch compatibilities for {item_id}: {e}")

        # 4. Build payload and POST to dest seller
        payload = _build_item_payload(item)
        item_label = payload.get("title") or payload.get("family_name") or ""
        logger.info(f"Creating item on {dest_seller} (label: {item_label[:50]})")

        new_item: dict | None = None
        safe_mode_retry_used = False
        last_exc: Exception | None = None

        for _ in range(4):
            try:
                new_item = await create_item(dest_seller, payload)
                break
            except MlApiError as exc:
                last_exc = exc
                adjusted_payload, actions = _adjust_payload_for_ml_error(payload, item, exc)
                if actions and adjusted_payload != payload:
                    logger.warning(
                        "ML rejected payload for %s -> %s. Retrying with adjustments: %s. Error: %s",
                        item_id,
                        dest_seller,
                        ", ".join(actions),
                        exc,
                    )
                    payload = adjusted_payload
                    continue

                if not safe_mode_retry_used:
                    safe_payload = _build_item_payload(item, safe_mode=True)
                    family_name = _get_family_name(item)
                    if family_name and not safe_payload.get("family_name"):
                        safe_payload["family_name"] = family_name
                    if safe_payload != payload:
                        safe_mode_retry_used = True
                        logger.warning(
                            "Primary payload rejected for %s -> %s. Retrying with safe payload. Error: %s",
                            item_id,
                            dest_seller,
                            exc,
                        )
                        payload = safe_payload
                        continue
                raise

        if new_item is None:
            if last_exc is not None:
                raise last_exc
            raise RuntimeError("Failed to create item after retries")

        new_item_id = new_item["id"]
        result["dest_item_id"] = new_item_id
        logger.info(f"Item created: {new_item_id} on {dest_seller}")

        # 5. POST description
        if plain_text:
            try:
                await set_item_description(dest_seller, new_item_id, plain_text)
                logger.info(f"Description set for {new_item_id}")
            except Exception as e:
                logger.warning(f"Failed to set description for {new_item_id}: {e}")

        # 6. Copy compatibilities (using ML native copy)
        if has_compat:
            try:
                await copy_item_compatibilities(dest_seller, new_item_id, item_id)
                logger.info(f"Compatibilities copied for {new_item_id} from {item_id}")
            except Exception as e:
                logger.warning(f"Failed to copy compatibilities for {new_item_id}: {e}")

        result["status"] = "success"

    except MlApiError as e:
        if _is_dimension_error(e):
            logger.warning(f"Copy {item_id} -> {dest_seller} blocked by missing dimensions")
            result["status"] = "needs_dimensions"
            result["error"] = "Item sem dimensoes de envio. Informe as dimensoes para continuar."
        else:
            logger.error(f"Failed to copy {item_id} to {dest_seller}: {e}")
            result["status"] = "error"
            result["error"] = str(e)
    except Exception as e:
        logger.error(f"Failed to copy {item_id} to {dest_seller}: {e}")
        result["status"] = "error"
        result["error"] = str(e)

    return result


async def copy_items(
    source_seller: str,
    dest_sellers: list[str],
    item_ids: list[str],
    user_email: str | None = None,
    user_id: str | None = None,
) -> list[dict]:
    """
    Copy multiple items to multiple destination sellers.
    Logs each copy to copy_logs table.
    """
    db = get_db()
    all_results = []

    for item_id in item_ids:
        item_id = item_id.strip()
        if not item_id:
            continue

        # Create in_progress log entry BEFORE starting the copy
        log_id: int | None = None
        try:
            log_insert = {
                "user_email": user_email,
                "source_seller": source_seller,
                "dest_sellers": dest_sellers,
                "source_item_id": item_id,
                "status": "in_progress",
            }
            if user_id:
                log_insert["user_id"] = user_id
            log_row = db.table("copy_logs").insert(log_insert).execute()
            log_id = log_row.data[0]["id"] if log_row.data else None
        except Exception as e:
            logger.error(f"Failed to create in_progress log for {item_id}: {e}")

        dest_item_ids = {}
        item_status = "success"
        item_errors = {}

        for dest_seller in dest_sellers:
            result = await copy_single_item(source_seller, dest_seller, item_id, user_email)
            all_results.append(result)

            if result["status"] == "success":
                dest_item_ids[dest_seller] = result["dest_item_id"]
            else:
                item_status = "partial" if dest_item_ids else "error"
                item_errors[dest_seller] = result["error"]

        # Update the log entry with final results
        try:
            update_data = {
                "status": item_status,
                "dest_item_ids": dest_item_ids,
                "error_details": item_errors if item_errors else None,
            }
            if log_id is not None:
                db.table("copy_logs").update(update_data).eq("id", log_id).execute()
            else:
                # Fallback: insert a new row if in_progress insert failed
                fallback = {
                    "user_email": user_email,
                    "source_seller": source_seller,
                    "dest_sellers": dest_sellers,
                    "source_item_id": item_id,
                    "dest_item_ids": dest_item_ids,
                    "status": item_status,
                    "error_details": item_errors if item_errors else None,
                }
                if user_id:
                    fallback["user_id"] = user_id
                db.table("copy_logs").insert(fallback).execute()
        except Exception as e:
            logger.error(f"Failed to update log for {item_id}: {e}")

    return all_results


async def copy_with_dimensions(
    source_seller: str,
    dest_sellers: list[str],
    item_id: str,
    dimensions: dict,
) -> list[dict]:
    """
    Apply shipping dimensions to the source item, then copy to destinations.
    Also updates destination items that were already created (if any).
    """
    dim_attrs = _build_dimension_attributes(dimensions)

    # 1. Update source item with dimensions
    try:
        await update_item(source_seller, item_id, {"attributes": dim_attrs})
        logger.info(f"Dimensions applied to source item {item_id} on {source_seller}")
    except Exception as e:
        logger.error(f"Failed to apply dimensions to {item_id}: {e}")
        return [{
            "source_item_id": item_id,
            "dest_seller": ds,
            "status": "error",
            "dest_item_id": None,
            "error": f"Falha ao atualizar dimensoes no item origem: {e}",
        } for ds in dest_sellers]

    # 2. Re-copy to all destinations (normal copy flow, item now has dimensions)
    results = []
    for dest_seller in dest_sellers:
        result = await copy_single_item(source_seller, dest_seller, item_id)
        results.append(result)

    return results
