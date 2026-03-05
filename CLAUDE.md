# Copy Anuncios ML

Plataforma multi-tenant (SaaS) para copiar anúncios e compatibilidades veiculares entre contas do Mercado Livre.

## Documentação Completa da API

**Referência detalhada:** [`docs/API.md`](docs/API.md) — documentação minuciosa de todos os endpoints, schemas, fluxos e erros.

## Tech Stack

- **Backend**: FastAPI (Python 3.11) + Uvicorn
- **Frontend**: React 19 + TypeScript + Vite
- **Database**: Supabase (PostgreSQL) com service_role key (bypass RLS)
- **HTTP Client**: httpx (async)
- **Auth**: bcrypt (senhas) + session tokens (7 dias TTL)
- **Billing**: Stripe (checkout, portal, webhooks)
- **Deploy**: Docker multi-stage (Node build → Python runtime) no Easypanel

## Project Structure

```
app/
├── main.py              # FastAPI init, CORS, routers, SPA serving
├── config.py            # Pydantic Settings (env vars)
├── db/
│   ├── supabase.py      # Supabase client singleton (get_db())
│   └── migrations/      # SQL migrations (001-009)
├── routers/
│   ├── auth.py          # Login/signup/logout/me/admin-promote + require_user/require_admin/require_super_admin/require_active_org deps
│   ├── auth_ml.py       # OAuth2 ML (install → callback → token exchange)
│   ├── billing.py       # Stripe checkout, portal, webhook, status
│   ├── copy.py          # POST /api/copy, /api/copy/with-dimensions, GET /api/copy/logs
│   ├── compat.py        # POST /api/compat/copy, /search-sku, GET /api/compat/logs
│   ├── admin_users.py   # CRUD users + permissions (admin only)
│   └── super_admin.py   # Platform-wide org management (super_admin only)
└── services/
    ├── ml_api.py         # MercadoLivre API client (token mgmt, error handling)
    ├── item_copier.py    # Core copy logic (~850 lines, retry, payload transform)
    ├── compat_copier.py  # Compatibility copy orchestration (background tasks)
    └── email.py          # SMTP email service (password reset emails)

frontend/
├── src/
│   ├── App.tsx           # Router + layout (tabs: Copy, Compat, Admin)
│   ├── pages/            # CopyPage, CompatPage, Admin, UsersPage, Login
│   ├── components/       # Reusable UI components
│   ├── hooks/useAuth.ts  # Auth state + methods (token in localStorage)
│   └── lib/api.ts        # API types + constants
└── dist/                 # Built SPA (mounted by FastAPI at /)

docs/
└── API.md               # Documentação completa da API (referência definitiva)
```

## Running Locally

```bash
# Backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend
cd frontend && npm install && npm run dev

# Docker
docker build -t copy-anuncios . && docker run -p 8000:8000 --env-file .env copy-anuncios
```

## Environment Variables

```
ML_APP_ID              # OAuth app ID (ML Dev Center)
ML_SECRET_KEY          # OAuth app secret
ML_REDIRECT_URI        # OAuth callback (https://copy.levermoney.com.br/api/ml/callback)
SUPABASE_URL           # Supabase project URL
SUPABASE_SERVICE_ROLE_KEY  # Service role key (REQUIRED — bypasses RLS)
SUPABASE_KEY           # Supabase anon key (alternative)
ADMIN_MASTER_PASSWORD  # One-time admin setup password
STRIPE_SECRET_KEY      # Stripe API secret key
STRIPE_WEBHOOK_SECRET  # Stripe webhook signing secret
STRIPE_PRICE_ID        # Stripe subscription price ID
BASE_URL               # Public URL for OAuth redirects (default: http://localhost:8000)
CORS_ORIGINS           # Comma-separated allowed origins (default: http://localhost:5173,http://localhost:3000)
SMTP_HOST              # SMTP server host (optional — for password reset emails)
SMTP_PORT              # SMTP server port (default: 587)
SMTP_USER              # SMTP username
SMTP_PASSWORD          # SMTP password
SMTP_FROM              # From address for emails (falls back to SMTP_USER)
```

## Database Schema (Supabase)

**Project:** parts-catalogs (ID: `wrbrbhuhsaaupqsimkqz`, region: sa-east-1)

**Multi-tenant:**
- `orgs` — id, name, email, active, payment_active, stripe_customer_id, stripe_subscription_id, created_at, updated_at

**Auth:**
- `users` — id, email, username, password_hash, role (admin|operator), is_super_admin, can_run_compat, active, org_id (FK→orgs), last_login_at
- `user_sessions` — token (32-byte URL-safe), user_id, expires_at (7 days)
- `user_permissions` — user_id + seller_slug → can_copy_from, can_copy_to
- `auth_logs` — user_id, username, org_id, action (login|logout|login_failed|signup|admin_promote)

**Operations:**
- `copy_sellers` — slug, ml_user_id, ml_access_token, ml_refresh_token, ml_token_expires_at, org_id (FK→orgs), active
- `copy_logs` — user_id, org_id, source_seller, dest_sellers[], source_item_id, status
- `compat_logs` — user_id, org_id, source_item_id, skus[], targets (JSONB), success/error counts, status

**Debug:**
- `api_debug_logs` — full request/response for failed ML API calls (payload JSONB, resolved flag)

Migrations: `app/db/migrations/001_compat_logs.sql` through `008_backfill_org_data.sql`

## Authentication & Authorization

**Auth flow:**
1. POST `/api/auth/signup` → create org + admin user → session token (self-service onboarding)
2. POST `/api/auth/login` → bcrypt verify → session token via `X-Auth-Token` header
3. `require_user()` dependency validates token on every protected route
4. `require_admin()` extends require_user with role check
5. `require_super_admin()` extends require_user with is_super_admin check
6. `require_active_org()` extends require_user + verifies org is active (super_admins bypass)
7. First admin created via POST `/api/auth/admin-promote` with ADMIN_MASTER_PASSWORD

**RBAC:**
- `super_admin` — platform-wide access, manages all orgs, bypasses org checks
- `admin` — full access within own org, manages users and permissions, manages billing
- `operator` — access filtered by per-seller permissions (can_copy_from, can_copy_to)
- `can_run_compat` — boolean flag on user for compatibility features

**MercadoLivre OAuth2:**
- GET `/api/ml/install` → redirect to ML auth
- GET `/api/ml/callback` → exchange code for token → store in `copy_sellers`
- Token auto-refresh on expiry via `_get_token()` in ml_api.py

## API Routes

```
# Auth
POST   /api/auth/signup             # Self-service signup (creates org + admin user)
POST   /api/auth/login              # Login (email/username + password)
POST   /api/auth/logout             # Invalidate session
GET    /api/auth/me                 # Current user + permissions + org context
POST   /api/auth/admin-promote      # First admin setup (master password)

# MercadoLivre OAuth
GET    /api/ml/install              # OAuth2 redirect to ML
GET    /api/ml/callback             # OAuth2 callback

# Sellers
GET    /api/sellers                 # List connected ML sellers (org-scoped)
DELETE /api/sellers/{slug}          # Disconnect seller

# Copy
POST   /api/copy                   # Bulk copy listings
POST   /api/copy/with-dimensions   # Copy with custom dimensions
GET    /api/copy/preview/{item_id} # Preview item before copy
GET    /api/copy/logs              # Copy history (org-scoped)

# Compatibility
POST   /api/compat/copy            # Copy vehicle compatibilities
POST   /api/compat/search-sku      # Find items by SKU across sellers
GET    /api/compat/preview/{id}    # Preview compatibility info
GET    /api/compat/logs            # Compat history (org-scoped)

# Admin (org-scoped)
GET    /api/admin/users            # List users (admin)
POST   /api/admin/users            # Create user (admin)
PUT    /api/admin/users/{id}       # Update user (admin)
DELETE /api/admin/users/{id}       # Delete user (admin)
GET    /api/admin/users/{id}/permissions
PUT    /api/admin/users/{id}/permissions

# Billing (Stripe)
POST   /api/billing/create-checkout  # Create Stripe Checkout session (admin)
POST   /api/billing/create-portal    # Create Stripe Customer Portal (admin)
POST   /api/billing/webhook          # Stripe webhook handler (public)
GET    /api/billing/status           # Billing status for current org

# Super Admin (platform-wide)
GET    /api/super/orgs              # List all orgs with usage stats
PUT    /api/super/orgs/{org_id}     # Toggle org active/payment status

# System
GET    /api/health                  # Health check
GET    /api/debug/env               # Check env vars (super_admin only, values masked)
```

## MercadoLivre API Patterns

**Base URL:** `https://api.mercadolibre.com`

**Token management:** Per-seller tokens in `copy_sellers` table, auto-refresh on expiry.

**Key quirks (IMPORTANT):**

1. **Brand accounts (official stores):**
   - Require `family_name` field instead of/alongside `title`
   - Require `official_store_id` — fetch from seller's existing item, NOT from `/users/me`
   - Use `free_shipping: true` when official_store_id errors occur

2. **Payload building** (`_build_item_payload` in item_copier.py):
   - **Include:** category_id, price, currency_id, available_quantity, buying_mode, condition, title, family_name, pictures, attributes, sale_terms, shipping, variations, channels, seller_custom_field
   - **Exclude:** id, seller_id, date_created, sold_quantity, status, permalink, health, GTIN, package dimensions
   - **Pictures:** Use `secure_url`/`url` from source (NOT picture IDs — those fail cross-account)
   - **Shipping:** Always use `mode: "me2"`, set `free_shipping: false`
   - **Attributes:** Filter out read-only (ITEM_CONDITION, GTIN, etc.)

3. **SKU extraction order:** item `seller_custom_field` → item attributes (SELLER_SKU) → variation-level fields

4. **Compatibility API:** Two endpoints:
   - `/items/{id}/compatibilities` (regular items)
   - `/user-products/{id}/compatibilities` (brand accounts, fallback on 400/403)

5. **Rate limiting:** Exponential backoff on 429 (3s base, doubles, max 5 retries). 1-second pacing between compat calls.

## Error Handling Patterns

**MlApiError** — custom exception with status_code, method, url, detail, payload.

**Auto-retry logic** (item_copier.py, up to 4 attempts):
- Title invalid → remove title, use family_name
- family_name invalid → fall back to title
- official_store_id required → fetch from seller's existing item
- Dimensions missing → return error asking user to provide dimensions
- Generic field errors → strip offending fields and retry

**Debug logging:** Every failed API call logged to `api_debug_logs` with full request/response.

## Frontend Patterns

- Auth state in `useAuth()` hook, token in localStorage, sent via `X-Auth-Token` header
- Tab-based UI: Copy | Compat | Admin (admin-only)
- Polling: frontend polls logs every 5 seconds while operations are in-progress
- CSS variables design system (--ink, --paper, --surface, etc.)
- Permission-aware: dropdowns filtered by user's can_copy_from / can_copy_to

## Coding Conventions

- Python: async FastAPI handlers, sync Supabase calls via `get_db()`
- Routers: `APIRouter(prefix="/api/...", tags=[...])` with Pydantic request models
- Dependencies: `Depends(require_user)` / `Depends(require_admin)` / `Depends(require_super_admin)` / `Depends(require_active_org)` for auth
- Logging: `logger = logging.getLogger(__name__)` per module
- Error messages in Portuguese (user-facing), English (logs/code)
- No test suite — relies on manual testing + PRD acceptance criteria
- Frontend: TypeScript strict, React 19, Vite, no state management library

## Error Debugging Playbook

When the user reports an error, follow this exact sequence:

### Step 1 — Check error-history.yaml first
Read `error-history.yaml` → search `ml_error_codes` for the error code. If it's a known error, the fix is already documented. Skip to Step 5.

### Step 2 — Query api_debug_logs (Supabase)
```sql
SELECT id, source_item_id, dest_seller, attempt_number, error_message,
       response_body::text
FROM api_debug_logs
WHERE resolved = false
ORDER BY id DESC LIMIT 10;
```
This gives the **exact ML API response** with `cause[]` array. Each cause has `type: "error"` (blocking) or `type: "warning"` (ignore). **Only focus on type="error" entries.**

### Step 3 — Check the request payload
```sql
SELECT id, attempt_number, request_payload->'shipping' as shipping,
       request_payload->'attributes' as attrs
FROM api_debug_logs WHERE source_item_id = 'MLBxxxxxx' ORDER BY id;
```
Compare what we SENT vs what ML REJECTED. The payload shows the exact field causing the error.

### Step 4 — Trace the code path
The error almost always originates in one of these:
- **`_build_item_payload()`** (line ~451) — payload construction, attribute filtering, shipping config
- **`_adjust_payload_for_ml_error()`** (line ~364) — retry adjustments
- **`copy_single_item()` retry loop** (line ~657) — retry logic, safe_mode rebuild
- **Shipping block** (line ~536) — mode, local_pick_up, free_shipping
- **EXCLUDED_ATTRIBUTES set** (line ~86) — which attributes are filtered out

### Step 5 — Fix, document, deploy
1. Apply the fix in the code
2. Add entry to `error-history.yaml` (next ERR-XXX id + ml_error_codes if new code)
3. Commit and push

### Key principles learned:
- **ML response `cause[]` mixes errors and warnings** — always check `type` field, ignore warnings
- **ML error messages are inconsistent** — some use [brackets], some don't. Need multiple detection methods
- **Retry rebuilds lose state** — when safe_mode rebuilds payload, carry over discovered fields (official_store_id)
- **seller-specific fields can't be copied** — official_store_id, local_pick_up, shipping mode are per-seller
- **User Products vs Regular Items** — different schemas, different endpoints, different SKU handling
- **Check both the field AND the attribute** — ML stores data in two places (e.g., seller_custom_field vs SELLER_SKU attribute)
- **Query the actual item via ML API** when the error is unclear — compare source vs dest item fields

## Error History (MANDATORY)

**File:** `error-history.yaml` — Structured knowledge base of all errors and corrections.

**RULE: Every time you fix a bug or handle a new ML API error, you MUST:**
1. Add a new entry to `error-history.yaml` under `error_history` with the next ERR-XXX id
2. If it involves a new ML error code, add it to `ml_error_codes`
3. If it reveals a new pattern, update the `patterns` section
4. Update `unresolved` section if applicable (add new or mark as fixed)
5. Update this CLAUDE.md if the fix changes any documented behavior (e.g., new excluded attributes, new retry logic, new API patterns)

**This file is the primary source of truth for AI-assisted debugging.** Before investigating any error, consult `error-history.yaml` first — the fix may already be documented.
