"""
Core logic for copying Shopee product listings between shops.
"""
import logging

from app.services.shopee_api import (
    ShopeeApiError,
    get_item,
    get_item_extra,
    get_model_list,
    get_logistics_channels,
    upload_image,
    add_item,
)

logger = logging.getLogger(__name__)

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

    return {
        "base_info": base_info,
        "extra_info": extra_info,
        "models": models,
    }


async def _upload_images(
    dest_shop_id: int, image_urls: list[str], org_id: str
) -> list[str]:
    """Upload images to dest shop. Max 9 images. Retry 1x per image on failure."""
    urls = image_urls[:MAX_IMAGES]
    image_ids: list[str] = []

    for url in urls:
        image_id = await _upload_single_image(dest_shop_id, url, org_id)
        if image_id:
            image_ids.append(image_id)

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
        "condition": "NEW",
    }

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
