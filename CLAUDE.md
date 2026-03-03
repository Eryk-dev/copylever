# Copy Anuncios ML

Plataforma para copiar anúncios e compatibilidades veiculares entre contas do Mercado Livre.

## Tech Stack

- **Backend**: FastAPI (Python 3.11) + Uvicorn
- **Frontend**: React 19 + TypeScript + Vite
- **Database**: Supabase (PostgreSQL) com service_role key (bypass RLS)
- **HTTP Client**: httpx (async)
- **Auth**: bcrypt (senhas) + session tokens (7 dias TTL)
- **Deploy**: Docker multi-stage (Node build → Python runtime) no Easypanel

## Project Structure

```
app/
├── main.py              # FastAPI init, CORS, routers, SPA serving
├── config.py            # Pydantic Settings (env vars)
├── db/
│   ├── supabase.py      # Supabase client singleton (get_db())
│   └── migrations/      # SQL migrations (001-005)
├── routers/
│   ├── auth.py          # Login/logout/me/admin-promote + require_user/require_admin deps
│   ├── auth_ml.py       # OAuth2 ML (install → callback → token exchange)
│   ├── copy.py          # POST /api/copy, /api/copy/with-dimensions, GET /api/copy/logs
│   ├── compat.py        # POST /api/compat/copy, /search-sku, GET /api/compat/logs
│   └── admin_users.py   # CRUD users + permissions (admin only)
└── services/
    ├── ml_api.py         # MercadoLivre API client (token mgmt, error handling)
    ├── item_copier.py    # Core copy logic (~850 lines, retry, payload transform)
    └── compat_copier.py  # Compatibility copy orchestration (background tasks)

frontend/
├── src/
│   ├── App.tsx           # Router + layout (tabs: Copy, Compat, Admin)
│   ├── pages/            # CopyPage, CompatPage, Admin, UsersPage, Login
│   ├── components/       # Reusable UI components
│   ├── hooks/useAuth.ts  # Auth state + methods (token in localStorage)
│   └── lib/api.ts        # API types + constants
└── dist/                 # Built SPA (mounted by FastAPI at /)
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
ADMIN_MASTER_PASSWORD  # One-time admin setup password
BASE_URL               # Public URL for OAuth redirects
CORS_ORIGINS           # Comma-separated allowed origins
```

## Database Schema (Supabase)

**Project:** parts-catalogs (ID: `wrbrbhuhsaaupqsimkqz`, region: sa-east-1)

**Auth:**
- `users` — id, username, password_hash, role (admin|operator), can_run_compat, active
- `user_sessions` — token (32-byte URL-safe), expires_at (7 days)
- `user_permissions` — user_id + seller_slug → can_copy_from, can_copy_to
- `auth_logs` — login, logout, login_failed, admin_promote

**Operations:**
- `copy_sellers` — slug, ml_user_id, ml_access_token, ml_refresh_token, ml_token_expires_at
- `copy_logs` — user_id, source_seller, dest_sellers[], source_item_id, status
- `compat_logs` — user_id, source_item_id, skus[], targets (JSONB), success/error counts, status

**Debug:**
- `api_debug_logs` — full request/response for failed ML API calls (payload JSONB, resolved flag)

Migrations: `app/db/migrations/001_compat_logs.sql` through `005_api_debug_logs.sql`

## Authentication & Authorization

**Auth flow:**
1. POST `/api/auth/login` → bcrypt verify → session token via `X-Auth-Token` header
2. `require_user()` dependency validates token on every protected route
3. `require_admin()` extends require_user with role check
4. First admin created via POST `/api/auth/admin-promote` with ADMIN_MASTER_PASSWORD

**RBAC:**
- `admin` — full access, bypasses all permission checks
- `operator` — access filtered by per-seller permissions (can_copy_from, can_copy_to)
- `can_run_compat` — boolean flag on user for compatibility features

**MercadoLivre OAuth2:**
- GET `/api/ml/install` → redirect to ML auth
- GET `/api/ml/callback` → exchange code for token → store in `copy_sellers`
- Token auto-refresh on expiry via `_get_token()` in ml_api.py

## API Routes

```
POST   /api/auth/login              # Login (username + password)
POST   /api/auth/logout             # Invalidate session
GET    /api/auth/me                 # Current user + permissions
POST   /api/auth/admin-promote      # First admin setup

GET    /api/ml/install              # OAuth2 redirect to ML
GET    /api/ml/callback             # OAuth2 callback

GET    /api/sellers                 # List connected ML sellers
DELETE /api/sellers/{slug}          # Disconnect seller

POST   /api/copy                   # Bulk copy listings
POST   /api/copy/with-dimensions   # Copy with custom dimensions
GET    /api/copy/preview/{item_id} # Preview item before copy
GET    /api/copy/logs              # Copy history

POST   /api/compat/copy            # Copy vehicle compatibilities
POST   /api/compat/search-sku      # Find items by SKU across sellers
GET    /api/compat/preview/{id}    # Preview compatibility info
GET    /api/compat/logs            # Compat history

GET    /api/admin/users            # List users (admin)
POST   /api/admin/users            # Create user (admin)
PUT    /api/admin/users/{id}       # Update user (admin)
DELETE /api/admin/users/{id}       # Delete user (admin)
GET    /api/admin/users/{id}/permissions
PUT    /api/admin/users/{id}/permissions

GET    /api/health                 # Health check
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
- Dependencies: `Depends(require_user)` / `Depends(require_admin)` for auth
- Logging: `logger = logging.getLogger(__name__)` per module
- Error messages in Portuguese (user-facing), English (logs/code)
- No test suite — relies on manual testing + PRD acceptance criteria
- Frontend: TypeScript strict, React 19, Vite, no state management library

## Error History (MANDATORY)

**File:** `error-history.yaml` — Structured knowledge base of all errors and corrections.

**RULE: Every time you fix a bug or handle a new ML API error, you MUST:**
1. Add a new entry to `error-history.yaml` under `error_history` with the next ERR-XXX id
2. If it involves a new ML error code, add it to `ml_error_codes`
3. If it reveals a new pattern, update the `patterns` section
4. Update `unresolved` section if applicable (add new or mark as fixed)
5. Update this CLAUDE.md if the fix changes any documented behavior (e.g., new excluded attributes, new retry logic, new API patterns)

**This file is the primary source of truth for AI-assisted debugging.** Before investigating any error, consult `error-history.yaml` first — the fix may already be documented.
