"""
Billing router — Stripe subscription management.
"""
import logging
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.config import settings
from app.db.supabase import get_db
from app.routers.auth import require_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/billing", tags=["billing"])


def _require_stripe():
    """Raise 503 if Stripe is not configured."""
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Billing not configured")
    stripe.api_key = settings.stripe_secret_key


# ---------- create-checkout ----------

@router.post("/create-checkout")
async def create_checkout(user: dict = Depends(require_user)):
    """Create a Stripe Checkout Session for subscription."""
    _require_stripe()

    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")

    db = get_db()
    org_id = user["org_id"]
    org_result = db.table("orgs").select("*").eq("id", org_id).single().execute()
    if not org_result.data:
        raise HTTPException(status_code=404, detail="Organizacao nao encontrada")

    org = org_result.data
    stripe_customer_id = org.get("stripe_customer_id")

    # Create Stripe customer if needed
    if not stripe_customer_id:
        customer = stripe.Customer.create(
            email=org["email"],
            name=org["name"],
            metadata={"org_id": str(org_id)},
        )
        stripe_customer_id = customer.id
        db.table("orgs").update(
            {"stripe_customer_id": stripe_customer_id}
        ).eq("id", org_id).execute()

    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": settings.stripe_price_id, "quantity": 1}],
        customer=stripe_customer_id,
        success_url=f"{settings.base_url}?billing=success",
        cancel_url=f"{settings.base_url}?billing=cancel",
        client_reference_id=str(org_id),
    )

    return {"checkout_url": session.url}


# ---------- create-portal ----------

@router.post("/create-portal")
async def create_portal(user: dict = Depends(require_user)):
    """Create a Stripe Customer Portal session."""
    _require_stripe()

    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Acesso restrito a administradores")

    db = get_db()
    org_id = user["org_id"]
    org_result = db.table("orgs").select("stripe_customer_id").eq("id", org_id).single().execute()
    if not org_result.data:
        raise HTTPException(status_code=404, detail="Organizacao nao encontrada")

    stripe_customer_id = org_result.data.get("stripe_customer_id")
    if not stripe_customer_id:
        raise HTTPException(status_code=400, detail="Nenhuma assinatura encontrada")

    portal_session = stripe.billing_portal.Session.create(
        customer=stripe_customer_id,
        return_url=settings.base_url,
    )

    return {"portal_url": portal_session.url}


# ---------- webhook ----------

@router.post("/webhook")
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events."""
    _require_stripe()

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.stripe_webhook_secret
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    db = get_db()
    event_type = event["type"]

    if event_type == "checkout.session.completed":
        session = event["data"]["object"]
        org_id = session.get("client_reference_id")
        subscription_id = session.get("subscription")
        customer_id = session.get("customer")

        if org_id:
            updates = {"payment_active": True}
            if subscription_id:
                updates["stripe_subscription_id"] = subscription_id
            if customer_id:
                updates["stripe_customer_id"] = customer_id
            db.table("orgs").update(updates).eq("id", org_id).execute()
            logger.info("Checkout completed for org %s, subscription %s", org_id, subscription_id)

    elif event_type == "customer.subscription.deleted":
        subscription = event["data"]["object"]
        customer_id = subscription.get("customer")
        if customer_id:
            db.table("orgs").update(
                {"payment_active": False, "stripe_subscription_id": None}
            ).eq("stripe_customer_id", customer_id).execute()
            logger.info("Subscription deleted for customer %s", customer_id)

    elif event_type == "customer.subscription.updated":
        subscription = event["data"]["object"]
        customer_id = subscription.get("customer")
        status = subscription.get("status")
        if customer_id and status:
            active = status in ("active", "trialing")
            db.table("orgs").update(
                {"payment_active": active}
            ).eq("stripe_customer_id", customer_id).execute()
            logger.info("Subscription updated for customer %s, status=%s", customer_id, status)

    return {"received": True}


# ---------- status ----------

@router.get("/status")
async def billing_status(user: dict = Depends(require_user)):
    """Return billing status for the current user's org."""
    _require_stripe()

    db = get_db()
    org_result = db.table("orgs").select(
        "payment_active, stripe_subscription_id"
    ).eq("id", user["org_id"]).single().execute()

    if not org_result.data:
        raise HTTPException(status_code=404, detail="Organizacao nao encontrada")

    return {
        "payment_active": org_result.data["payment_active"],
        "stripe_subscription_id": org_result.data.get("stripe_subscription_id"),
    }
