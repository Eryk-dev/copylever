"""
Photos endpoints — preview item photos, upload, search SKU, apply, logs.
"""
import asyncio
import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile
from pydantic import BaseModel, field_validator

from app.db.supabase import get_db
from app.routers.auth import require_active_org
from app.services.compat_copier import search_sku_all_sellers
from app.services.ml_api import get_item, upload_picture
from app.services.photo_applier import apply_photos_to_targets

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

    # Extract pictures — when the item has variations, show only the first
    # variation's pictures (ordered by its picture_ids) so the user edits a
    # single variation set instead of seeing the combined gallery.
    all_pictures = item.get("pictures", [])
    pic_by_id = {p.get("id"): p for p in all_pictures if p.get("id")}

    variations = item.get("variations", [])
    first_var_pic_ids = (
        variations[0].get("picture_ids", []) if variations else []
    )

    if first_var_pic_ids and pic_by_id:
        # Use first variation's picture_ids to filter & order
        ordered = [pic_by_id[pid] for pid in first_var_pic_ids if pid in pic_by_id]
        source_pics = ordered if ordered else all_pictures
    else:
        source_pics = all_pictures

    pictures = []
    for pic in source_pics:
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


_ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png"}
_MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/upload")
async def upload_photo(
    file: UploadFile,
    seller: str = Query(...),
    user: dict = Depends(require_active_org),
):
    """Upload an image to ML and return the picture_id."""
    org_id = user["org_id"]

    # Validate seller permission for operators
    if user["role"] != "admin":
        allowed = {
            p["seller_slug"]
            for p in user.get("permissions", [])
            if p.get("can_copy_to")
        }
        if seller not in allowed:
            raise HTTPException(status_code=403, detail=f"Sem permissão para o seller: {seller}")

    # Validate content type
    ct = (file.content_type or "").lower()
    if ct not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de arquivo inválido. Apenas JPG/JPEG/PNG são aceitos.")

    # Read and validate size
    file_bytes = await file.read()
    if len(file_bytes) > _MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Arquivo excede o limite de 10MB.")

    try:
        result = await upload_picture(
            seller_slug=seller,
            file_bytes=file_bytes,
            filename=file.filename or "image.jpg",
            content_type=ct,
            org_id=org_id,
        )
    except Exception as exc:
        logger.error("Photo upload failed for seller=%s: %s", seller, exc)
        raise HTTPException(status_code=502, detail=f"Erro ao enviar foto para o Mercado Livre: {exc}")

    return result


class SearchSkuRequest(BaseModel):
    skus: list[str]

    @field_validator("skus")
    @classmethod
    def limit_skus(cls, v: list[str]) -> list[str]:
        if len(v) > 50:
            raise ValueError("Maximo de 50 SKUs por busca")
        return v


@router.post("/search-sku")
async def search_sku(req: SearchSkuRequest, user: dict = Depends(require_active_org)):
    """Search for items by SKU across connected sellers (filtered by permissions)."""
    if not req.skus:
        raise HTTPException(status_code=400, detail="Informe ao menos um SKU")

    org_id = user["org_id"]
    # Filter sellers by can_copy_to permission (admins get all)
    allowed_sellers = None
    if user["role"] != "admin":
        allowed_sellers = [
            p["seller_slug"]
            for p in user.get("permissions", [])
            if p.get("can_copy_to")
        ]

    results = await search_sku_all_sellers(
        req.skus, allowed_sellers=allowed_sellers, org_id=org_id,
        expand_variations=True,
    )
    return results


# ---------------------------------------------------------------------------
# Apply photos
# ---------------------------------------------------------------------------

class PictureEntry(BaseModel):
    id: str | None = None
    source: str | None = None

    @field_validator("source")
    @classmethod
    def validate_not_empty(cls, v: str | None, info) -> str | None:  # noqa: N805
        # At least one of id or source must be provided (checked at model level)
        return v

    def model_post_init(self, __context: Any) -> None:
        if not self.id and not self.source:
            raise ValueError("Cada foto deve ter 'id' ou 'source'")


class ApplyTarget(BaseModel):
    seller_slug: str
    item_id: str
    variation_id: int | None = None


class ApplyRequest(BaseModel):
    source_item_id: str
    sku: str | None = None
    pictures: list[PictureEntry]
    targets: list[ApplyTarget]


@router.post("/apply")
async def apply_photos(
    req: ApplyRequest,
    bg: BackgroundTasks,
    user: dict = Depends(require_active_org),
):
    """Queue photo application to target items — returns immediately."""
    if not req.targets:
        raise HTTPException(status_code=400, detail="Informe ao menos um anúncio destino")
    if not req.pictures:
        raise HTTPException(status_code=400, detail="Informe ao menos uma foto")

    org_id = user["org_id"]

    # Validate can_copy_to permissions for operators
    if user["role"] != "admin":
        allowed = {
            p["seller_slug"]
            for p in user.get("permissions", [])
            if p.get("can_copy_to")
        }
        denied = [t.seller_slug for t in req.targets if t.seller_slug not in allowed]
        if denied:
            raise HTTPException(
                status_code=403,
                detail=f"Sem permissão para copiar para: {', '.join(denied)}",
            )

    targets = [
        {"seller_slug": t.seller_slug, "item_id": t.item_id, "variation_id": t.variation_id}
        for t in req.targets
    ]
    pictures = [p.model_dump(exclude_none=True) for p in req.pictures]

    # Create photo_logs record before background task so we can return log_id
    db = get_db()
    pending_targets: list[dict[str, Any]] = [
        {**t, "status": "pending", "error": None} for t in targets
    ]
    log_insert: dict[str, Any] = {
        "source_item_id": req.source_item_id,
        "sku": req.sku or "",
        "targets": pending_targets,
        "total_targets": len(targets),
        "success_count": 0,
        "error_count": 0,
        "status": "processing",
        "org_id": org_id,
    }
    if user.get("id"):
        log_insert["user_id"] = user["id"]
    log_row = db.table("photo_logs").insert(log_insert).execute()
    log_id = log_row.data[0]["id"]

    bg.add_task(
        apply_photos_to_targets,
        source_item_id=req.source_item_id,
        sku=req.sku,
        pictures=pictures,
        targets=targets,
        user_id=user.get("id"),
        org_id=org_id,
        log_id=log_id,
    )

    return {
        "log_id": log_id,
        "status": "processing",
        "message": "Fotos sendo aplicadas...",
    }


# ---------------------------------------------------------------------------
# Logs
# ---------------------------------------------------------------------------

@router.get("/logs")
async def photo_logs(
    limit: int = Query(20, le=200),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None),
    user: dict = Depends(require_active_org),
):
    """Get photo operation history. Operators see only their own logs; admins see all."""
    db = get_db()
    query = db.table("photo_logs").select("*, users(username)").order(
        "created_at", desc=True
    )
    if user.get("is_super_admin"):
        pass  # super-admin sees all logs
    elif user["role"] == "admin":
        query = query.eq("org_id", user["org_id"])
    else:
        query = query.eq("user_id", user["id"])
    if status:
        query = query.eq("status", status)
    result = query.range(offset, offset + limit - 1).execute()
    # Flatten the joined username into each log entry
    logs = []
    for row in result.data or []:
        users_data = row.pop("users", None)
        row["username"] = users_data["username"] if users_data else None
        logs.append(row)
    return logs
