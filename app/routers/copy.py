"""
Copy endpoints — POST /api/copy, GET /api/copy/logs, GET /api/copy/preview
"""
import asyncio
import logging
import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

from app.db.supabase import get_db
from app.routers.auth import require_active_org, require_user
from app.services.item_copier import (
    CORRECTION_STATUS,
    LEGACY_DIMENSION_STATUS,
    _build_dimension_correction_details,
    copy_items,
    copy_with_attribute_corrections,
    copy_with_dimensions,
)
from app.services.ml_api import get_item, get_item_description, get_item_compatibilities

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/copy", tags=["copy"])
CORRECTION_PENDING_STATUSES = {CORRECTION_STATUS, LEGACY_DIMENSION_STATUS}

# ── Per-org queue management ──────────────────────────────────────────────────

_org_copy_locks: dict[str, asyncio.Lock] = {}
_org_queue_sizes: dict[str, int] = {}
MAX_QUEUE_PER_ORG = 3  # max concurrent background copy tasks per org
BATCH_TIMEOUT_SECONDS = 600  # 10 minutes per batch


def _get_org_lock(org_id: str) -> asyncio.Lock:
    """Return (or create) the per-org asyncio Lock using atomic setdefault."""
    return _org_copy_locks.setdefault(org_id, asyncio.Lock())


# ── Trial limit helpers ───────────────────────────────────────────────────────


def _check_trial_limit(org_id: str, requested_copies: int) -> dict | None:
    """Check if org is on trial and has enough remaining copies.

    Returns None if org has active payment (no trial needed).
    Returns dict with allowed/remaining/message otherwise.
    """
    db = get_db()
    org = db.table("orgs").select(
        "payment_active, trial_copies_used, trial_copies_limit"
    ).eq("id", org_id).single().execute().data

    if not org or org.get("payment_active"):
        return None  # Paid org, no trial limits

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
    """Increment trial_copies_used for an org."""
    db = get_db()
    org = db.table("orgs").select("trial_copies_used").eq("id", org_id).single().execute().data
    if org:
        new_val = (org.get("trial_copies_used", 0) or 0) + count
        db.table("orgs").update({"trial_copies_used": new_val}).eq("id", org_id).execute()


def _refund_trial_copies(org_id: str, count: int):
    """Decrement trial_copies_used after failures are known."""
    if count <= 0:
        return
    db = get_db()
    org = db.table("orgs").select("trial_copies_used").eq("id", org_id).single().execute().data
    if org:
        new_val = max(0, (org.get("trial_copies_used", 0) or 0) - count)
        db.table("orgs").update({"trial_copies_used": new_val}).eq("id", org_id).execute()


# ── Background task helpers ───────────────────────────────────────────────────


async def _bg_copy_items(
    source: str,
    destinations: list[str],
    item_ids: list[str],
    user_id: str,
    org_id: str,
    trial_reserved: int,
) -> None:
    """Inner background worker for copy_items with timeout and trial refund."""
    try:
        results = await asyncio.wait_for(
            copy_items(
                source_seller=source,
                dest_sellers=destinations,
                item_ids=item_ids,
                user_id=user_id,
                org_id=org_id,
            ),
            timeout=BATCH_TIMEOUT_SECONDS,
        )
        if trial_reserved > 0:
            success_count = sum(1 for r in results if r["status"] == "success")
            _refund_trial_copies(org_id, trial_reserved - success_count)
    except asyncio.TimeoutError:
        logger.error(
            "Batch copy timed out after %ss for org %s (items: %s)",
            BATCH_TIMEOUT_SECONDS,
            org_id,
            item_ids,
        )
        if trial_reserved > 0:
            _refund_trial_copies(org_id, trial_reserved)
        # Mark any remaining in_progress logs as error
        try:
            db = get_db()
            db.table("copy_logs").update({"status": "error", "error_details": {"_timeout": "Operacao excedeu o tempo limite de 10 minutos"}}).eq(
                "org_id", org_id
            ).eq("status", "in_progress").execute()
        except Exception as db_err:
            logger.error("Failed to update timed-out logs: %s", db_err)
    except Exception as e:
        logger.error("Background copy batch failed: %s", e, exc_info=True)
        if trial_reserved > 0:
            _refund_trial_copies(org_id, trial_reserved)


async def _bg_copy_items_queued(
    source: str,
    destinations: list[str],
    item_ids: list[str],
    user_id: str,
    org_id: str,
    trial_reserved: int,
) -> None:
    """Wrapper that enforces per-org concurrency queue before running _bg_copy_items."""
    current = _org_queue_sizes.get(org_id, 0)
    if current >= MAX_QUEUE_PER_ORG:
        logger.warning(
            "Org %s already has %d task(s) running (max %d); rejecting new batch",
            org_id,
            current,
            MAX_QUEUE_PER_ORG,
        )
        if trial_reserved > 0:
            _refund_trial_copies(org_id, trial_reserved)
        # Mark any in_progress logs we may have created as error
        try:
            db = get_db()
            db.table("copy_logs").update({
                "status": "error",
                "error_details": {"_queue": "Fila maxima atingida. Aguarde o termino das operacoes em andamento."},
            }).eq("org_id", org_id).eq("status", "in_progress").execute()
        except Exception as db_err:
            logger.error("Failed to update queue-full logs: %s", db_err)
        return

    _org_queue_sizes[org_id] = current + 1
    try:
        await _bg_copy_items(
            source=source,
            destinations=destinations,
            item_ids=item_ids,
            user_id=user_id,
            org_id=org_id,
            trial_reserved=trial_reserved,
        )
    finally:
        _org_queue_sizes[org_id] = max(0, _org_queue_sizes.get(org_id, 1) - 1)


async def _bg_copy_with_dims(
    source: str,
    destinations: list[str],
    item_id: str,
    dimensions: dict,
    user_id: str,
    org_id: str,
    existing_log_id: int | None,
    trial_info_present: bool,
) -> None:
    """Background worker for copy_with_dimensions."""
    try:
        results = await asyncio.wait_for(
            copy_with_dimensions(
                source_seller=source,
                dest_sellers=destinations,
                item_id=item_id,
                dimensions=dimensions,
                org_id=org_id,
                user_id=user_id,
            ),
            timeout=BATCH_TIMEOUT_SECONDS,
        )

        success_count, error_count, correction_count = _count_result_statuses(results)

        # Increment trial counter for successful copies
        if trial_info_present and success_count > 0:
            _increment_trial_copies(org_id, 1)

        # Update any existing pending-correction log entries for this item
        if success_count > 0 or existing_log_id:
            db = get_db()
            dest_item_ids = {r["dest_seller"]: r["dest_item_id"] for r in results if r["status"] == "success"}
            new_errors = {r["dest_seller"]: r["error"] for r in results if r["status"] != "success" and r.get("error")}
            new_status = _derive_log_status(results)
            source_item_sku = next((r.get("sku") for r in results if r.get("sku")), None)
            correction_details = next(
                (r.get("correction_details") for r in results if isinstance(r.get("correction_details"), dict)),
                None,
            )
            if existing_log_id:
                try:
                    db.table("copy_logs").update({
                        "status": new_status,
                        "dest_item_ids": dest_item_ids or None,
                        "error_details": new_errors or None,
                        "correction_details": correction_details if new_status == CORRECTION_STATUS else None,
                        "source_item_sku": source_item_sku,
                    }).eq("id", existing_log_id).eq("org_id", org_id).execute()
                except Exception as e:
                    logger.warning("Failed to update log %s: %s", existing_log_id, e)
            else:
                for pending_status in CORRECTION_PENDING_STATUSES:
                    try:
                        db.table("copy_logs").update({
                            "status": new_status,
                            "dest_item_ids": dest_item_ids or None,
                            "error_details": new_errors or None,
                            "correction_details": correction_details if new_status == CORRECTION_STATUS else None,
                            "source_item_sku": source_item_sku,
                        }).eq("source_item_id", item_id).eq(
                            "source_seller", source
                        ).eq("status", pending_status).eq("org_id", org_id).execute()
                    except Exception as e:
                        logger.warning("Failed to update pending correction logs for %s (%s): %s", item_id, pending_status, e)
    except asyncio.TimeoutError:
        logger.error("copy_with_dims timed out after %ss for org %s item %s", BATCH_TIMEOUT_SECONDS, org_id, item_id)
        try:
            db = get_db()
            if existing_log_id:
                db.table("copy_logs").update({"status": "error", "error_details": {"_timeout": "Operacao excedeu o tempo limite de 10 minutos"}}).eq(
                    "id", existing_log_id
                ).execute()
            else:
                db.table("copy_logs").update({"status": "error", "error_details": {"_timeout": "Operacao excedeu o tempo limite de 10 minutos"}}).eq(
                    "org_id", org_id
                ).eq("status", "in_progress").eq("source_item_id", item_id).execute()
        except Exception as db_err:
            logger.error("Failed to update timed-out dims logs: %s", db_err)
    except Exception as e:
        logger.error("Background copy_with_dims failed for item %s: %s", item_id, e, exc_info=True)
        try:
            db = get_db()
            if existing_log_id:
                db.table("copy_logs").update({"status": "error", "error_details": {"_error": str(e)}}).eq(
                    "id", existing_log_id
                ).execute()
        except Exception:
            pass


async def _bg_copy_with_dims_queued(
    source: str,
    destinations: list[str],
    item_id: str,
    dimensions: dict,
    user_id: str,
    org_id: str,
    existing_log_id: int | None,
    trial_info_present: bool,
) -> None:
    """Wrapper that enforces per-org concurrency queue before running _bg_copy_with_dims."""
    current = _org_queue_sizes.get(org_id, 0)
    if current >= MAX_QUEUE_PER_ORG:
        logger.warning(
            "Org %s already has %d task(s) running (max %d); rejecting dims task",
            org_id,
            current,
            MAX_QUEUE_PER_ORG,
        )
        try:
            db = get_db()
            if existing_log_id:
                db.table("copy_logs").update({
                    "status": "error",
                    "error_details": {"_queue": "Fila maxima atingida. Aguarde o termino das operacoes em andamento."},
                }).eq("id", existing_log_id).execute()
        except Exception as db_err:
            logger.error("Failed to update queue-full dims log: %s", db_err)
        return

    _org_queue_sizes[org_id] = current + 1
    try:
        await _bg_copy_with_dims(
            source=source,
            destinations=destinations,
            item_id=item_id,
            dimensions=dimensions,
            user_id=user_id,
            org_id=org_id,
            existing_log_id=existing_log_id,
            trial_info_present=trial_info_present,
        )
    finally:
        _org_queue_sizes[org_id] = max(0, _org_queue_sizes.get(org_id, 1) - 1)


async def _bg_retry_corrections(
    enriched_logs: list[tuple[dict, dict]],
    values: dict,
    user_id: str,
) -> None:
    """Background worker for retry_corrections — processes each log serially."""
    for log, details in enriched_logs:
        source = log["source_seller"]
        destinations = log["dest_sellers"] or []
        org_id = log["org_id"]
        db = get_db()

        try:
            if details.get("kind") == "dimensions":
                dims = _extract_retry_dimensions(values)
                if not dims:
                    logger.warning("retry_corrections: no dims provided for log %s", log["id"])
                    db.table("copy_logs").update({
                        "status": "error",
                        "error_details": {"_input": "Nenhuma dimensao informada"},
                    }).eq("id", log["id"]).execute()
                    continue
                results = await asyncio.wait_for(
                    copy_with_dimensions(
                        source_seller=source,
                        dest_sellers=destinations,
                        item_id=str(log["source_item_id"]),
                        dimensions=dims,
                        org_id=org_id,
                        user_id=user_id,
                    ),
                    timeout=BATCH_TIMEOUT_SECONDS,
                )
            else:
                attr_values = _extract_retry_attribute_values(values, details.get("fields", []))
                if not attr_values:
                    attr_ids = {str(f.get("id")) for f in details.get("fields", []) if isinstance(f, dict)}
                    if attr_ids == {"GTIN"}:
                        attr_values = {"EMPTY_GTIN_REASON": "No registrado"}
                    else:
                        logger.warning("retry_corrections: no attribute values for log %s", log["id"])
                        db.table("copy_logs").update({
                            "status": "error",
                            "error_details": {"_input": "Preencha os atributos obrigatorios antes de reenviar"},
                        }).eq("id", log["id"]).execute()
                        continue
                results = await asyncio.wait_for(
                    copy_with_attribute_corrections(
                        source_seller=source,
                        dest_sellers=destinations,
                        item_id=str(log["source_item_id"]),
                        values=attr_values,
                        org_id=org_id,
                        user_id=user_id,
                    ),
                    timeout=BATCH_TIMEOUT_SECONDS,
                )

            success_count, error_count, correction_count = _count_result_statuses(results)
            dest_item_ids = {r["dest_seller"]: r["dest_item_id"] for r in results if r["status"] == "success"}
            new_errors = {r["dest_seller"]: r["error"] for r in results if r["status"] != "success" and r.get("error")}
            new_status = _derive_log_status(results)
            source_item_sku = next((r.get("sku") for r in results if r.get("sku")), None)
            new_correction_details = next(
                (r.get("correction_details") for r in results if isinstance(r.get("correction_details"), dict)),
                None,
            )

            db.table("copy_logs").update({
                "status": new_status,
                "dest_item_ids": dest_item_ids or None,
                "error_details": new_errors or None,
                "correction_details": new_correction_details if new_status == CORRECTION_STATUS else None,
                "source_item_sku": source_item_sku,
            }).eq("id", log["id"]).eq("org_id", org_id).execute()

        except asyncio.TimeoutError:
            logger.error("retry_corrections timed out for log %s", log["id"])
            try:
                db.table("copy_logs").update({
                    "status": "error",
                    "error_details": {"_timeout": "Operacao excedeu o tempo limite de 10 minutos"},
                }).eq("id", log["id"]).execute()
            except Exception:
                pass
        except Exception as e:
            logger.error("retry_corrections failed for log %s: %s", log["id"], e, exc_info=True)
            try:
                db.table("copy_logs").update({
                    "status": "error",
                    "error_details": {"_error": str(e)},
                }).eq("id", log["id"]).execute()
            except Exception:
                pass


async def _bg_retry_corrections_queued(
    enriched_logs: list[tuple[dict, dict]],
    values: dict,
    user_id: str,
    org_id: str,
    log_ids: list[int],
) -> None:
    """Wrapper that enforces per-org concurrency queue before running _bg_retry_corrections."""
    current = _org_queue_sizes.get(org_id, 0)
    if current >= MAX_QUEUE_PER_ORG:
        logger.warning(
            "Org %s already has %d task(s) running (max %d); rejecting retry_corrections",
            org_id,
            current,
            MAX_QUEUE_PER_ORG,
        )
        try:
            db = get_db()
            for lid in log_ids:
                db.table("copy_logs").update({
                    "status": "error",
                    "error_details": {"_queue": "Fila maxima atingida. Aguarde o termino das operacoes em andamento."},
                }).eq("id", lid).execute()
        except Exception as db_err:
            logger.error("Failed to update queue-full correction logs: %s", db_err)
        return

    _org_queue_sizes[org_id] = current + 1
    try:
        await _bg_retry_corrections(
            enriched_logs=enriched_logs,
            values=values,
            user_id=user_id,
        )
    finally:
        _org_queue_sizes[org_id] = max(0, _org_queue_sizes.get(org_id, 1) - 1)


# ── Misc helpers ──────────────────────────────────────────────────────────────


async def _resolve_item_seller(item_id: str, org_id: str, skip_seller: str | None = None) -> tuple[str | None, dict | None]:
    """Try all connected sellers IN PARALLEL to find one that can fetch the item.

    Returns (seller_slug, item_data) from the first seller that succeeds, or (None, None).
    """
    db = get_db()
    sellers = db.table("copy_sellers").select("slug").eq("active", True).eq("org_id", org_id).execute()
    if not sellers.data:
        return None, None

    slugs = [r["slug"] for r in sellers.data if r["slug"] != skip_seller]
    if not slugs:
        return None, None

    async def _try(slug: str) -> tuple[str, dict]:
        item = await get_item(slug, item_id, org_id=org_id)
        return slug, item

    tasks = [asyncio.create_task(_try(s)) for s in slugs]

    # Return the first successful result, cancel the rest
    for coro in asyncio.as_completed(tasks):
        try:
            slug, item = await coro
            for t in tasks:
                if not t.done():
                    t.cancel()
                elif not t.cancelled():
                    # Suppress "Task exception was never retrieved" for
                    # tasks that already failed before we could cancel them
                    try:
                        t.result()
                    except Exception:
                        pass
            return slug, item
        except Exception:
            continue

    return None, None


def _check_seller_permission(user: dict, seller_slug: str, direction: str) -> bool:
    """Check if user has permission for a seller. direction: 'from' or 'to'."""
    if user["role"] == "admin":
        return True
    key = "can_copy_from" if direction == "from" else "can_copy_to"
    return any(
        p["seller_slug"] == seller_slug and p.get(key, False)
        for p in user.get("permissions", [])
    )


def _get_correction_details_for_log(log: dict) -> dict | None:
    details = log.get("correction_details")
    if isinstance(details, dict) and details:
        return details

    if log.get("status") in CORRECTION_PENDING_STATUSES and log.get("error_details"):
        values = log["error_details"].values() if isinstance(log["error_details"], dict) else []
        if any(
            isinstance(v, str) and ("dimenso" in v.lower() or "dimension" in v.lower() or "weight" in v.lower())
            for v in values
        ):
            return _build_dimension_correction_details()
    return None


def _count_result_statuses(results: list[dict]) -> tuple[int, int, int]:
    success_count = sum(1 for r in results if r["status"] == "success")
    error_count = sum(1 for r in results if r["status"] == "error")
    correction_count = sum(1 for r in results if r["status"] in CORRECTION_PENDING_STATUSES)
    return success_count, error_count, correction_count


def _derive_log_status(results: list[dict]) -> str:
    success_count, error_count, correction_count = _count_result_statuses(results)
    if correction_count > 0:
        return CORRECTION_STATUS
    if error_count == 0:
        return "success"
    if success_count > 0:
        return "partial"
    return "error"


def _extract_retry_dimensions(values: dict[str, str | float | int | bool | None]) -> dict[str, float]:
    dims: dict[str, float] = {}
    for key in ("height", "width", "length", "weight"):
        raw = values.get(key)
        if raw in (None, ""):
            continue
        dims[key] = float(raw)
    return dims


def _extract_retry_attribute_values(
    values: dict[str, str | float | int | bool | None],
    allowed_fields: list[dict],
) -> dict[str, str | float | int | bool]:
    allowed_ids = {str(field.get("id")) for field in allowed_fields if isinstance(field, dict) and field.get("id")}
    cleaned: dict[str, str | float | int | bool] = {}
    for key, raw in values.items():
        if key not in allowed_ids or raw in (None, ""):
            continue
        cleaned[key] = raw
    return cleaned


# ── Request models ────────────────────────────────────────────────────────────


class CopyRequest(BaseModel):
    source: str
    destinations: list[str]
    item_ids: list[str]


class Dimensions(BaseModel):
    height: float | None = None
    width: float | None = None
    length: float | None = None
    weight: float | None = None


class CopyWithDimensionsRequest(BaseModel):
    source: str
    destinations: list[str]
    item_id: str
    dimensions: Dimensions


class RetryCorrectionsRequest(BaseModel):
    log_ids: list[int]
    values: dict[str, str | float | int | bool | None]


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("")
async def copy_anuncios(req: CopyRequest, bg: BackgroundTasks, user: dict = Depends(require_active_org)):
    """Copy listings from source seller to destination seller(s). Returns immediately."""
    if not req.source:
        raise HTTPException(status_code=400, detail="source is required")
    if not req.destinations:
        raise HTTPException(status_code=400, detail="At least one destination is required")
    if not req.item_ids:
        raise HTTPException(status_code=400, detail="At least one item_id is required")
    if req.source in req.destinations:
        raise HTTPException(status_code=400, detail="Source cannot be in destinations")

    # Permission checks (admins bypass)
    if not _check_seller_permission(user, req.source, "from"):
        raise HTTPException(status_code=403, detail=f"Sem permissão de origem para o seller '{req.source}'")
    denied_dests = [d for d in req.destinations if not _check_seller_permission(user, d, "to")]
    if denied_dests:
        raise HTTPException(status_code=403, detail=f"Sem permissão de destino para o(s) seller(s): {', '.join(denied_dests)}")

    # Clean item_ids (support comma-separated and newline-separated)
    clean_ids = []
    for raw in req.item_ids:
        for part in raw.replace(",", "\n").split("\n"):
            part = part.strip()
            if part:
                clean_ids.append(part)

    clean_ids = list(dict.fromkeys(clean_ids))

    if not clean_ids:
        raise HTTPException(status_code=400, detail="No valid item IDs provided")

    org_id = user["org_id"]

    # Reject early if queue is already full
    if _org_queue_sizes.get(org_id, 0) >= MAX_QUEUE_PER_ORG:
        raise HTTPException(
            status_code=429,
            detail=f"Fila cheia ({MAX_QUEUE_PER_ORG} operacoes em andamento). Aguarde o termino antes de enviar mais.",
        )

    # Check trial limits for unpaid orgs
    trial_info = _check_trial_limit(org_id, len(clean_ids))
    if trial_info and not trial_info["allowed"]:
        raise HTTPException(status_code=402, detail=trial_info["message"])

    # Reserve trial copies upfront (refund failures after background task completes)
    trial_reserved = len(clean_ids) if trial_info else 0
    if trial_reserved > 0:
        _increment_trial_copies(org_id, trial_reserved)

    bg.add_task(
        _bg_copy_items_queued,
        source=req.source,
        destinations=req.destinations,
        item_ids=clean_ids,
        user_id=user["id"],
        org_id=org_id,
        trial_reserved=trial_reserved,
    )

    return {
        "status": "queued",
        "total": len(clean_ids),
        "message": f"{len(clean_ids)} item(s) enfileirado(s). Acompanhe o progresso no historico.",
    }


@router.post("/with-dimensions")
async def copy_with_dims(req: CopyWithDimensionsRequest, bg: BackgroundTasks, user: dict = Depends(require_active_org)):
    """Apply dimensions to source item, then copy to destinations. Returns immediately."""
    dims = req.dimensions.model_dump(exclude_none=True)
    if not dims:
        raise HTTPException(status_code=400, detail="At least one dimension is required")

    # Permission checks (admins bypass)
    if not _check_seller_permission(user, req.source, "from"):
        raise HTTPException(status_code=403, detail=f"Sem permissão de origem para o seller '{req.source}'")
    denied_dests = [d for d in req.destinations if not _check_seller_permission(user, d, "to")]
    if denied_dests:
        raise HTTPException(status_code=403, detail=f"Sem permissão de destino para o(s) seller(s): {', '.join(denied_dests)}")

    org_id = user["org_id"]
    item_id = req.item_id.strip()

    # Reject early if queue is already full
    if _org_queue_sizes.get(org_id, 0) >= MAX_QUEUE_PER_ORG:
        raise HTTPException(
            status_code=429,
            detail=f"Fila cheia ({MAX_QUEUE_PER_ORG} operacoes em andamento). Aguarde o termino antes de enviar mais.",
        )

    # Check trial limits for unpaid orgs
    trial_info = _check_trial_limit(org_id, 1)
    if trial_info and not trial_info["allowed"]:
        raise HTTPException(status_code=402, detail=trial_info["message"])

    bg.add_task(
        _bg_copy_with_dims_queued,
        source=req.source,
        destinations=req.destinations,
        item_id=item_id,
        dimensions=dims,
        user_id=user["id"],
        org_id=org_id,
        existing_log_id=None,
        trial_info_present=bool(trial_info),
    )

    return {
        "status": "queued",
        "item_id": item_id,
        "message": "Copia com dimensoes enfileirada. Acompanhe o progresso no historico.",
    }


class RetryDimensionsRequest(BaseModel):
    log_id: int
    dimensions: Dimensions


@router.post("/retry-dimensions")
async def retry_dimensions(req: RetryDimensionsRequest, bg: BackgroundTasks, user: dict = Depends(require_active_org)):
    """Retry a dimension-failed copy from the logs history. Returns immediately."""
    db = get_db()

    # 1. Fetch the original log entry (scoped by org)
    log_query = db.table("copy_logs").select("*").eq("id", req.log_id)
    if not user.get("is_super_admin"):
        log_query = log_query.eq("org_id", user["org_id"])
    log_result = log_query.execute()
    if not log_result.data:
        raise HTTPException(status_code=404, detail="Log nao encontrado")
    log = log_result.data[0]
    org_id = log["org_id"]

    # 2. Verify it's a dimension error (new status or old error with dimension message)
    correction_details = _get_correction_details_for_log(log)
    is_dim_error = bool(correction_details and correction_details.get("kind") == "dimensions")
    if not is_dim_error and log["status"] == "error" and log.get("error_details"):
        details = log["error_details"]
        if isinstance(details, dict):
            is_dim_error = any(
                isinstance(v, str) and ("dimenso" in v.lower() or "dimension" in v.lower())
                for v in details.values()
            )
    if not is_dim_error:
        raise HTTPException(status_code=400, detail="Este log nao e um erro de dimensoes")

    # 3. Permission checks
    source = log["source_seller"]
    destinations = log["dest_sellers"]
    if not _check_seller_permission(user, source, "from"):
        raise HTTPException(status_code=403, detail=f"Sem permissao de origem para '{source}'")
    denied = [d for d in destinations if not _check_seller_permission(user, d, "to")]
    if denied:
        raise HTTPException(status_code=403, detail=f"Sem permissao de destino para: {', '.join(denied)}")

    dims = req.dimensions.model_dump(exclude_none=True)
    if not dims:
        raise HTTPException(status_code=400, detail="Pelo menos uma dimensao e necessaria")

    # Reject early if queue is already full
    if _org_queue_sizes.get(org_id, 0) >= MAX_QUEUE_PER_ORG:
        raise HTTPException(
            status_code=429,
            detail=f"Fila cheia ({MAX_QUEUE_PER_ORG} operacoes em andamento). Aguarde o termino antes de enviar mais.",
        )

    # Mark log as in_progress so frontend polling shows activity
    try:
        db.table("copy_logs").update({"status": "in_progress"}).eq("id", req.log_id).execute()
    except Exception as e:
        logger.warning("Could not mark log %s as in_progress: %s", req.log_id, e)

    bg.add_task(
        _bg_copy_with_dims_queued,
        source=source,
        destinations=destinations,
        item_id=str(log["source_item_id"]),
        dimensions=dims,
        user_id=user["id"],
        org_id=org_id,
        existing_log_id=req.log_id,
        trial_info_present=False,
    )

    return {
        "status": "queued",
        "log_id": req.log_id,
        "message": "Retry de dimensoes enfileirado. Acompanhe o progresso no historico.",
    }


class RetryRequest(BaseModel):
    log_id: int


@router.post("/retry")
async def retry_copy(req: RetryRequest, bg: BackgroundTasks, user: dict = Depends(require_active_org)):
    """Re-run a failed copy log. Simply re-queues the same copy operation."""
    db = get_db()
    query = db.table("copy_logs").select("*").eq("id", req.log_id)
    if not user.get("is_super_admin"):
        query = query.eq("org_id", user["org_id"])
    row = query.execute().data
    if not row:
        raise HTTPException(status_code=404, detail="Log nao encontrado")
    log = row[0]

    if log["status"] not in ("error", "partial", "needs_correction"):
        raise HTTPException(status_code=400, detail="Apenas logs com erro podem ser reenviados")

    source = log["source_seller"]
    destinations = log["dest_sellers"] or []
    item_id = str(log["source_item_id"])
    org_id = log["org_id"]

    if not _check_seller_permission(user, source, "from"):
        raise HTTPException(status_code=403, detail=f"Sem permissao de origem para '{source}'")
    denied = [d for d in destinations if not _check_seller_permission(user, d, "to")]
    if denied:
        raise HTTPException(status_code=403, detail=f"Sem permissao de destino para: {', '.join(denied)}")

    # Delete the old log — copy_items will create a fresh one
    db.table("copy_logs").delete().eq("id", log["id"]).execute()

    async def _bg_retry():
        try:
            await asyncio.wait_for(
                copy_items(
                    source_seller=source,
                    dest_sellers=destinations,
                    item_ids=[item_id],
                    user_id=user["id"],
                    org_id=org_id,
                ),
                timeout=BATCH_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            logger.error("Retry copy timed out for log %s", log["id"])
        except Exception as e:
            logger.error("Retry copy failed for log %s: %s", log["id"], e, exc_info=True)

    bg.add_task(_bg_retry)

    return {"status": "queued", "log_id": log["id"], "message": "Copia reenviada. Acompanhe no historico."}


@router.post("/retry-corrections")
async def retry_corrections(req: RetryCorrectionsRequest, bg: BackgroundTasks, user: dict = Depends(require_active_org)):
    """Retry one or more pending-correction logs using the same correction values. Returns immediately."""
    clean_log_ids = list(dict.fromkeys(log_id for log_id in req.log_ids if log_id))
    if not clean_log_ids:
        raise HTTPException(status_code=400, detail="Informe pelo menos um log para reprocessar")

    db = get_db()
    log_query = db.table("copy_logs").select("*")
    if not user.get("is_super_admin"):
        log_query = log_query.eq("org_id", user["org_id"])
    log_rows = log_query.execute().data or []
    logs = [row for row in log_rows if row.get("id") in clean_log_ids]
    if len(logs) != len(clean_log_ids):
        raise HTTPException(status_code=404, detail="Um ou mais logs nao foram encontrados")

    enriched_logs: list[tuple[dict, dict]] = []
    group_keys: set[str] = set()
    for log in logs:
        details = _get_correction_details_for_log(log)
        if not details:
            raise HTTPException(status_code=400, detail=f"Log {log['id']} nao esta aguardando correcao")
        group_key = str(details.get("group_key") or "")
        if not group_key:
            raise HTTPException(status_code=400, detail=f"Log {log['id']} nao possui metadados de correcao")
        group_keys.add(group_key)
        enriched_logs.append((log, details))

    if len(group_keys) != 1:
        raise HTTPException(status_code=400, detail="Selecione apenas logs com o mesmo problema para corrigir em lote")

    # All logs belong to the same org (validated above via org_id filter)
    org_id = logs[0]["org_id"]

    # Reject early if queue is already full
    if _org_queue_sizes.get(org_id, 0) >= MAX_QUEUE_PER_ORG:
        raise HTTPException(
            status_code=429,
            detail=f"Fila cheia ({MAX_QUEUE_PER_ORG} operacoes em andamento). Aguarde o termino antes de enviar mais.",
        )

    # Validate inputs synchronously before enqueuing so we can return 400 errors immediately
    first_details = enriched_logs[0][1]
    if first_details.get("kind") == "dimensions":
        dims_check = _extract_retry_dimensions(req.values)
        if not dims_check:
            raise HTTPException(status_code=400, detail="Informe pelo menos uma dimensao")
    else:
        values_check = _extract_retry_attribute_values(req.values, first_details.get("fields", []))
        if not values_check:
            attr_ids = {str(f.get("id")) for f in first_details.get("fields", []) if isinstance(f, dict)}
            if attr_ids != {"GTIN"}:
                raise HTTPException(status_code=400, detail="Preencha os atributos obrigatorios antes de reenviar")

    # Permission checks synchronously
    for log, _ in enriched_logs:
        source = log["source_seller"]
        destinations = log["dest_sellers"] or []
        if not _check_seller_permission(user, source, "from"):
            raise HTTPException(status_code=403, detail=f"Sem permissao de origem para '{source}'")
        denied = [d for d in destinations if not _check_seller_permission(user, d, "to")]
        if denied:
            raise HTTPException(status_code=403, detail=f"Sem permissao de destino para: {', '.join(denied)}")

    # Mark all logs as in_progress immediately so the frontend polling sees activity
    for log, _ in enriched_logs:
        try:
            db.table("copy_logs").update({"status": "in_progress"}).eq("id", log["id"]).execute()
        except Exception as e:
            logger.warning("Could not mark log %s as in_progress: %s", log["id"], e)

    bg.add_task(
        _bg_retry_corrections_queued,
        enriched_logs=enriched_logs,
        values=dict(req.values),
        user_id=user["id"],
        org_id=org_id,
        log_ids=clean_log_ids,
    )

    return {
        "status": "queued",
        "log_ids": clean_log_ids,
        "total_logs": len(enriched_logs),
        "message": f"{len(enriched_logs)} log(s) enfileirado(s) para reprocessamento. Acompanhe o progresso no historico.",
    }


@router.get("/queue-status")
async def get_queue_status(user: dict = Depends(require_user)):
    """Return the current background-task queue size for the user's org."""
    org_id = user["org_id"]
    return {
        "org_id": org_id,
        "active_tasks": _org_queue_sizes.get(org_id, 0),
        "max_tasks": MAX_QUEUE_PER_ORG,
    }


@router.get("/logs")
async def copy_logs(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None),
    user: dict = Depends(require_active_org),
):
    """Get copy history. Operators see only their own logs; admins see all."""
    db = get_db()
    query = db.table("copy_logs").select("*, users(username)").order(
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


@router.get("/preview/{item_id}")
async def preview_item(item_id: str, seller: str = Query(...), user: dict = Depends(require_active_org)):
    """Preview an item before copying. Auto-detects owner seller on 403."""
    org_id = user["org_id"]
    try:
        item = await get_item(seller, item_id, org_id=org_id)
    except Exception as first_err:
        # First seller failed — try all other connected sellers
        resolved_seller, resolved_item = await _resolve_item_seller(item_id, org_id=org_id, skip_seller=seller)
        if resolved_seller and resolved_item:
            seller = resolved_seller
            item = resolved_item
        else:
            raise HTTPException(status_code=404, detail=f"Item not found: {first_err}")

    # Fetch description
    description = ""
    try:
        desc_data = await get_item_description(seller, item_id, org_id=org_id)
        description = desc_data.get("plain_text", "")
    except Exception:
        pass

    # Check compatibilities
    has_compatibilities = False
    try:
        compat = await get_item_compatibilities(seller, item_id, org_id=org_id)
        has_compatibilities = compat is not None and bool(compat)
    except Exception:
        pass

    return {
        "id": item.get("id"),
        "title": item.get("title"),
        "price": item.get("price"),
        "currency_id": item.get("currency_id"),
        "available_quantity": item.get("available_quantity"),
        "sold_quantity": item.get("sold_quantity"),
        "category_id": item.get("category_id"),
        "listing_type_id": item.get("listing_type_id"),
        "condition": item.get("condition"),
        "status": item.get("status"),
        "thumbnail": item.get("secure_thumbnail") or item.get("thumbnail"),
        "permalink": item.get("permalink"),
        "pictures_count": len(item.get("pictures", [])),
        "variations_count": len(item.get("variations", [])),
        "attributes_count": len(item.get("attributes", [])),
        "has_compatibilities": has_compatibilities,
        "description_length": len(description),
        "channels": item.get("channels", []),
        "seller": seller,
    }


def _normalize_item_id(raw: str) -> str:
    """Normalize an item ID to MLB format."""
    clean = raw.strip()
    m = re.match(r"MLB[-]?(\d+)", clean, re.IGNORECASE)
    if m:
        return f"MLB{m.group(1)}"
    if clean.isdigit():
        return f"MLB{clean}"
    return clean


async def _resolve_items_sellers(item_ids: list[str], org_id: str) -> dict[str, str]:
    """Resolve source seller for multiple items in parallel.

    Uses a semaphore to limit concurrency and avoid flooding the ML API.
    Returns {item_id: seller_slug} for items that were found.
    """
    sem = asyncio.Semaphore(5)

    async def _resolve_one(item_id: str) -> tuple[str, str | None]:
        async with sem:
            slug, _ = await _resolve_item_seller(item_id, org_id=org_id)
            return item_id, slug

    tasks = await asyncio.gather(
        *[_resolve_one(iid) for iid in item_ids],
        return_exceptions=True,
    )

    result: dict[str, str] = {}
    for t in tasks:
        if isinstance(t, Exception):
            continue
        item_id, slug = t
        if slug:
            result[item_id] = slug
    return result


class ResolveSellersRequest(BaseModel):
    item_ids: list[str]


@router.post("/resolve-sellers")
async def resolve_sellers_endpoint(req: ResolveSellersRequest, user: dict = Depends(require_active_org)):
    """Bulk-resolve which seller owns each item."""
    clean_ids = list(dict.fromkeys(_normalize_item_id(iid) for iid in req.item_ids if iid.strip()))
    if not clean_ids:
        return {"results": [], "errors": []}

    org_id = user["org_id"]
    resolved = await _resolve_items_sellers(clean_ids, org_id=org_id)

    results = []
    errors = []
    for iid in clean_ids:
        if iid in resolved:
            seller_slug = resolved[iid]
            # For non-admin users, check can_copy_from permission
            if not _check_seller_permission(user, seller_slug, "from"):
                errors.append({"item_id": iid, "error": "Sem permissao para este seller"})
            else:
                results.append({"item_id": iid, "seller_slug": seller_slug})
        else:
            errors.append({"item_id": iid, "error": "Item nao encontrado em nenhum seller conectado"})

    return {"results": results, "errors": errors}
