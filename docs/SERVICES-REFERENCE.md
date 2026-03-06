# Referência Rápida de Serviços

Cheat sheet para desenvolvedores — funções chave, signatures, e returns.

---

## ml_api.py — Assinaturas Rápidas

### Token e Auth

```python
async def _get_token(seller_slug: str, org_id: str) -> str
# Auto-refresh se expirado, com per-seller lock
# Lança: RuntimeError se seller não conectado ou token revogado

async def exchange_code(code: str, org_id: str = "") -> dict
# OAuth2 code → access_token + refresh_token
# Retorna: {"access_token": ..., "refresh_token": ..., "expires_in": 21600}

async def fetch_user_info(access_token: str, org_id: str = "") -> dict
# GET /users/me — perfil de usuário ML
```

### Item Operations

```python
async def get_item(seller_slug: str, item_id: str, org_id: str = "") -> dict
# GET /items/{item_id} — dados completos

async def get_item_description(seller_slug: str, item_id: str, org_id: str = "") -> dict
# GET /items/{item_id}/description — retorna {} se 404

async def create_item(seller_slug: str, payload: dict, org_id: str = "") -> dict
# POST /items — cria novo, timeout 60s

async def update_item(seller_slug: str, item_id: str, payload: dict, org_id: str = "") -> dict
# PUT /items/{item_id} — atualiza existente

async def set_item_description(seller_slug: str, item_id: str, plain_text: str, org_id: str = "") -> dict
# POST /items/{item_id}/description

async def search_items_by_sku(seller_slug: str, sku: str, org_id: str = "") -> list[str]
# Busca por seller_sku + sku params — retorna item IDs
```

### Compatibilidades

```python
async def get_item_compatibilities(seller_slug: str, item_id: str, org_id: str = "") -> dict | None
# GET /items/{item_id}/compatibilities?extended=true
# Retorna: {"products": [{"catalog_product_id": ..., "domain_id": ...}]}
# Retorna None se 404

async def set_item_compatibilities(seller_slug: str, item_id: str, compat_data: dict, org_id: str = "") -> dict
# POST /items/{item_id}/compatibilities com copy_from

async def copy_item_compatibilities(
    seller_slug: str, new_item_id: str, source_item_id: str,
    source_compat_products: list[dict] | None = None, org_id: str = ""
) -> dict
# Copia compat com fallback para User Products
# Retorna: {"created_compatibilities_count": int} ou {}
```

### Official Store ID (Brand Accounts)

```python
async def get_seller_official_store_id(seller_slug: str, org_id: str) -> int | None
# Resolve ID para contas marca
# Cachea resultado em DB para future use
# Retorna None se não encontrado
```

### Erros

```python
class MlApiError(RuntimeError):
    service_name: str         # "Mercado Livre API"
    status_code: int          # HTTP status
    method: str               # GET, POST, etc.
    url: str                  # Full URL
    detail: str               # Extracted message
    payload: Any              # Full JSON response
```

---

## item_copier.py — Assinaturas Rápidas

### Copy Main Function

```python
async def copy_single_item(
    source_seller: str,
    dest_seller: str,
    item_id: str,
    user_email: str | None = None,
    user_id: str | None = None,
    copy_log_id: int | None = None,
    org_id: str = "",
) -> dict

# Returns:
{
    "source_item_id": str,
    "dest_seller": str,
    "status": "success" | "error" | "needs_dimensions",
    "dest_item_id": str | None,
    "error": str | None,
    "sku": str | None,
}
```

### Bulk Copy

```python
async def copy_items(
    source_seller: str,
    dest_sellers: list[str],
    item_ids: list[str],
    user_email: str | None = None,
    user_id: str | None = None,
    org_id: str = "",
) -> list[dict]

# Returns: list of copy_single_item results
# Updates copy_logs in DB with final status
```

### Copy with Dimensions

```python
async def copy_with_dimensions(
    source_seller: str,
    dest_sellers: list[str],
    item_id: str,
    dimensions: dict,  # {height, width, length, weight}
    org_id: str = "",
    user_id: str | None = None,
) -> list[dict]

# 1. PUT dimensions to source item
# 2. copy_items() to all destinations
# Returns: list of results
```

### Payload Building

```python
def _build_item_payload(item: dict, safe_mode: bool = False) -> dict
# Constructs POST /items payload
# safe_mode=True: minimal fields only
# Returns: Dict pronto para POST

# Inclui: category_id, price, title/family_name, pictures,
#         attributes, variations, shipping, sale_terms, channels
# Exclui: EXCLUDED_ATTRIBUTES + SKIP_FIELDS
```

### Error Handling Helpers

```python
def _is_dimension_error(exc: MlApiError) -> bool
# Detecta "missing dimensions" error

def _is_title_invalid_error(exc: MlApiError) -> bool
def _is_family_name_invalid_error(exc: MlApiError) -> bool
def _is_family_name_length_error(exc: MlApiError) -> bool
# Detecta específicos erros de título/family_name

def _is_official_store_id_error(exc: MlApiError) -> bool
# Detecta falta de official_store_id em brand accounts

def _is_variations_invalid_with_family_name_error(exc: MlApiError) -> bool
# Detecta conflito variations + family_name

def _is_user_product_item(item: dict) -> bool
# Detecta User Product items (brand accounts)
```

### SKU Extraction

```python
def _get_item_seller_custom_field(item: dict) -> str
# Extrai SKU em ordem: seller_custom_field → attributes → variations
# Retorna: str ou ""

def _extract_value_pair(entry: dict) -> tuple[str, str]
# Extrai (value_id, value_name) de atributo/termo
# Suporta múltiplas estruturas de nesting
# Retorna: (id_str, name_str)
```

### Family Name (Brand Accounts)

```python
def _get_family_name(item: dict) -> str
# Extrai family_name para brand accounts
# Tenta: item.family_name → title → seller_custom_field
# Limita a 120 chars
# Retorna: str ou ""
```

### Payload Adjustment

```python
def _adjust_payload_for_ml_error(
    payload: dict, item: dict, exc: MlApiError
) -> tuple[dict, list[str]]

# Dado erro do ML, ajusta payload para retry
# Retorna: (adjusted_payload, ["action1", "action2"])
#
# Ações: "removed {field}", "added {field} as {reason}", etc.
```

### Logging

```python
def _log_api_debug(
    action: str,                     # "create_item", "set_description", etc.
    source_seller: str | None = None,
    dest_seller: str | None = None,
    source_item_id: str | None = None,
    dest_item_id: str | None = None,
    user_id: str | None = None,
    copy_log_id: int | None = None,
    api_method: str | None = None,  # POST, PUT, GET
    api_url: str | None = None,
    request_payload: Any = None,
    response_status: int | None = None,
    response_body: Any = None,
    error_message: str | None = None,
    attempt_number: int = 1,
    adjustments: list[str] | None = None,
    resolved: bool = False,
    org_id: str | None = None,
) -> None

# Inserts row em api_debug_logs para debugging
# Payloads > 50KB são truncados
```

---

## compat_copier.py — Assinaturas Rápidas

### SKU Search

```python
async def search_sku_all_sellers(
    skus: list[str],
    allowed_sellers: list[str] | None = None,
    org_id: str = "",
) -> list[dict[str, Any]]

# Returns:
[
    {
        "seller_slug": "seller1",
        "seller_name": "Loja 1",
        "item_id": "MLBxxxxx",
        "sku": "SKU123",
        "title": "Product Title",
    }
]
```

### Copy Compatibilities

```python
async def copy_compat_to_targets(
    source_item_id: str,
    targets: list[dict[str, str]],  # [{seller_slug, item_id}, ...]
    skus: list[str] | None = None,
    log_id: int | None = None,
    org_id: str = "",
) -> list[dict[str, Any]]

# Returns:
[
    {
        "seller_slug": "seller1",
        "item_id": "MLByyyy1",
        "status": "ok" | "error",
        "error": str | None,
    }
]
```

---

## config.py — Settings

```python
from app.config import settings

settings.ml_app_id           # str
settings.ml_secret_key       # str
settings.ml_redirect_uri     # str
settings.supabase_url        # str
settings.supabase_service_role_key  # str
settings.admin_master_password       # str
settings.stripe_secret_key   # str
settings.stripe_webhook_secret       # str
settings.stripe_price_id     # str
settings.smtp_host           # str (empty if not configured)
settings.smtp_port           # int (default 587)
settings.smtp_user           # str
settings.smtp_password       # str
settings.smtp_from           # str
settings.base_url            # str (default http://localhost:8000)
settings.cors_origins        # str (comma-separated)
```

---

## email.py — Assinatura Rápida

```python
def send_reset_email(to_email: str, reset_token: str) -> None
# Envia email de reset password via SMTP
# Silenciosamente skippa se SMTP não configurado
# Raises: Exception se SMTP falhar
```

---

## Constantes Importantes

### Excluded & Skip Fields (item_copier.py)

```python
EXCLUDED_ATTRIBUTES = {
    "ITEM_CONDITION", "SELLER_SKU", "GTIN",
    "PACKAGE_*", "SHIPMENT_PACKING", "CATALOG_*",
    "PRODUCT_FEATURES", "HAS_COMPATIBILITIES",
    "GIFTABLE", "IS_HIGHLIGHT_BRAND", "IS_TOM_BRAND"
}

SKIP_FIELDS = {
    "id", "seller_id", "date_created", "sold_quantity", "status",
    "permalink", "health", "tags", "automatic_relist",
    "official_store_id", "catalog_product_id", "domain_id", ...
}
```

### Rate Limiting (ml_api.py)

```python
_RATE_LIMIT_RETRIES = 5        # 5 attempts
_RATE_LIMIT_BASE_WAIT = 3      # 3s base, exponential
_COMPAT_PACE = 1.0             # 1s between batches
_UP_COMPAT_BATCH = 200         # 200 products per batch
```

### Timeouts (ml_api.py)

```python
# GET/POST regular: 30.0s
# POST /items: 60.0s
# Token refresh: 30.0s
```

---

## Database Tables (Supabase)

### copy_logs

```python
{
    "id": int,
    "user_id": str | None,
    "user_email": str | None,
    "org_id": str,
    "source_seller": str,
    "dest_sellers": list[str],
    "source_item_id": str,
    "dest_item_ids": dict[str, str] | None,  # {seller: new_item_id}
    "status": "success" | "error" | "partial" | "needs_dimensions" | "in_progress",
    "error_details": dict | None,  # {seller: error_message}
    "created_at": timestamp,
    "updated_at": timestamp,
}
```

### compat_logs

```python
{
    "id": int,
    "user_id": str | None,
    "org_id": str,
    "source_item_id": str,
    "skus": list[str] | None,
    "targets": list[dict],  # [{seller_slug, item_id, status, error}]
    "success_count": int,
    "error_count": int,
    "total_targets": int,
    "status": "success" | "error" | "partial",
    "created_at": timestamp,
    "updated_at": timestamp,
}
```

### api_debug_logs

```python
{
    "id": int,
    "action": str,  # "create_item", "set_description", "copy_compat"
    "source_seller": str | None,
    "dest_seller": str | None,
    "source_item_id": str | None,
    "dest_item_id": str | None,
    "user_id": str | None,
    "copy_log_id": int | None,
    "org_id": str | None,
    "api_method": str | None,  # POST, PUT, GET
    "api_url": str | None,
    "request_payload": dict | None,  # Truncado se > 50KB
    "response_status": int | None,
    "response_body": dict | None,  # ML error response
    "error_message": str | None,
    "attempt_number": int,  # 1-4
    "adjustments": list[str] | None,  # ["removed title", ...]
    "resolved": bool,
    "created_at": timestamp,
}
```

### copy_sellers

```python
{
    "slug": str,  # unique per org
    "org_id": str,
    "name": str,
    "ml_user_id": int,
    "ml_access_token": str,
    "ml_refresh_token": str,
    "ml_token_expires_at": timestamp,
    "active": bool,
    "official_store_id": int | None,  # Cached brand account ID
    "created_at": timestamp,
    "updated_at": timestamp,
}
```

---

## Common Patterns

### Checking if Error Needs Dimensions

```python
try:
    result = await copy_single_item(...)
except MlApiError as e:
    if _is_dimension_error(e):
        # User needs to call /copy/with-dimensions
        return {"status": "needs_dimensions", "error": "..."}
```

### Building SKU for Display

```python
from app.services.item_copier import _get_item_seller_custom_field

sku = _get_item_seller_custom_field(item) or "Sem SKU"
```

### Safely Accessing ML Response

```python
try:
    result = await get_item(seller, item_id, org_id)
    title = result.get("title", "Untitled")
except MlApiError as e:
    if e.status_code == 404:
        # Item não existe
        pass
    else:
        # Outro erro
        raise
```

### Handling Bulk Copy Results

```python
results = await copy_items(source, [dest1, dest2], [item1, item2])

for result in results:
    if result["status"] == "success":
        print(f"✓ {result['source_item_id']} → {result['dest_item_id']}")
    elif result["status"] == "needs_dimensions":
        print(f"⚠ {result['source_item_id']} precisa dimensões")
    else:
        print(f"✗ {result['source_item_id']}: {result['error']}")
```

### Pre-check User Permissions

```python
# Em routers/copy.py:
# require_active_org() dependency garante org está ativa
# User permissions são verificados via can_copy_from / can_copy_to
```

---

## Testing Patterns

### Mock copy_single_item

```python
from unittest.mock import AsyncMock, patch

@pytest.mark.asyncio
async def test_copy():
    with patch("app.services.item_copier.get_item") as mock_get:
        mock_get.return_value = {
            "id": "MLBxxxx",
            "title": "Test Item",
            "price": 100,
            # ...
        }
        result = await copy_single_item(...)
        assert result["status"] == "success"
```

### Query api_debug_logs for Test Results

```sql
-- Check if error was logged
SELECT * FROM api_debug_logs
WHERE source_item_id = 'MLBtest'
  AND action = 'create_item'
ORDER BY created_at DESC LIMIT 1;
```

---

## Performance Tips

### Bulk Operations

- Use `copy_items()` in loop, not parallel calls (DB contention)
- Semáforo em `search_sku_all_sellers` limita concorrência

### API Calls

- Cache `official_store_id` (stored em DB, reused)
- Batch compat products em 200 (ML limit)
- 1s pacing entre compat batches

### Database

- `copy_logs` pode ser grande → archive antigos
- `api_debug_logs` é write-heavy → consider indexed queries
- Use `org_id` para filtros (tenant isolation)

---

## Environment Checklist

**Required:**
- [ ] ML_APP_ID
- [ ] ML_SECRET_KEY
- [ ] ML_REDIRECT_URI
- [ ] SUPABASE_URL
- [ ] SUPABASE_SERVICE_ROLE_KEY (critical!)
- [ ] ADMIN_MASTER_PASSWORD

**Strongly Recommended:**
- [ ] STRIPE_SECRET_KEY
- [ ] STRIPE_WEBHOOK_SECRET
- [ ] STRIPE_PRICE_ID
- [ ] SMTP_HOST (password reset)

**Optional:**
- [ ] SMTP_USER, SMTP_PASSWORD, SMTP_FROM

---

## Debugging Commands

### Find Error Patterns

```sql
SELECT response_body->'cause'->0->>'code' as error_code,
       COUNT(*) as frequency
FROM api_debug_logs
WHERE resolved = false
GROUP BY error_code
ORDER BY frequency DESC;
```

### Items Needing Retry

```sql
SELECT source_item_id, dest_seller, error_message,
       MAX(created_at) as latest
FROM api_debug_logs
WHERE resolved = false
GROUP BY source_item_id, dest_seller
ORDER BY latest DESC;
```

### Copy Success Rate

```sql
SELECT
    status,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM copy_logs), 2) as pct
FROM copy_logs
GROUP BY status;
```

---

## Links Úteis

- API docs: `/docs/API.md`
- Error history: `error-history.yaml`
- Routers: `app/routers/`
- Database schema: Supabase console
