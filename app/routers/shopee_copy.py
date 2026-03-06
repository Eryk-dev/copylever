"""
Shopee copy endpoints — POST /api/shopee/copy, GET /api/shopee/copy/logs, etc.
"""
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.db.supabase import get_db
from app.routers.auth import require_active_org, require_user
from app.services.shopee_api import ShopeeApiError, get_item as shopee_get_item
from app.services.shopee_copier import copy_items, copy_with_dimensions

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/shopee/copy", tags=["shopee-copy"])


# ── Trial limit helpers (same pattern as copy.py) ─────────


def _check_trial_limit(org_id: str, requested_copies: int) -> dict | None:
    db = get_db()
    org = db.table("orgs").select(
        "payment_active, trial_copies_used, trial_copies_limit"
    ).eq("id", org_id).single().execute().data

    if not org or org.get("payment_active"):
        return None

    used = org.get("trial_copies_used", 0)
    limit = org.get("trial_copies_limit", 20)
    remaining = max(0, limit - used)

    if remaining <= 0:
        return {
            "allowed": False,
            "remaining": 0,
            "message": f"Periodo de teste encerrado. Voce usou todas as {limit} copias gratuitas. Assine para continuar.",
        }

    if requested_copies > remaining:
        return {
            "allowed": False,
            "remaining": remaining,
            "message": f"Voce tem {remaining} copia(s) gratuita(s) restante(s). Reduza a quantidade ou assine para copias ilimitadas.",
        }

    return {"allowed": True, "remaining": remaining}


def _increment_trial_copies(org_id: str, count: int):
    db = get_db()
    org = db.table("orgs").select("trial_copies_used").eq("id", org_id).single().execute().data
    if org:
        new_val = (org.get("trial_copies_used", 0) or 0) + count
        db.table("orgs").update({"trial_copies_used": new_val}).eq("id", org_id).execute()


# ── Permission helpers ────────────────────────────────────


def _check_seller_permission(user: dict, seller_slug: str, direction: str) -> bool:
    if user["role"] == "admin":
        return True
    key = "can_copy_from" if direction == "from" else "can_copy_to"
    return any(
        p["seller_slug"] == seller_slug and p.get(key, False)
        for p in user.get("permissions", [])
    )


# ── Request models ────────────────────────────────────────


class ShopeeCopyRequest(BaseModel):
    source: str
    destinations: list[str]
    item_ids: list[str]


class ShopeeDimensions(BaseModel):
    height: int | None = None
    width: int | None = None
    length: int | None = None
    weight: int | None = None  # grams


class ShopeeCopyWithDimensionsRequest(BaseModel):
    source: str
    destinations: list[str]
    item_id: str
    dimensions: ShopeeDimensions


class ResolveSellersRequest(BaseModel):
    item_ids: list[str]


# ── Helpers ───────────────────────────────────────────────


def _normalize_shopee_item_id(raw: str) -> int | None:
    """Extract Shopee item ID (integer) from raw input or URL."""
    clean = raw.strip()
    if not clean:
        return None
    # URL pattern: shopee.com.br/product/X/Y or shopee.com.br/...-i.X.Y
    if "/" in clean:
        parts = clean.rstrip("/").split("/")
        # Try last segment
        last = parts[-1]
        # Handle i.shopid.itemid format
        if last.startswith("i."):
            segments = last.split(".")
            if len(segments) >= 3 and segments[-1].isdigit():
                return int(segments[-1])
        if last.isdigit():
            return int(last)
        # Try second to last if last is not numeric
        if len(parts) >= 2 and parts[-2].isdigit():
            return int(parts[-2])
    # Pure number
    if clean.isdigit():
        return int(clean)
    return None


# ── Endpoints ─────────────────────────────────────────────


@router.post("")
async def shopee_copy(req: ShopeeCopyRequest, user: dict = Depends(require_active_org)):
    """Copy Shopee listings from source shop to destination shop(s)."""
    if not req.source:
        raise HTTPException(status_code=400, detail="source is required")
    if not req.destinations:
        raise HTTPException(status_code=400, detail="At least one destination is required")
    if not req.item_ids:
        raise HTTPException(status_code=400, detail="At least one item_id is required")
    if req.source in req.destinations:
        raise HTTPException(status_code=400, detail="Source cannot be in destinations")

    # Permission checks
    if not _check_seller_permission(user, req.source, "from"):
        raise HTTPException(status_code=403, detail=f"Sem permissao de origem para a loja '{req.source}'")
    denied_dests = [d for d in req.destinations if not _check_seller_permission(user, d, "to")]
    if denied_dests:
        raise HTTPException(status_code=403, detail=f"Sem permissao de destino para a(s) loja(s): {', '.join(denied_dests)}")

    # Normalize item IDs to int
    clean_ids: list[int] = []
    for raw in req.item_ids:
        for part in raw.replace(",", "\n").split("\n"):
            parsed = _normalize_shopee_item_id(part)
            if parsed is not None and parsed not in clean_ids:
                clean_ids.append(parsed)

    if not clean_ids:
        raise HTTPException(status_code=400, detail="No valid item IDs provided")

    org_id = user["org_id"]

    # Trial limit check
    trial_info = _check_trial_limit(org_id, len(clean_ids))
    if trial_info and not trial_info["allowed"]:
        raise HTTPException(status_code=402, detail=trial_info["message"])

    results = await copy_items(
        source_slug=req.source,
        dest_slugs=req.destinations,
        item_ids=clean_ids,
        user_id=user["id"],
        org_id=org_id,
    )

    success_count = results.get("success", 0)

    # Increment trial counter
    if trial_info and success_count > 0:
        _increment_trial_copies(org_id, success_count)

    return results


@router.post("/with-dimensions")
async def shopee_copy_with_dims(
    req: ShopeeCopyWithDimensionsRequest, user: dict = Depends(require_active_org)
):
    """Copy a Shopee item with user-provided dimensions."""
    # Permission checks
    if not _check_seller_permission(user, req.source, "from"):
        raise HTTPException(status_code=403, detail=f"Sem permissao de origem para a loja '{req.source}'")
    denied_dests = [d for d in req.destinations if not _check_seller_permission(user, d, "to")]
    if denied_dests:
        raise HTTPException(status_code=403, detail=f"Sem permissao de destino para a(s) loja(s): {', '.join(denied_dests)}")

    parsed_id = _normalize_shopee_item_id(req.item_id)
    if parsed_id is None:
        raise HTTPException(status_code=400, detail="Invalid item ID")

    org_id = user["org_id"]

    # Trial limit check
    trial_info = _check_trial_limit(org_id, 1)
    if trial_info and not trial_info["allowed"]:
        raise HTTPException(status_code=402, detail=trial_info["message"])

    # Convert dimensions: grams -> kg for weight, rest pass through as cm
    dims: dict = {}
    if req.dimensions.height:
        dims["height"] = req.dimensions.height
    if req.dimensions.width:
        dims["width"] = req.dimensions.width
    if req.dimensions.length:
        dims["length"] = req.dimensions.length
    if req.dimensions.weight:
        dims["weight"] = req.dimensions.weight / 1000  # grams to kg

    if not dims:
        raise HTTPException(status_code=400, detail="At least one dimension is required")

    results = await copy_with_dimensions(
        source_slug=req.source,
        dest_slugs=req.destinations,
        item_id=parsed_id,
        dimensions=dims,
        user_id=user["id"],
        org_id=org_id,
    )

    success_count = results.get("success", 0)

    if trial_info and success_count > 0:
        _increment_trial_copies(org_id, success_count)

    return results


@router.get("/preview/{item_id}")
async def shopee_preview(item_id: int, user: dict = Depends(require_active_org)):
    """Preview a Shopee item. Auto-detects which shop owns it."""
    org_id = user["org_id"]
    db = get_db()

    # Get all active Shopee sellers for this org
    sellers = db.table("shopee_sellers").select(
        "slug, shop_id"
    ).eq("active", True).eq("org_id", org_id).execute()

    if not sellers.data:
        raise HTTPException(status_code=404, detail="Nenhuma loja Shopee conectada")

    # Try each seller to find the item
    found_base: dict | None = None
    found_extra: dict | None = None
    found_models: list = []
    found_slug: str | None = None

    for seller in sellers.data:
        shop_id = seller["shop_id"]
        slug = seller["slug"]
        try:
            base_resp = await shopee_get_item(shop_id, item_id, org_id)
            item_list = base_resp.get("response", {}).get("item_list", [])
            if not item_list:
                continue
            found_base = item_list[0]
            found_slug = slug

            # Fetch extra info for description
            try:
                from app.services.shopee_api import get_item_extra
                extra_resp = await get_item_extra(shop_id, item_id, org_id)
                extra_list = extra_resp.get("response", {}).get("item_list", [])
                if extra_list:
                    found_extra = extra_list[0]
            except Exception:
                pass

            # Fetch models
            try:
                from app.services.shopee_api import get_model_list
                models_resp = await get_model_list(shop_id, item_id, org_id)
                found_models = models_resp.get("response", {}).get("model", []) or []
            except Exception:
                pass

            break
        except (ShopeeApiError, Exception):
            continue

    if not found_base or not found_slug:
        raise HTTPException(status_code=404, detail="Item nao encontrado em nenhuma loja conectada")

    # Extract preview data
    image_urls = found_base.get("image", {}).get("image_url_list", [])
    first_image = image_urls[0] if image_urls else ""

    has_description = bool(
        found_extra and found_extra.get("description")
    ) if found_extra else False

    # Stock
    stock = 0
    stock_info = found_base.get("stock_info_v2", {})
    if stock_info:
        summary = stock_info.get("summary_info", {})
        stock = summary.get("total_available_stock", 0)

    return {
        "item_id": item_id,
        "item_name": found_base.get("item_name", ""),
        "original_price": found_base.get("original_price", 0),
        "stock": stock,
        "category_id": found_base.get("category_id", 0),
        "status": found_base.get("item_status", ""),
        "image_url": first_image,
        "image_count": len(image_urls),
        "model_count": len(found_models),
        "has_description": has_description,
        "weight": found_base.get("weight", 0),
        "shop_slug": found_slug,
    }


@router.get("/logs")
async def shopee_copy_logs(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None),
    user: dict = Depends(require_user),
):
    """Get Shopee copy history. Operators see only their own logs; admins see all."""
    db = get_db()
    query = db.table("shopee_copy_logs").select("*").order("created_at", desc=True)

    if user.get("is_super_admin"):
        pass  # super-admin sees all
    elif user["role"] == "admin":
        query = query.eq("org_id", user["org_id"])
    else:
        query = query.eq("user_id", user["id"])

    if status:
        query = query.eq("status", status)

    result = query.range(offset, offset + limit - 1).execute()
    return result.data or []


@router.post("/resolve-sellers")
async def shopee_resolve_sellers(req: ResolveSellersRequest, user: dict = Depends(require_active_org)):
    """Resolve which Shopee shop owns each item ID."""
    org_id = user["org_id"]
    db = get_db()

    # Normalize and deduplicate IDs
    clean_ids: list[int] = []
    for raw in req.item_ids:
        parsed = _normalize_shopee_item_id(raw)
        if parsed is not None and parsed not in clean_ids:
            clean_ids.append(parsed)

    if not clean_ids:
        return {"results": [], "errors": []}

    # Get active Shopee sellers with permission check for operators
    sellers = db.table("shopee_sellers").select(
        "slug, shop_id"
    ).eq("active", True).eq("org_id", org_id).execute()

    if not sellers.data:
        return {
            "results": [],
            "errors": [{"item_id": str(iid), "error": "Nenhuma loja Shopee conectada"} for iid in clean_ids],
        }

    # Filter sellers by can_copy_from permission for operators
    eligible_sellers = []
    for s in sellers.data:
        if _check_seller_permission(user, s["slug"], "from"):
            eligible_sellers.append(s)

    if not eligible_sellers:
        return {
            "results": [],
            "errors": [{"item_id": str(iid), "error": "Sem permissao para nenhuma loja"} for iid in clean_ids],
        }

    sem = asyncio.Semaphore(5)

    async def _try_resolve(item_id: int) -> tuple[int, str | None, str | None]:
        """Try each eligible seller to find item. Returns (item_id, slug, error)."""
        async with sem:
            for seller in eligible_sellers:
                try:
                    resp = await shopee_get_item(seller["shop_id"], item_id, org_id)
                    item_list = resp.get("response", {}).get("item_list", [])
                    if item_list:
                        return item_id, seller["slug"], None
                except (ShopeeApiError, Exception):
                    continue
            return item_id, None, "Item nao encontrado em nenhuma loja conectada"

    tasks = [_try_resolve(iid) for iid in clean_ids]
    resolved = await asyncio.gather(*tasks, return_exceptions=True)

    results = []
    errors = []
    for r in resolved:
        if isinstance(r, BaseException):
            continue
        item_id, slug, error = r
        if slug:
            results.append({"item_id": str(item_id), "shop_slug": slug})
        else:
            errors.append({"item_id": str(item_id), "error": error or "Erro desconhecido"})

    return {"results": results, "errors": errors}
