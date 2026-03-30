"""
Core logic for copying ML listings from one seller to another.
"""
import asyncio
import json
import logging
import re
from typing import Any

from app.db.supabase import get_db
from app.services.ml_api import (
    MlApiError,
    get_item,
    get_item_description,
    get_item_compatibilities,
    get_seller_official_store_id,
    create_item,
    update_item,
    set_item_description,
    copy_item_compatibilities,
)

logger = logging.getLogger(__name__)

MAX_DEBUG_PAYLOAD_SIZE = 50_000  # 50 KB max for JSON payloads in debug logs

# Concurrent item copies — ~80% of ML rate limit headroom.
# Each item = ~4-5 API calls, and each item fans out to all dest sellers in parallel.
# With connection pooling, 5 concurrent items * N dest sellers in parallel is safe.
# ML typically allows ~10k req/hour; this stays well within limits.
ML_COPY_CONCURRENCY = 5

# Maximum wall-clock time for a full copy_items batch (seconds).
BATCH_COPY_TIMEOUT = 600  # 10 minutes


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


def _log_api_debug(
    action: str,
    source_seller: str | None = None,
    dest_seller: str | None = None,
    source_item_id: str | None = None,
    dest_item_id: str | None = None,
    user_id: str | None = None,
    copy_log_id: int | None = None,
    api_method: str | None = None,
    api_url: str | None = None,
    request_payload: Any = None,
    response_status: int | None = None,
    response_body: Any = None,
    error_message: str | None = None,
    attempt_number: int = 1,
    adjustments: list[str] | None = None,
    resolved: bool = False,
    org_id: str | None = None,
) -> None:
    """Insert a debug log row into api_debug_logs. Never raises."""
    try:
        db = get_db()
        row: dict[str, Any] = {
            "action": action,
            "source_seller": source_seller,
            "dest_seller": dest_seller,
            "source_item_id": source_item_id,
            "dest_item_id": dest_item_id,
            "api_method": api_method,
            "api_url": api_url,
            "request_payload": _truncate_json(request_payload),
            "response_status": response_status,
            "response_body": _truncate_json(response_body),
            "error_message": str(error_message)[:2000] if error_message else None,
            "attempt_number": attempt_number,
            "adjustments": adjustments or [],
            "resolved": resolved,
        }
        if user_id:
            row["user_id"] = user_id
        if copy_log_id:
            row["copy_log_id"] = copy_log_id
        if org_id:
            row["org_id"] = org_id
        db.table("api_debug_logs").insert(row).execute()
    except Exception as e:
        logger.warning("Failed to write api_debug_log: %s", e)

# Attributes to exclude (read-only, auto-generated, or non-modifiable on create)
EXCLUDED_ATTRIBUTES = {
    "ITEM_CONDITION",       # set via `condition` field
    "SELLER_SKU",           # keep if present in variations
    "PACKAGE_WEIGHT",       # auto-calculated by ML
    "PACKAGE_HEIGHT",
    "PACKAGE_WIDTH",
    "PACKAGE_LENGTH",
    "SHIPMENT_PACKING",     # auto-calculated shipping type
    "CATALOG_TITLE",        # catalog-managed title
    "PRODUCT_FEATURES",     # catalog-managed features
    "HAS_COMPATIBILITIES",  # read-only, ML ignores it
    "GIFTABLE",             # read-only, ML ignores it
    "IS_HIGHLIGHT_BRAND",   # read-only, ML ignores it
    "IS_TOM_BRAND",         # read-only, ML ignores it
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
REQUIRED_ATTR_BRACKET_RE = re.compile(r"(?:attributes?|fields?)\s*\[([^\]]+)\]\s+(?:are|is)\s+required", re.IGNORECASE)
REQUIRED_ATTR_DIRECT_RE = re.compile(r"\b([A-Z][A-Z0-9_]+)\b\s+is a required attribute\b", re.IGNORECASE)
MAX_FAMILY_NAME_LEN = 120
CORRECTION_STATUS = "needs_correction"
LEGACY_DIMENSION_STATUS = "needs_dimensions"

ATTRIBUTE_LABELS = {
    "GTIN": "GTIN",
    "MODEL": "Modelo",
    "WITH_USB": "Com USB",
}

ATTRIBUTE_PLACEHOLDERS = {
    "GTIN": "ex: 7891234567890",
    "MODEL": "ex: Amor Infinito",
    "WITH_USB": "ex: Sim ou Não",
}

DIMENSION_CORRECTION_DETAILS = {
    "kind": "dimensions",
    "group_key": "dimensions",
    "summary": "Item sem dimensoes de envio. Informe as dimensoes para continuar.",
    "fields": [
        {
            "id": "height",
            "label": "Altura",
            "input": "number",
            "unit": "cm",
            "step": "0.1",
            "min": 0,
            "placeholder": "ex: 34",
        },
        {
            "id": "width",
            "label": "Largura",
            "input": "number",
            "unit": "cm",
            "step": "0.1",
            "min": 0,
            "placeholder": "ex: 22",
        },
        {
            "id": "length",
            "label": "Comprimento",
            "input": "number",
            "unit": "cm",
            "step": "0.1",
            "min": 0,
            "placeholder": "ex: 30",
        },
        {
            "id": "weight",
            "label": "Peso",
            "input": "number",
            "unit": "g",
            "step": "1",
            "min": 0,
            "placeholder": "ex: 2360",
        },
    ],
}


def _is_conditional_required_error(exc: MlApiError, attr_id: str) -> bool:
    """Check if a specific attribute's error is conditional_required (not hard required)."""
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    causes = payload.get("cause", [])
    if isinstance(causes, list):
        for cause in causes:
            if not isinstance(cause, dict) or cause.get("type") != "error":
                continue
            code = str(cause.get("code", "")).lower()
            msg = str(cause.get("message", "")).upper()
            if "missing_conditional_required" in code and attr_id in msg:
                return True
    return False


def _extract_missing_required_attributes(exc: MlApiError) -> set[str]:
    """Extract attribute IDs from 'attributes [X] are required for category' errors."""
    attrs: set[str] = set()
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    causes = payload.get("cause", [])
    if isinstance(causes, list):
        for cause in causes:
            if not isinstance(cause, dict) or cause.get("type") != "error":
                continue
            code = str(cause.get("code", "")).lower()
            if not any(
                marker in code
                for marker in (
                    "missing_required",
                    "missing_catalog_required",
                    "missing_conditional_required",
                )
            ) and not (
                "field.constraint.violated" in code
                and "required attribute" in str(cause.get("message", "")).lower()
            ):
                continue
            msg = cause.get("message", "")
            attrs.update(_extract_required_attribute_ids(msg))
    return attrs


def _format_attribute_label(attr_id: str) -> str:
    return ATTRIBUTE_LABELS.get(attr_id, attr_id.replace("_", " ").title())


def _build_dimension_correction_details() -> dict[str, Any]:
    return dict(DIMENSION_CORRECTION_DETAILS)


def _build_attribute_correction_details(attr_ids: set[str]) -> dict[str, Any] | None:
    normalized = sorted({attr_id.strip().upper() for attr_id in attr_ids if attr_id.strip()})
    if not normalized:
        return None
    labels = [_format_attribute_label(attr_id) for attr_id in normalized]
    return {
        "kind": "attributes",
        "group_key": f"attributes:{','.join(normalized)}",
        "summary": (
            f"Atributo obrigatorio faltando: {labels[0]}"
            if len(labels) == 1
            else f"Atributos obrigatorios faltando: {', '.join(labels)}"
        ),
        "attribute_ids": normalized,
        "fields": [
            {
                "id": attr_id,
                "label": _format_attribute_label(attr_id),
                "input": "text",
                "placeholder": ATTRIBUTE_PLACEHOLDERS.get(attr_id, ""),
            }
            for attr_id in normalized
        ],
    }


def _is_locations_assigned_error(exc: MlApiError) -> bool:
    """Check if an ML API error is caused by user product already having locations assigned.

    This is a non-retryable structural error — the destination seller already has
    this product with multi-warehouse inventory locations configured.
    """
    text = str(exc).lower()
    if "already has locations assigned" in text:
        return True
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    msg = str(payload.get("message", "")).lower()
    if "already has locations assigned" in msg:
        return True
    return False


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


def _normalize_attribute_id(raw: str) -> str:
    value = _clean_text(raw).strip("'\"").upper()
    if not value or re.fullmatch(r"MLB\d+", value):
        return ""
    return value


def _extract_required_attribute_ids(text: str) -> set[str]:
    attrs: set[str] = set()
    for match in REQUIRED_ATTR_BRACKET_RE.finditer(text or ""):
        for raw in match.group(1).split(","):
            attr_id = _normalize_attribute_id(raw)
            if attr_id:
                attrs.add(attr_id)
    for match in REQUIRED_ATTR_DIRECT_RE.finditer(text or ""):
        attr_id = _normalize_attribute_id(match.group(1))
        if attr_id:
            attrs.add(attr_id)
    return attrs


def _iter_error_text_segments(text: str) -> list[str]:
    segments: list[str] = []
    for chunk in str(text or "").split("|"):
        piece = chunk.strip()
        if not piece:
            continue
        segments.append(piece)
        for subpart in piece.split(";"):
            cleaned = subpart.strip()
            if cleaned and cleaned != piece:
                segments.append(cleaned)
    return segments


def _text_matches_error_marker(text: str, marker: str) -> bool:
    marker_lc = marker.lower().strip()
    if not marker_lc:
        return True
    text_lc = text.lower()
    if marker_lc in text_lc:
        return True
    if marker_lc == "required_fields":
        return "following properties" in text_lc or "required field" in text_lc
    if marker_lc == "invalid_fields":
        return "invalid field" in text_lc or (" field " in f" {text_lc} " and " invalid" in text_lc)
    return False


def _extract_ml_error_fields(exc: MlApiError, marker: str) -> set[str]:
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    relevant_texts: list[str] = []

    exc_text = str(exc)
    for segment in _iter_error_text_segments(exc_text):
        if _text_matches_error_marker(segment, marker):
            relevant_texts.append(segment)

    for key in ("message", "error", "detail"):
        value = payload.get(key)
        if isinstance(value, str):
            for segment in _iter_error_text_segments(value):
                if _text_matches_error_marker(segment, marker):
                    relevant_texts.append(segment)

    causes = payload.get("cause")
    if isinstance(causes, list):
        for cause in causes:
            if not isinstance(cause, dict):
                continue
            cause_texts = [
                value
                for key in ("code", "message", "description")
                if isinstance((value := cause.get(key)), str)
            ]
            for text in cause_texts:
                for segment in _iter_error_text_segments(text):
                    if _text_matches_error_marker(segment, marker):
                        relevant_texts.append(segment)

    if not relevant_texts:
        return set()

    fields: set[str] = set()
    for text in relevant_texts:
        fields.update(_extract_fields_from_text(text))
    return fields


def _extract_attribute_value_from_list(attributes: Any, attr_id: str) -> str:
    if not isinstance(attributes, list):
        return ""
    for attr in attributes:
        if not isinstance(attr, dict) or attr.get("id") != attr_id:
            continue
        value_id, value_name = _extract_value_pair(attr)
        value = value_name or value_id
        if value:
            return value
    return ""


def _extract_source_attribute_value(item: dict, attr_id: str) -> str:
    value = _extract_attribute_value_from_list(item.get("attributes"), attr_id)
    if value:
        return value

    variations = item.get("variations")
    if not isinstance(variations, list):
        return ""

    for variation in variations:
        if not isinstance(variation, dict):
            continue
        value = _extract_attribute_value_from_list(variation.get("attributes"), attr_id)
        if value:
            return value
    return ""


def _ensure_attribute_in_payload(payload: dict[str, Any], attr_id: str, value: str) -> bool:
    clean_value = _clean_text(value)
    if not clean_value:
        return False

    attrs = payload.setdefault("attributes", [])
    if not isinstance(attrs, list):
        payload["attributes"] = []
        attrs = payload["attributes"]

    for attr in attrs:
        if not isinstance(attr, dict) or attr.get("id") != attr_id:
            continue
        attr["value_name"] = clean_value
        attr.pop("value_id", None)
        return True

    attrs.append({"id": attr_id, "value_name": clean_value})
    return True


def _is_title_invalid_error(exc: MlApiError) -> bool:
    invalid = _extract_ml_error_fields(exc, "invalid_fields")
    if any(field.split(".", 1)[0] == "title" for field in invalid):
        return True
    text = str(exc).lower()
    return "[title]" in text and "invalid" in text


def _is_family_name_invalid_error(exc: MlApiError) -> bool:
    """Detect 'family name is invalid' even without bracket-enclosed field name."""
    text = str(exc).lower()
    if re.search(r"\bfield\s+family name\s+is invalid\b", text):
        return True
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    causes = payload.get("cause", [])
    if isinstance(causes, list):
        for cause in causes:
            if not isinstance(cause, dict):
                continue
            code = str(cause.get("code", "")).lower()
            msg = str(cause.get("message", "")).lower()
            if "family_name" in code and "invalid" in code and "length" not in code:
                return True
            if re.search(r"\bfield\s+family name\s+is invalid\b", msg):
                return True
    return False


def _is_official_store_id_error(exc: MlApiError) -> bool:
    """Detect 'official_store_id' required/invalid error for brand accounts."""
    text = str(exc).lower()
    if "official_store_id" in text:
        return True
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    causes = payload.get("cause", [])
    if isinstance(causes, list):
        for cause in causes:
            if not isinstance(cause, dict):
                continue
            code = str(cause.get("code", "")).lower()
            msg = str(cause.get("message", "")).lower()
            if "official_store_id" in code or "official_store_id" in msg:
                return True
    return False


def _is_variations_invalid_with_family_name_error(exc: MlApiError) -> bool:
    """Detect 'variations is invalid with family name' — can't have both."""
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    causes = payload.get("cause", [])
    if isinstance(causes, list):
        for cause in causes:
            if not isinstance(cause, dict) or cause.get("type") != "error":
                continue
            msg = str(cause.get("message", "")).lower()
            if "variations" in msg and "invalid" in msg and "family name" in msg:
                return True
    return False


def _is_family_name_length_error(exc: MlApiError) -> bool:
    """Detect family_name length validation error (e.g. over 60 chars)."""
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    causes = payload.get("cause", [])
    if isinstance(causes, list):
        for cause in causes:
            if not isinstance(cause, dict):
                continue
            code = str(cause.get("code", "")).lower()
            msg = str(cause.get("message", "")).lower()
            if "family_name" in code and "length" in code:
                return True
            if "family name" in msg and ("length" in msg or "over of" in msg):
                return True
    return False


def _is_title_length_error(exc: MlApiError) -> bool:
    """Detect item.title.length.invalid (category limits title to N chars)."""
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    causes = payload.get("cause", [])
    if isinstance(causes, list):
        for cause in causes:
            if not isinstance(cause, dict):
                continue
            code = str(cause.get("code", "")).lower()
            if "title" in code and "length" in code:
                return True
    return False


def _extract_title_max_length(exc: MlApiError) -> int:
    """Extract max title length from error message, default 60."""
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    causes = payload.get("cause", [])
    if isinstance(causes, list):
        for cause in causes:
            if not isinstance(cause, dict):
                continue
            code = str(cause.get("code", "")).lower()
            if "title" not in code or "length" not in code:
                continue
            msg = str(cause.get("message", ""))
            match = re.search(r"greater than (\d+) characters", msg)
            if match:
                return int(match.group(1))
    return 60


def _extract_pictures_max(exc: MlApiError) -> int | None:
    """Extract max pictures count from item.pictures.max error, or None if not present."""
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    causes = payload.get("cause", [])
    if isinstance(causes, list):
        for cause in causes:
            if not isinstance(cause, dict) or cause.get("type") != "error":
                continue
            code = str(cause.get("code", ""))
            if code == "item.pictures.max":
                msg = str(cause.get("message", ""))
                match = re.search(r"cannot exceeds? (\d+) pictures", msg)
                return int(match.group(1)) if match else 12
    return None


def _extract_invalid_attribute_ids(exc: MlApiError) -> set[str]:
    """Extract attribute IDs from invalid.item.attribute.values errors."""
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    causes = payload.get("cause", [])
    ids: set[str] = set()
    if isinstance(causes, list):
        for cause in causes:
            if not isinstance(cause, dict) or cause.get("type") != "error":
                continue
            code = str(cause.get("code", ""))
            if code == "invalid.item.attribute.values":
                msg = str(cause.get("message", ""))
                match = re.search(r"Attribute \[(\w+)\]", msg)
                if match:
                    ids.add(match.group(1))
    return ids


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
    if _is_title_invalid_error(exc):
        invalid_top.add("title")

    # Detect item.X.invalid cause codes (e.g. item.channels.invalid)
    # that aren't caught by the text-based field extraction
    _payload = exc.payload if isinstance(exc.payload, dict) else {}
    _causes = _payload.get("cause", [])
    if isinstance(_causes, list):
        for _cause in _causes:
            if not isinstance(_cause, dict) or _cause.get("type") != "error":
                continue
            _code = str(_cause.get("code", ""))
            if _code.startswith("item.") and _code.endswith(".invalid"):
                _field = _code.split(".")[1]
                invalid_top.add(_field)

    if "shipping.methods" in invalid_raw and isinstance(adjusted.get("shipping"), dict):
        if "methods" in adjusted["shipping"]:
            adjusted["shipping"] = {k: v for k, v in adjusted["shipping"].items() if k != "methods"}
            actions.append("removed shipping.methods")

    # Handle mandatory_free_shipping: ML forces free_shipping for certain categories/prices.
    # Also handle lost_me1_by_user: confirm me2 mode (me1/Full is seller-specific).
    if isinstance(adjusted.get("shipping"), dict):
        _causes = (exc.payload if isinstance(exc.payload, dict) else {}).get("cause", [])
        if isinstance(_causes, list):
            for _c in _causes:
                if not isinstance(_c, dict):
                    continue
                _code = str(_c.get("code", "")).lower()
                if "mandatory_free_shipping" in _code:
                    adjusted["shipping"]["free_shipping"] = True
                    actions.append("set free_shipping=true (mandatory for category/price)")
                if "lost_me1" in _code or "me1" in _code:
                    adjusted["shipping"]["mode"] = "me2"
                    actions.append("confirmed shipping mode=me2 (me1 not available)")

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

    # When family_name is invalid, fall back to title (user_product → regular item flow)
    if "family_name" in invalid_top and not adjusted.get("title"):
        title = _clean_text(item.get("title"))
        if title:
            adjusted["title"] = title
            actions.append("added title as family_name fallback")

    if "title" in invalid_top:
        family_name = _get_family_name(item)
        if family_name and not adjusted.get("family_name"):
            adjusted["family_name"] = family_name
            actions.append("added family_name from source")

    if "family_name" in required_top and not adjusted.get("family_name") and "family_name" not in invalid_top:
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

    # When variations conflict with family_name (dest is brand/user_product account
    # but source has variations), remove variations and ensure available_quantity
    if _is_variations_invalid_with_family_name_error(exc) and "variations" in adjusted:
        adjusted.pop("variations")
        actions.append("removed variations (incompatible with family_name)")
        _ensure_top_level_stock(adjusted, item)
        gtin = _extract_source_attribute_value(item, "GTIN")
        if gtin and _ensure_attribute_in_payload(adjusted, "GTIN", gtin):
            actions.append("added GTIN from source after removing variations")

    # Handle pictures max error: truncate to category limit
    pic_max = _extract_pictures_max(exc)
    if pic_max and isinstance(adjusted.get("pictures"), list) and len(adjusted["pictures"]) > pic_max:
        adjusted["pictures"] = adjusted["pictures"][:pic_max]
        actions.append(f"truncated pictures to {pic_max}")

    # Handle invalid attribute values: remove the offending attribute
    invalid_attrs = _extract_invalid_attribute_ids(exc)
    if invalid_attrs and isinstance(adjusted.get("attributes"), list):
        before = len(adjusted["attributes"])
        adjusted["attributes"] = [
            a for a in adjusted["attributes"] if a.get("id") not in invalid_attrs
        ]
        removed = before - len(adjusted["attributes"])
        if removed:
            actions.append(f"removed invalid attributes: {', '.join(invalid_attrs)}")

    # Handle family_name length error: truncate to 60 chars instead of removing
    if _is_family_name_length_error(exc) and adjusted.get("family_name"):
        adjusted["family_name"] = adjusted["family_name"][:60]
        actions.append("truncated family_name to 60 chars")

    # Title length errors are now handled as user corrections (needs_correction)
    # so we no longer auto-truncate here — the user edits the title manually.

    # Auto-fill missing required attributes (e.g. MODEL) from item data
    missing_attrs = _extract_missing_required_attributes(exc)
    if missing_attrs:
        for attr_id in missing_attrs:
            value = _extract_source_attribute_value(item, attr_id)
            # For MODEL: derive from title/family_name if not in source
            if not value and attr_id == "MODEL":
                value = _clean_text(item.get("family_name")) or _clean_text(item.get("title"))
                if value and len(value) > 60:
                    value = value[:60]
            # For GTIN: if not in source and error is conditional_required,
            # send EMPTY_GTIN_REASON instead of asking user (they won't know it either)
            if not value and attr_id == "GTIN" and _is_conditional_required_error(exc, "GTIN"):
                attrs = adjusted.setdefault("attributes", [])
                if not isinstance(attrs, list):
                    adjusted["attributes"] = []
                    attrs = adjusted["attributes"]
                attrs.append({"id": "EMPTY_GTIN_REASON", "value_id": "17055160", "value_name": "No registrado"})
                actions.append("added EMPTY_GTIN_REASON=No registrado (GTIN not in source)")
                continue
            if value and _ensure_attribute_in_payload(adjusted, attr_id, value):
                actions.append(f"added missing required attribute {attr_id}={value[:30]}")

    if "variations" not in adjusted:
        _ensure_top_level_stock(adjusted, item)

    return adjusted, actions


def _build_title_correction_details(original_title: str, max_length: int) -> dict[str, Any]:
    """Build correction details for title length errors — lets user edit the title."""
    return {
        "kind": "title",
        "group_key": "title",
        "summary": f"Titulo excede limite de {max_length} caracteres da categoria. Edite o titulo para continuar.",
        "original_title": original_title,
        "max_length": max_length,
        "fields": [
            {
                "id": "title",
                "label": f"Novo titulo (max {max_length} caracteres)",
                "input": "text",
                "placeholder": original_title[:max_length] if original_title else "",
                "maxLength": max_length,
            }
        ],
    }


def _extract_correction_details(exc: MlApiError, payload: dict | None = None) -> dict[str, Any] | None:
    if _is_dimension_error(exc):
        return _build_dimension_correction_details()

    if _is_title_length_error(exc):
        max_len = _extract_title_max_length(exc)
        original_title = ""
        if payload:
            original_title = payload.get("title") or payload.get("family_name") or ""
        return _build_title_correction_details(original_title, max_len)

    missing_attrs = _extract_missing_required_attributes(exc)
    if missing_attrs:
        return _build_attribute_correction_details(missing_attrs)

    return None


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

    # Pictures — ML accepts source URLs (cap at 12, most categories' max)
    if item.get("pictures"):
        payload["pictures"] = [
            {"source": pic.get("secure_url") or pic.get("url")}
            for pic in item["pictures"]
            if pic.get("secure_url") or pic.get("url")
        ][:12]

    # Attributes — filter out read-only ones
    if item.get("attributes"):
        attrs = []
        for attr in item["attributes"]:
            attr_id = attr.get("id") or ""
            if not attr_id or attr_id in EXCLUDED_ATTRIBUTES:
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

    # For User Products: add SELLER_SKU attribute so ML interface shows the SKU.
    # seller_custom_field alone is not displayed by ML for User Products.
    if is_user_product and seller_custom_field:
        if "attributes" not in payload:
            payload["attributes"] = []
        has_sku_attr = any(a.get("id") == "SELLER_SKU" for a in payload["attributes"])
        if not has_sku_attr:
            payload["attributes"].append({"id": "SELLER_SKU", "value_name": seller_custom_field})

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
    # local_pick_up forced false — multi-warehouse sellers reject it
    if item.get("shipping"):
        ship = item["shipping"]
        payload["shipping"] = {
            "mode": "me2",
            "local_pick_up": False,
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

    # Full (fulfillment) items have stock in ML warehouse, so available_quantity
    # comes as 0. Ensure at least 1 so the destination listing is active.
    source_shipping = item.get("shipping") or {}
    is_full = source_shipping.get("logistic_type") == "fulfillment"
    if is_full:
        if "variations" in payload:
            for v in payload["variations"]:
                if v.get("available_quantity", 0) < 1:
                    v["available_quantity"] = 1
        elif payload.get("available_quantity", 0) < 1:
            payload["available_quantity"] = 1

    return payload


async def copy_single_item(
    source_seller: str,
    dest_seller: str,
    item_id: str,
    user_email: str | None = None,
    user_id: str | None = None,
    copy_log_id: int | None = None,
    org_id: str = "",
    title_override: str | None = None,
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
        "sku": None,
        "correction_details": None,
    }
    item: dict[str, Any] | None = None

    try:
        # 1. GET full item data from source
        logger.info(f"Fetching item {item_id} from {source_seller}")
        item = await get_item(source_seller, item_id, org_id=org_id)
        result["sku"] = _get_item_seller_custom_field(item) or None
        result["_title"] = item.get("title") or ""
        result["_thumbnail"] = item.get("secure_thumbnail") or item.get("thumbnail") or ""

        # 2. GET description
        description_data = await get_item_description(source_seller, item_id, org_id=org_id)
        plain_text = description_data.get("plain_text", "")

        # 3. Check for compatibilities
        has_compat = False
        try:
            compat = await get_item_compatibilities(source_seller, item_id, org_id=org_id)
            if compat and isinstance(compat, dict):
                has_compat = len(compat.get("products", [])) > 0
            elif compat:
                has_compat = True
        except Exception as e:
            logger.warning(f"Could not fetch compatibilities for {item_id}: {e}")

        # 4. Build payload and POST to dest seller
        payload = _build_item_payload(item)
        # Apply user-provided title override (from title length correction)
        if title_override:
            if payload.get("title"):
                payload["title"] = title_override
            elif payload.get("family_name"):
                payload["family_name"] = title_override
            else:
                payload["title"] = title_override
        item_label = payload.get("title") or payload.get("family_name") or ""
        logger.info(f"Creating item on {dest_seller} (label: {item_label[:50]})")

        new_item: dict | None = None
        safe_mode_retry_used = False
        force_no_title = False
        force_no_family_name = False
        last_exc: Exception | None = None

        for attempt in range(1, 5):
            if force_no_title and payload.get("title"):
                payload = dict(payload)
                payload.pop("title", None)
                if not payload.get("family_name"):
                    family_name = _get_family_name(item)
                    if family_name:
                        payload["family_name"] = family_name
            if force_no_family_name and payload.get("family_name"):
                payload = dict(payload)
                payload.pop("family_name", None)
                if not payload.get("title"):
                    title = _clean_text(item.get("title"))
                    if title:
                        payload["title"] = title
            try:
                new_item = await create_item(dest_seller, payload, org_id=org_id)
                break
            except MlApiError as exc:
                last_exc = exc

                # ML 500 server errors — retry with backoff (transient infra issues)
                if exc.status_code >= 500 and attempt < 4:
                    wait = 3 * (2 ** (attempt - 1))  # 3s, 6s, 12s
                    logger.warning(
                        "ML server error %d for %s -> %s (attempt %d), retrying in %ds: %s",
                        exc.status_code, item_id, dest_seller, attempt, wait, exc.detail,
                    )
                    _log_api_debug(
                        action="create_item",
                        source_seller=source_seller,
                        dest_seller=dest_seller,
                        source_item_id=item_id,
                        user_id=user_id,
                        copy_log_id=copy_log_id,
                        api_method=exc.method,
                        api_url=exc.url,
                        request_payload=payload,
                        response_status=exc.status_code,
                        response_body=exc.payload if isinstance(exc.payload, dict) else {"raw": str(exc.payload)},
                        error_message=exc.detail,
                        attempt_number=attempt,
                        adjustments=["server_error_retry"],
                        org_id=org_id,
                    )
                    await asyncio.sleep(wait)
                    continue

                # Dimension errors can't be fixed by retries — bail out immediately
                if _is_dimension_error(exc):
                    _log_api_debug(
                        action="create_item",
                        source_seller=source_seller,
                        dest_seller=dest_seller,
                        source_item_id=item_id,
                        user_id=user_id,
                        copy_log_id=copy_log_id,
                        api_method=exc.method,
                        api_url=exc.url,
                        request_payload=payload,
                        response_status=exc.status_code,
                        response_body=exc.payload if isinstance(exc.payload, dict) else {"raw": str(exc.payload)},
                        error_message=exc.detail,
                        attempt_number=attempt,
                        adjustments=["dimension_error_detected"],
                        resolved=True,
                        org_id=org_id,
                    )
                    raise

                # Title length errors need user input — bail out for manual correction
                if _is_title_length_error(exc):
                    _log_api_debug(
                        action="create_item",
                        source_seller=source_seller,
                        dest_seller=dest_seller,
                        source_item_id=item_id,
                        user_id=user_id,
                        copy_log_id=copy_log_id,
                        api_method=exc.method,
                        api_url=exc.url,
                        request_payload=payload,
                        response_status=exc.status_code,
                        response_body=exc.payload if isinstance(exc.payload, dict) else {"raw": str(exc.payload)},
                        error_message=exc.detail,
                        attempt_number=attempt,
                        adjustments=["title_length_error_detected"],
                        resolved=True,
                        org_id=org_id,
                    )
                    raise

                # Multi-location inventory: user_product already has locations assigned.
                # ML matches user_products by family_name + PART_NUMBER (exact value).
                # Normalize PART_NUMBER spacing to create a new user_product that
                # avoids the locations conflict while preserving the part number data.
                if _is_locations_assigned_error(exc) and attempt < 4:
                    payload = dict(payload)
                    loc_actions = []
                    if isinstance(payload.get("attributes"), list):
                        for attr in payload["attributes"]:
                            if attr.get("id") == "PART_NUMBER" and attr.get("value_name"):
                                original_pn = attr["value_name"]
                                # Normalize: " / " → "/" to break user_product matching
                                normalized_pn = re.sub(r"\s*/\s*", "/", original_pn)
                                if normalized_pn != original_pn:
                                    attr["value_name"] = normalized_pn
                                    loc_actions.append(f"normalized PART_NUMBER spacing: '{original_pn}' → '{normalized_pn}'")
                    _log_api_debug(
                        action="create_item",
                        source_seller=source_seller,
                        dest_seller=dest_seller,
                        source_item_id=item_id,
                        user_id=user_id,
                        copy_log_id=copy_log_id,
                        api_method=exc.method,
                        api_url=exc.url,
                        request_payload=payload,
                        response_status=exc.status_code,
                        response_body=exc.payload if isinstance(exc.payload, dict) else {"raw": str(exc.payload)},
                        error_message=exc.detail,
                        attempt_number=attempt,
                        adjustments=loc_actions or ["locations_assigned_retry"],
                        org_id=org_id,
                    )
                    logger.warning(
                        "ML locations-assigned error for %s -> %s (attempt %d). "
                        "Retrying with normalized PART_NUMBER: %s",
                        item_id, dest_seller, attempt, ", ".join(loc_actions),
                    )
                    continue

                if _is_title_invalid_error(exc) and not _is_title_length_error(exc):
                    force_no_title = True
                if _is_family_name_invalid_error(exc) and not _is_family_name_length_error(exc):
                    force_no_family_name = True
                adjusted_payload, actions = _adjust_payload_for_ml_error(payload, item, exc)

                # Handle official_store_id error for brand accounts
                if _is_official_store_id_error(exc) and not adjusted_payload.get("official_store_id"):
                    try:
                        osi = await get_seller_official_store_id(dest_seller, org_id=org_id)
                        if osi:
                            adjusted_payload["official_store_id"] = osi
                            actions.append(f"added official_store_id={osi} for brand account")
                            # Brand accounts also require free_shipping
                            if isinstance(adjusted_payload.get("shipping"), dict):
                                adjusted_payload["shipping"]["free_shipping"] = True
                                actions.append("forced free_shipping for brand account")
                        else:
                            raise MlApiError(
                                service_name="Mercado Livre API",
                                status_code=400,
                                method=exc.method,
                                url=exc.url,
                                detail=(
                                    f"Seller '{dest_seller}' é conta marca mas official_store_id "
                                    f"não foi encontrado em nenhum dos seus anúncios. "
                                    f"Verifique se o seller tem anúncios ativos."
                                ),
                                payload=exc.payload,
                            )
                    except MlApiError:
                        raise
                    except Exception as osi_exc:
                        logger.warning("Failed to fetch official_store_id for %s: %s", dest_seller, osi_exc)

                # Log every failed attempt to api_debug_logs
                _log_api_debug(
                    action="create_item",
                    source_seller=source_seller,
                    dest_seller=dest_seller,
                    source_item_id=item_id,
                    user_id=user_id,
                    copy_log_id=copy_log_id,
                    api_method=exc.method,
                    api_url=exc.url,
                    request_payload=payload,
                    response_status=exc.status_code,
                    response_body=exc.payload if isinstance(exc.payload, dict) else {"raw": str(exc.payload)},
                    error_message=exc.detail,
                    attempt_number=attempt,
                    adjustments=actions if actions else None,
                    org_id=org_id,
                )

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
                    if force_no_title:
                        safe_payload.pop("title", None)
                    if force_no_family_name:
                        safe_payload.pop("family_name", None)
                        if not safe_payload.get("title"):
                            title = _clean_text(item.get("title"))
                            if title:
                                safe_payload["title"] = title
                    # Preserve official_store_id discovered in earlier retries
                    if payload.get("official_store_id") and not safe_payload.get("official_store_id"):
                        safe_payload["official_store_id"] = payload["official_store_id"]
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

        # Mark previous debug logs as resolved if item was created after retries
        if attempt > 1:
            try:
                db = get_db()
                db.table("api_debug_logs").update({"resolved": True}).eq(
                    "source_item_id", item_id
                ).eq("dest_seller", dest_seller).eq("action", "create_item").execute()
            except Exception:
                pass

        # 5. POST description
        if plain_text:
            try:
                await set_item_description(dest_seller, new_item_id, plain_text, org_id=org_id)
                logger.info(f"Description set for {new_item_id}")
            except Exception as e:
                logger.warning(f"Failed to set description for {new_item_id}: {e}")
                _log_api_debug(
                    action="set_description",
                    source_seller=source_seller,
                    dest_seller=dest_seller,
                    source_item_id=item_id,
                    dest_item_id=new_item_id,
                    user_id=user_id,
                    copy_log_id=copy_log_id,
                    api_method="POST" if isinstance(e, MlApiError) else None,
                    api_url=e.url if isinstance(e, MlApiError) else None,
                    response_status=e.status_code if isinstance(e, MlApiError) else None,
                    response_body=e.payload if isinstance(e, MlApiError) and isinstance(e.payload, dict) else None,
                    error_message=str(e),
                    org_id=org_id,
                )

        # 6. Copy compatibilities (using ML native copy)
        if has_compat:
            try:
                # Pre-fetch source compat products for User Product fallback
                source_compat_products = None
                try:
                    compat_data = await get_item_compatibilities(source_seller, item_id, org_id=org_id)
                    if compat_data and isinstance(compat_data, dict):
                        source_compat_products = compat_data.get("products")
                except Exception:
                    logger.warning(f"Could not pre-fetch source compats for {item_id}")
                await copy_item_compatibilities(
                    dest_seller, new_item_id, item_id,
                    source_compat_products=source_compat_products,
                    org_id=org_id,
                )
                logger.info(f"Compatibilities copied for {new_item_id} from {item_id}")
            except Exception as e:
                logger.warning(f"Failed to copy compatibilities for {new_item_id}: {e}")
                _log_api_debug(
                    action="copy_compat",
                    source_seller=source_seller,
                    dest_seller=dest_seller,
                    source_item_id=item_id,
                    dest_item_id=new_item_id,
                    user_id=user_id,
                    copy_log_id=copy_log_id,
                    api_method="POST" if isinstance(e, MlApiError) else None,
                    api_url=e.url if isinstance(e, MlApiError) else None,
                    response_status=e.status_code if isinstance(e, MlApiError) else None,
                    response_body=e.payload if isinstance(e, MlApiError) and isinstance(e.payload, dict) else None,
                    error_message=str(e),
                    org_id=org_id,
                )

        result["status"] = "success"

    except MlApiError as e:
        correction_details = _extract_correction_details(e, payload=payload)
        if correction_details:
            logger.warning("Copy %s -> %s requires manual correction", item_id, dest_seller)
            result["status"] = CORRECTION_STATUS
            result["error"] = correction_details["summary"]
            result["correction_details"] = correction_details
            try:
                db = get_db()
                db.table("api_debug_logs").update({"resolved": True}).eq(
                    "source_item_id", item_id
                ).eq("dest_seller", dest_seller).eq("action", "create_item").execute()
            except Exception:
                pass
        else:
            logger.error(f"Failed to copy {item_id} to {dest_seller}: {e}")
            result["status"] = "error"
            result["error"] = str(e)
        # Final error debug log (if not already logged in retry loop, e.g. get_item failures)
        _log_api_debug(
            action="copy_single_item_final",
            source_seller=source_seller,
            dest_seller=dest_seller,
            source_item_id=item_id,
            user_id=user_id,
            copy_log_id=copy_log_id,
            api_method=e.method,
            api_url=e.url,
            response_status=e.status_code,
            response_body=e.payload if isinstance(e.payload, dict) else {"raw": str(e.payload)},
            error_message=e.detail,
            resolved=bool(correction_details),
            org_id=org_id,
        )
    except Exception as e:
        error_msg = str(e) or f"{type(e).__name__}: {repr(e)}"
        logger.error(f"Failed to copy {item_id} to {dest_seller}: {error_msg}")
        result["status"] = "error"
        result["error"] = error_msg
        _log_api_debug(
            action="copy_single_item_final",
            source_seller=source_seller,
            dest_seller=dest_seller,
            source_item_id=item_id,
            user_id=user_id,
            copy_log_id=copy_log_id,
            error_message=error_msg,
            org_id=org_id,
        )

    return result


async def _do_copy_items(
    db,
    source_seller: str,
    dest_sellers: list[str],
    clean_ids: list[str],
    user_email: str | None,
    user_id: str | None,
    org_id: str,
) -> list[dict]:
    """Inner implementation of copy_items, wrapped by a timeout in the public entry point."""
    sem = asyncio.Semaphore(ML_COPY_CONCURRENCY)

    async def _copy_one_item(item_id: str) -> list[dict]:
        async with sem:
            try:
                return await _copy_item_to_all_dests(
                    db, source_seller, dest_sellers, item_id,
                    user_email=user_email, user_id=user_id, org_id=org_id,
                )
            except Exception as exc:
                logger.error("Unexpected error copying item %s: %s", item_id, exc)
                # Return error results for every destination so the batch continues
                return [
                    {
                        "source_item_id": item_id,
                        "dest_seller": ds,
                        "status": "error",
                        "dest_item_id": None,
                        "error": str(exc),
                        "sku": None,
                        "correction_details": None,
                    }
                    for ds in dest_sellers
                ]

    batch_results = await asyncio.gather(
        *[_copy_one_item(iid) for iid in clean_ids],
        return_exceptions=True,
    )

    all_results: list[dict] = []
    for r in batch_results:
        if isinstance(r, Exception):
            # Outer catch — should not happen given the try/except inside _copy_one_item,
            # but guard against it anyway.
            logger.error("Unhandled exception escaped copy task: %s", r)
            continue
        all_results.extend(r)

    return all_results


async def copy_items(
    source_seller: str,
    dest_sellers: list[str],
    item_ids: list[str],
    user_email: str | None = None,
    user_id: str | None = None,
    org_id: str = "",
) -> list[dict]:
    """
    Copy multiple items to multiple destination sellers.

    Processes up to ML_COPY_CONCURRENCY items in parallel. Within each item,
    all destination sellers are also copied in parallel via asyncio.gather.
    The entire batch is bounded by BATCH_COPY_TIMEOUT seconds (default 600s).
    Each item's failure is isolated — one bad item does not abort the rest.
    """
    db = get_db()
    clean_ids = [iid.strip() for iid in item_ids if iid.strip()]

    try:
        return await asyncio.wait_for(
            _do_copy_items(db, source_seller, dest_sellers, clean_ids, user_email, user_id, org_id),
            timeout=BATCH_COPY_TIMEOUT,
        )
    except asyncio.TimeoutError:
        logger.error(
            "Batch copy timed out after %ds for %d items from %s",
            BATCH_COPY_TIMEOUT, len(clean_ids), source_seller,
        )
        # Return a timeout error entry for every item×dest pair so the
        # caller and frontend can display a meaningful status.
        return [
            {
                "source_item_id": item_id,
                "dest_seller": ds,
                "status": "error",
                "dest_item_id": None,
                "error": f"Tempo limite da operacao excedido ({BATCH_COPY_TIMEOUT}s). Tente um lote menor.",
                "sku": None,
                "correction_details": None,
            }
            for item_id in clean_ids
            for ds in dest_sellers
        ]


async def _copy_to_one_dest(
    source_seller: str,
    dest_seller: str,
    item_id: str,
    user_email: str | None,
    user_id: str | None,
    copy_log_id: int | None,
    org_id: str,
) -> dict:
    """
    Copy a single item to a single destination seller.

    Wraps copy_single_item so that any unhandled exception is caught and
    returned as an error dict, keeping asyncio.gather from treating it as a
    raised exception that must be re-raised.
    """
    try:
        return await copy_single_item(
            source_seller, dest_seller, item_id, user_email,
            user_id=user_id, copy_log_id=copy_log_id, org_id=org_id,
        )
    except Exception as exc:
        logger.error(
            "Unhandled exception copying %s -> %s (%s): %s",
            item_id, dest_seller, source_seller, exc,
        )
        return {
            "source_item_id": item_id,
            "dest_seller": dest_seller,
            "status": "error",
            "dest_item_id": None,
            "error": str(exc),
            "sku": None,
            "correction_details": None,
        }


async def _copy_item_to_all_dests(
    db,
    source_seller: str,
    dest_sellers: list[str],
    item_id: str,
    user_email: str | None = None,
    user_id: str | None = None,
    org_id: str = "",
) -> list[dict]:
    """
    Copy a single item to all destination sellers in parallel.

    Creates an in_progress log entry before firing off the copies, then
    updates the log with the final aggregated result once every destination
    has completed (success or error). Each destination's failure is isolated
    and does not abort copies to other destinations.
    """
    # Create in_progress log entry BEFORE starting the copies
    log_id: int | None = None
    try:
        log_insert: dict[str, Any] = {
            "user_email": user_email,
            "source_seller": source_seller,
            "dest_sellers": dest_sellers,
            "source_item_id": item_id,
            "status": "in_progress",
        }
        if user_id:
            log_insert["user_id"] = user_id
        if org_id:
            log_insert["org_id"] = org_id
        log_row = db.table("copy_logs").insert(log_insert).execute()
        log_id = log_row.data[0]["id"] if log_row.data else None
    except Exception as e:
        logger.error(f"Failed to create in_progress log for {item_id}: {e}")

    # Fan out to all destinations in parallel.  _copy_to_one_dest never raises
    # (all exceptions are caught inside), so return_exceptions=True is a belt-
    # and-suspenders guard — the gathered values are always dicts.
    dest_tasks = [
        _copy_to_one_dest(
            source_seller, dest_seller, item_id, user_email,
            user_id=user_id, copy_log_id=log_id, org_id=org_id,
        )
        for dest_seller in dest_sellers
    ]
    gathered = await asyncio.gather(*dest_tasks, return_exceptions=True)

    # Normalise results — if somehow an exception leaked through, convert it
    results: list[dict] = []
    for dest_seller, outcome in zip(dest_sellers, gathered):
        if isinstance(outcome, Exception):
            logger.error(
                "Exception escaped _copy_to_one_dest for %s -> %s: %s",
                item_id, dest_seller, outcome,
            )
            results.append({
                "source_item_id": item_id,
                "dest_seller": dest_seller,
                "status": "error",
                "dest_item_id": None,
                "error": str(outcome),
                "sku": None,
                "correction_details": None,
            })
        else:
            results.append(outcome)

    # Aggregate metadata and per-dest status for the log entry
    dest_item_ids: dict[str, str] = {}
    item_errors: dict[str, str] = {}
    has_needs_correction = False
    correction_details: dict[str, Any] | None = None
    item_title = ""
    item_thumbnail = ""
    item_sku: str | None = None

    for result in results:
        # Capture title/thumbnail from whichever dest returned it first
        if not item_title and result.get("_title"):
            item_title = result["_title"]
            item_thumbnail = result.get("_thumbnail", "")
        if not item_sku and result.get("sku"):
            item_sku = result["sku"]

        dest = result.get("dest_seller", "")
        if result["status"] == "success":
            if dest and result.get("dest_item_id"):
                dest_item_ids[dest] = result["dest_item_id"]
        elif result["status"] == CORRECTION_STATUS:
            has_needs_correction = True
            if dest:
                item_errors[dest] = result["error"] or ""
            if not correction_details and isinstance(result.get("correction_details"), dict):
                correction_details = result["correction_details"]
        else:
            if dest:
                item_errors[dest] = result.get("error") or ""

    # Determine final status
    if dest_item_ids and not item_errors:
        item_status = "success"
    elif has_needs_correction:
        item_status = CORRECTION_STATUS
    elif dest_item_ids and item_errors:
        item_status = "partial"
    else:
        item_status = "error"

    # Persist final result — update the in_progress log created above, or
    # insert a new row if the initial insert failed.
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
            db.table("copy_logs").update(update_data).eq("id", log_id).execute()
        else:
            fallback: dict[str, Any] = {
                "user_email": user_email,
                "source_seller": source_seller,
                "dest_sellers": dest_sellers,
                "source_item_id": item_id,
                "dest_item_ids": dest_item_ids,
                "status": item_status,
                "error_details": item_errors if item_errors else None,
                "correction_details": correction_details if item_status == CORRECTION_STATUS else None,
                "source_item_sku": item_sku,
            }
            if user_id:
                fallback["user_id"] = user_id
            if org_id:
                fallback["org_id"] = org_id
            db.table("copy_logs").insert(fallback).execute()
    except Exception as e:
        logger.error(f"Failed to update log for {item_id}: {e}")

    return results


async def copy_with_dimensions(
    source_seller: str,
    dest_sellers: list[str],
    item_id: str,
    dimensions: dict,
    org_id: str = "",
    user_id: str | None = None,
) -> list[dict]:
    """
    Apply shipping dimensions to the source item, then copy to destinations.
    Also updates destination items that were already created (if any).
    """
    dim_attrs = _build_dimension_attributes(dimensions)

    return await _copy_with_source_attribute_updates(
        source_seller=source_seller,
        dest_sellers=dest_sellers,
        item_id=item_id,
        attrs=dim_attrs,
        failure_message_prefix="Falha ao atualizar dimensoes no item origem",
        org_id=org_id,
        user_id=user_id,
    )


def _build_manual_attribute_corrections(values: dict[str, Any]) -> list[dict]:
    attrs: list[dict] = []
    for raw_attr_id, raw_value in values.items():
        attr_id = _clean_text(raw_attr_id).upper()
        value = _clean_text(raw_value)
        if not attr_id or not value:
            continue
        attrs.append({"id": attr_id, "value_name": value})
    return attrs


async def _copy_with_source_attribute_updates(
    source_seller: str,
    dest_sellers: list[str],
    item_id: str,
    attrs: list[dict],
    failure_message_prefix: str,
    org_id: str = "",
    user_id: str | None = None,
) -> list[dict]:
    """Apply attribute updates to the source item, then re-run the copy flow."""
    if not attrs:
        return [{
            "source_item_id": item_id,
            "dest_seller": ds,
            "status": "error",
            "dest_item_id": None,
            "error": "Nenhuma correcao valida foi informada.",
            "correction_details": None,
        } for ds in dest_sellers]

    # 1. Update source item with the supplied attributes/corrections
    try:
        await update_item(source_seller, item_id, {"attributes": attrs}, org_id=org_id)
        logger.info("Source item %s updated on %s with %d correction attribute(s)", item_id, source_seller, len(attrs))
    except Exception as e:
        logger.error("Failed to apply source corrections to %s: %s", item_id, e)
        return [{
            "source_item_id": item_id,
            "dest_seller": ds,
            "status": "error",
            "dest_item_id": None,
            "error": f"{failure_message_prefix}: {e}",
            "correction_details": None,
        } for ds in dest_sellers]

    # 2. Re-copy to all destinations in parallel (item now has the correction applied)
    dest_tasks = [
        _copy_to_one_dest(
            source_seller, dest_seller, item_id, None,
            user_id=user_id, copy_log_id=None, org_id=org_id,
        )
        for dest_seller in dest_sellers
    ]
    gathered = await asyncio.gather(*dest_tasks, return_exceptions=True)

    results: list[dict] = []
    for dest_seller, outcome in zip(dest_sellers, gathered):
        if isinstance(outcome, Exception):
            logger.error(
                "Exception in correction re-copy %s -> %s: %s",
                item_id, dest_seller, outcome,
            )
            results.append({
                "source_item_id": item_id,
                "dest_seller": dest_seller,
                "status": "error",
                "dest_item_id": None,
                "error": str(outcome),
                "sku": None,
                "correction_details": None,
            })
        else:
            results.append(outcome)

    return results


async def copy_with_attribute_corrections(
    source_seller: str,
    dest_sellers: list[str],
    item_id: str,
    values: dict[str, Any],
    org_id: str = "",
    user_id: str | None = None,
) -> list[dict]:
    """Apply manual attribute corrections to the source item, then copy again."""
    return await _copy_with_source_attribute_updates(
        source_seller=source_seller,
        dest_sellers=dest_sellers,
        item_id=item_id,
        attrs=_build_manual_attribute_corrections(values),
        failure_message_prefix="Falha ao atualizar atributos no item origem",
        org_id=org_id,
        user_id=user_id,
    )


async def copy_with_title_override(
    source_seller: str,
    dest_sellers: list[str],
    item_id: str,
    title: str,
    org_id: str = "",
    user_id: str | None = None,
) -> list[dict]:
    """Copy item with a user-provided title (for title length correction).

    Unlike dimension/attribute corrections, this does NOT update the source item.
    It fetches the source, builds the payload, replaces the title, and creates.
    """
    clean_title = _clean_text(title)
    if not clean_title:
        return [{
            "source_item_id": item_id,
            "dest_seller": ds,
            "status": "error",
            "dest_item_id": None,
            "error": "Titulo nao pode ser vazio.",
            "sku": None,
            "correction_details": None,
        } for ds in dest_sellers]

    async def _copy_one(dest_seller: str) -> dict:
        try:
            return await copy_single_item(
                source_seller=source_seller,
                dest_seller=dest_seller,
                item_id=item_id,
                user_email=None,
                user_id=user_id,
                org_id=org_id,
                title_override=clean_title,
            )
        except Exception as exc:
            logger.error(
                "Exception in title-override copy %s -> %s: %s",
                item_id, dest_seller, exc,
            )
            return {
                "source_item_id": item_id,
                "dest_seller": dest_seller,
                "status": "error",
                "dest_item_id": None,
                "error": str(exc),
                "sku": None,
                "correction_details": None,
            }

    results = await asyncio.gather(*[_copy_one(ds) for ds in dest_sellers])
    return list(results)
