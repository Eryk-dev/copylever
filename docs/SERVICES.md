# Documentação de Serviços e Lógica de Negócio

Documentação minuciosa dos serviços backend, fluxos de dados e padrões de tratamento de erros da plataforma Copy Anuncios.

---

## Sumário

1. [ml_api.py — Cliente API Mercado Livre](#ml_apipy--cliente-api-mercado-livre)
2. [item_copier.py — Núcleo de Cópia de Anúncios](#item_copierpy--núcleo-de-cópia-de-anúncios)
3. [compat_copier.py — Cópia de Compatibilidades Veiculares](#compat_copierpy--cópia-de-compatibilidades-veiculares)
4. [email.py — Serviço de Email](#emailpy--serviço-de-email)
5. [config.py — Configuração](#configpy--configuração)
6. [Padrões de Erro ML e Tratamento](#padrões-de-erro-ml-e-tratamento)

---

## ml_api.py — Cliente API Mercado Livre

Módulo responsável por todas as chamadas HTTP à API do Mercado Livre, incluindo autenticação OAuth2, gerenciamento de tokens, tratamento de erros estruturados e rate limiting.

### Constantes Importantes

```python
ML_API = "https://api.mercadolibre.com"
MP_API = "https://api.mercadopago.com"
_UP_COMPAT_BATCH = 200          # Limite de produtos por batch na API de compatibilidades
_RATE_LIMIT_RETRIES = 5         # Máximo de retentativas para rate limit (429)
_RATE_LIMIT_BASE_WAIT = 3       # Segundos de espera base, dobrado exponencialmente
_COMPAT_PACE = 1.0              # Segundos entre chamadas de compatibilidade (evita 429)
```

### Classe: MlApiError

Exceção estruturada para erros da API ML/MP.

**Propriedades:**
- `service_name: str` — Nome do serviço (e.g., "Mercado Livre API")
- `status_code: int` — HTTP status code (400, 401, 403, 404, 429, etc.)
- `method: str` — Método HTTP usado (GET, POST, PUT, DELETE)
- `url: str` — URL completa da requisição
- `detail: str` — Mensagem de erro estruturada (extraída de `cause[]`)
- `payload: Any` — JSON da resposta completa do ML (para debugging)

**Exemplo de erro estruturado do ML:**
```json
{
  "error": "INVALID_ITEM_ATTRIBUTE",
  "message": "Invalid item attribute",
  "cause": [
    {
      "code": "INVALID_TITLE",
      "message": "Title is too long",
      "type": "error"
    }
  ]
}
```

### Funções de Extração de Erros

**`_extract_api_error(resp: httpx.Response) -> tuple[str, Any]`**

Extrai mensagem de erro e payload do JSON estruturado do ML. Consolida campos comuns:
- `error` — campo de erro
- `message` / `error_description` / `detail` — mensagem
- `cause[]` — array de causas com `code` e `message`

Retorna tupla `(mensagem_consolidada, payload_dict)`.

**`_raise_for_status(resp: httpx.Response, service_name: str) -> None`**

Lança `MlApiError` se status >= 400. Converte httpx.HTTPStatusError para MlApiError com detalhes estruturados.

### Token Management — Autenticação OAuth2

**`async _get_token(seller_slug: str, org_id: str) -> str`**

Obtém e auto-renova o token de acesso do Mercado Livre para um seller. Implementa mecanismo crítico de sincronização:

**Fluxo:**
1. Busca tokens do seller na tabela `copy_sellers`
2. Se token válido (expiry no futuro), retorna imediatamente
3. Se expirado, adquire lock **por-seller** (`_get_seller_lock()`) — essencial para evitar race conditions
4. Double-check: verifica novamente se outro coroutine não já renovou
5. POST `/oauth/token` com `refresh_token` para MP_API
6. Se 400/401: token revogado pelo usuário — limpa tokens na DB e lança erro
7. Salva novo `access_token`, `refresh_token` e `expires_at` na DB
8. Libera lock e retorna token

**Por quê per-seller locks são críticos:**
Sem locks, dois coroutines refreshando o mesmo seller simultaneamente podem ambos usar o velho `refresh_token`, invalidando-o. A lock garante que apenas um coroutine por seller faz refresh por vez.

**`_get_seller_lock(seller_slug: str) -> asyncio.Lock`**

Gerencia dict global `_token_locks` mapeando `seller_slug` → `asyncio.Lock`. Cria lock lazy se não existir.

**`async exchange_code(code: str, org_id: str = "") -> dict`**

Troca `authorization_code` (do OAuth2 callback) por par access/refresh token. POST `/oauth/token` com:
- `grant_type: "authorization_code"`
- `code`: código retornado pelo Mercado Livre
- `client_id` / `client_secret`: credenciais da app (global settings)
- `redirect_uri`: onde o ML redirecionará após auth (deve bater com configurado no ML Dev Center)

**`async fetch_user_info(access_token: str, org_id: str = "") -> dict`**

GET `/users/me` — retorna perfil do usuário ML:
```json
{
  "id": 123456789,
  "nickname": "store_name",
  "email": "seller@example.com",
  "categories": [],
  "permissions": [...],
  "account_type": "seller|power_seller|brand"
}
```

### Gerenciamento de Official Store ID (Contas Marca)

**`async get_seller_official_store_id(seller_slug: str, org_id: str) -> int | None`**

Resolve `official_store_id` para sellers com contas marca (brand accounts). Este ID é requerido pelo ML para criar anúncios em contas oficiais.

**Algoritmo:**
1. Busca na DB se já foi cacheado em `copy_sellers.official_store_id`
2. Se cached, retorna imediatamente
3. Senão, GET `/users/{user_id}/items/search` com status=active, limit=5
4. Para cada item retornado, GET `/items/{item_id}` e extrai `official_store_id`
5. Salva na DB para future use
6. Se nenhum item tiver `official_store_id`, retorna None

**Motivo:** Contas marca precisam deste ID, mas o endpoint `/users/me` não retorna. A solução é inspecionar items existentes do seller.

### Operações de Item

**`async get_item(seller_slug: str, item_id: str, org_id: str = "") -> dict`**

GET `/items/{item_id}` — retorna dados completos do item:
- `id`, `title`, `category_id`, `price`, `currency_id`
- `available_quantity`, `buying_mode`, `condition`
- `pictures`, `attributes`, `variations`
- `shipping`, `sale_terms`, `channels`
- `family_name` (para contas marca)
- `seller_custom_field` (SKU do seller)
- Muitos mais campos de leitura (status, date_created, health, etc.)

**`async get_item_description(seller_slug: str, item_id: str, org_id: str = "") -> dict`**

GET `/items/{item_id}/description` — retorna descrição em rich text ou plain text:
```json
{
  "plain_text": "Descrição em texto simples",
  "text": "... HTML ou Markdown ..."
}
```

Retorna `{}` se 404 (item sem descrição).

**`async create_item(seller_slug: str, payload: dict, org_id: str = "") -> dict`**

POST `/items` — cria novo anúncio no Mercado Livre com payload pré-validado. Retorna item criado com `id`.

**Timeout:** 60s (uploads de imagens podem ser lentos).

**`async update_item(seller_slug: str, item_id: str, payload: dict, org_id: str = "") -> dict`**

PUT `/items/{item_id}` — atualiza anúncio existente. Payload parcial (apenas campos a mudar).

**`async set_item_description(seller_slug: str, item_id: str, plain_text: str, org_id: str = "") -> dict`**

POST `/items/{item_id}/description` — define descrição plain text do item.

### Compatibilidades Veiculares

**`async get_item_compatibilities(seller_slug: str, item_id: str, org_id: str = "") -> dict | None`**

GET `/items/{item_id}/compatibilities?extended=true` — retorna compatibilidades com autopartes (carros, motos, etc.):
```json
{
  "product_id": "...",
  "products": [
    {
      "catalog_product_id": 123,
      "domain_id": "ML_VEHICLE_CARS",
      "restrictions": []
    }
  ]
}
```

Retorna `None` se 404 (item não tem compatibilidades).

**`async set_item_compatibilities(seller_slug: str, item_id: str, compat_data: dict, org_id: str = "") -> dict`**

POST `/items/{item_id}/compatibilities` — configura compatibilidades do item via "copy from another item":
```json
{
  "item_to_copy": {
    "item_id": "source_item_id",
    "extended_information": true
  }
}
```

### Busca de SKU

**`async search_items_by_sku(seller_slug: str, sku: str, org_id: str = "") -> list[str]`**

Busca items de um seller pelo SKU. Tenta dois parâmetros:
1. `seller_sku` — busca pelo campo `seller_custom_field` do item
2. `sku` — busca pelo atributo SELLER_SKU do item

Retorna lista de item IDs encontrados (union de ambas buscas, deduplicada).

### Compatibilidades com User Products

**`async copy_item_compatibilities(seller_slug: str, new_item_id: str, source_item_id: str, source_compat_products: list[dict] | None = None, org_id: str = "") -> dict`**

Copia compatibilidades de um item para outro. Implementa fallback para User Products:

**Fluxo:**
1. POST `/items/{new_item_id}/compatibilities` com `item_to_copy`
2. Se retorna 404, item não tem compatibilidades — retorna `{}`
3. Se retorna 400/403 com mensagem contendo "User Product", o item usa User Product API (brand accounts)
4. Nesse caso, chama `_copy_user_product_compatibilities()` com `source_compat_products`

**Retry automático:** `_post_with_retry()` implementa exponential backoff para rate limit (429):
- Base: 3s, dobra a cada tentativa até máximo 5 retentativas
- Respeita header `retry-after` se presente

**`async _copy_user_product_compatibilities(client: httpx.AsyncClient, token: str, item_id: str, source_products: list[dict] | None) -> dict`**

Copia compatibilidades via User Products API (endpoints alternativos para brand accounts).

**Algoritmo:**
1. GET `/items/{item_id}` para obter `user_product_id`
2. Formata produtos: `{"id": catalog_product_id, "domain_id": domain_id, "restrictions": [...]}`
3. POST em batches de 200 para `/user-products/{user_product_id}/compatibilities` com pacing de 1s entre batches (ML rate limiting)
4. Retorna `{"created_compatibilities_count": total}`

**`_is_user_product_error(resp: httpx.Response) -> bool`**

Detecta se erro 400/403 é por User Product mismatch. Checa se `message` contém "User Product" ou "seller of the user product".

### Rate Limiting e Retry

**`async _post_with_retry(client: httpx.AsyncClient, url: str, headers: dict, json: dict) -> httpx.Response`**

Wrapper de POST que automaticamente retenta em 429 (Too Many Requests):

**Estratégia:**
- Tenta até 5 vezes
- Se 429: aguarda `retry-after` header ou `3 * (2 ^ attempt)` segundos (exponential backoff)
- Retorna última resposta (pode ser 429 se todas tentativas falharem)
- Chamador deve chamar `_raise_for_status()` se quiser erro

**Exemplo:**
```
Tentativa 1: erro 429 → aguarda 3s
Tentativa 2: erro 429 → aguarda 6s
Tentativa 3: erro 429 → aguarda 12s
Tentativa 4: erro 429 → aguarda 24s
Tentativa 5: erro 429 ou sucesso → retorna
```

---

## item_copier.py — Núcleo de Cópia de Anúncios

Módulo de ~850 linhas com lógica complexa de construção de payload, tratamento de erros ML, retry inteligente e safe mode. Este é o coração funcional da plataforma.

### Constantes e Configurações

**`EXCLUDED_ATTRIBUTES`** — Atributos que NÃO são copiados porque são leitura-única ou auto-calculados pelo ML:

```python
EXCLUDED_ATTRIBUTES = {
    "ITEM_CONDITION",          # Definido via campo top-level `condition`
    "SELLER_SKU",              # Mantido em variations (se presente)
    "GTIN",                    # Código de barras (imutável, catalog-managed)
    "PACKAGE_WEIGHT",          # Auto-calculado pelo ML a partir de shipping.dimensions
    "PACKAGE_HEIGHT",          # Idem
    "PACKAGE_WIDTH",           # Idem
    "PACKAGE_LENGTH",          # Idem
    "SHIPMENT_PACKING",        # Tipo de pacote (auto-calculado)
    "CATALOG_TITLE",           # Título do catálogo (não editável em items)
    "PRODUCT_FEATURES",        # Features do catálogo
    "HAS_COMPATIBILITIES",     # Read-only, ML ignora
    "GIFTABLE",                # Read-only, ML ignora
    "IS_HIGHLIGHT_BRAND",      # Read-only, ML ignora
    "IS_TOM_BRAND",            # Read-only, ML ignora
}
```

**`SKIP_FIELDS`** — Campos top-level que NÃO são copiados (auto-gerados):

```python
SKIP_FIELDS = {
    "id", "seller_id", "date_created", "start_time", "stop_time",
    "sold_quantity", "status", "permalink", "thumbnail", "thumbnail_id",
    "secure_thumbnail", "health", "tags", "catalog_listing",
    "automatic_relist", "last_updated", "base_price",
    "initial_quantity", "official_store_id", "catalog_product_id",
    "domain_id", "parent_item_id", "deal_ids", "subtitle",
    "differential_pricing", "original_price",
}
```

Razões para exclusão:
- **id, seller_id:** Únicos do item — não podem ser copiados
- **date_created, last_updated, start_time, stop_time:** Gerados pelo ML
- **sold_quantity, status:** Dinâmicos (estoque)
- **official_store_id:** Específico do seller — se copiado, quebra o item no seller destino. Deve ser descoberto via API se necessário
- **catalog_product_id, domain_id:** Ligam item a catálogo — seller-specific
- **parent_item_id:** Referência a pack parent — não copiável cross-account

**`DIMENSION_ERROR_KEYWORDS`** — Palavras-chave para detectar erros de dimensões faltantes:

```python
DIMENSION_ERROR_KEYWORDS = {
    "dimension", "dimensions", "dimensões", "dimensiones",
    "shipping.dimensions", "package_height", "package_width",
    "package_length", "package_weight", "seller_package",
}
```

**Outras constantes:**
- `USER_PRODUCT_LISTING_TAG = "user_product_listing"` — Tag do ML para User Products
- `MAX_FAMILY_NAME_LEN = 120` — Máximo de caracteres para family_name (brand accounts)
- `MAX_DEBUG_PAYLOAD_SIZE = 50_000` — Trunca payloads > 50KB em logs de debug

### Detecção de Erros ML

**`_is_dimension_error(exc: MlApiError) -> bool`**

Detecta se erro é causado por dimensões de shipping faltantes. Checa:
1. String do erro contém keyword de dimensão (case-insensitive)
2. Array `cause[]` do payload contém codes/messages com keywords

**`_is_title_invalid_error(exc: MlApiError) -> bool`**

Detecta erros de título inválido usando regex: `[invalid_fields|...,title,...]`

**`_is_family_name_invalid_error(exc: MlApiError) -> bool`**

Detecta erros de family_name inválido. Checa se campo está nos `invalid_fields` OU se erro menciona "family_name" explicitamente.

Distingue de `_is_family_name_length_error()` — length error é retentável (truncar), invalid é fatal.

**`_is_official_store_id_error(exc: MlApiError) -> bool`**

Detecta se erro é causado por falta de `official_store_id` em conta marca. Padrão: `["official_store_id"]` nos required_fields.

**`_is_variations_invalid_with_family_name_error(exc: MlApiError) -> bool`**

Detecta conflito: item com variations + family_name (brand account) — incompatível no ML. Padrão: "variations" nos invalid_fields E error message menciona "family_name".

**`_is_user_product_item(item: dict) -> bool`**

Detecta se item é um User Product (brand account listing) checando tag "user_product_listing" no campo `tags`.

### Extração de Campos de Erro

**`_extract_ml_error_fields(exc: MlApiError, marker: str) -> set[str]`**

Extrai campos de erro do payload estruturado. Procura por padrão `[marker, field1, field2, ...]` em `cause[i].message`:

Exemplo de resposta do ML:
```json
{
  "cause": [
    {
      "message": "[invalid_fields, title, price]",
      "code": "INVALID_ITEM"
    }
  ]
}
```

Retorna: `{"title", "price"}`

Também suporta variante com escape: `invalid_fields|title|price` ou `invalid_fields: title, price`.

### Construção de SKU

O sistema extrai SKU (seller_custom_field) nesta ordem de prioridade:

1. **Nível do item:** `item.seller_custom_field` (campo direto)
2. **Atributo do item:** `item.attributes[].id == "SELLER_SKU"`
3. **Nível da variação:** `item.variations[].seller_custom_field` (primeira encontrada)
4. **Atributo da variação:** `item.variations[].attributes[].id == "SELLER_SKU"` (primeira encontrada)

**`_get_item_seller_custom_field(item: dict) -> str`**

Extrai SKU do item na ordem acima. Retorna string vazia se não encontrar.

**`_extract_seller_sku_from_attributes(attributes: list) -> str`**

Busca atributo SELLER_SKU em lista. Extrai `value_name` ou `value_id`.

**`_extract_value_pair(entry: dict) -> tuple[str, str]`**

Extrai par `(value_id, value_name)` de entrada de atributo/termo de venda. Suporta múltiplas estruturas:
- Direto: `{"value_id": "x", "value_name": "y"}`
- Nested: `{"values": [{"id": "x", "name": "y"}]}`
- Value struct: `{"value_struct": {"number": "x", "unit": "y"}}`

Retorna `("", "")` se nenhuma estrutura for encontrada.

### Family Name (Contas Marca)

**`_get_family_name(item: dict) -> str`**

Extrai family_name para brand accounts (quando title não é disponível). Tenta em ordem:
1. Item já tem `family_name` — retorna
2. Extrai do `title` (usa como fallback)
3. Se title também vazio, tenta primeira parte do `seller_custom_field` ou SKU

Limita a 120 caracteres.

### Construção de Payload

**`_build_item_payload(item: dict, safe_mode: bool = False) -> dict`**

Função crítica que constrói o JSON para POST /items ou PUT /items. ~180 linhas de lógica complexa.

**Campos base copiados:**
```python
base_fields = [
    "category_id", "price", "currency_id",
    "available_quantity", "buying_mode", "listing_type_id",
    "condition",
]
# User Products não incluem title
# Safe mode exclui video_id
```

**Seller Custom Field (SKU):**
- Extraído via `_get_item_seller_custom_field()`
- Copiado para field `seller_custom_field` no payload

**Family Name (Brand Accounts):**
- Extraído via `_get_family_name()` se item é User Product
- Truncado a 120 caracteres
- User Products + `seller_custom_field` também recebem atributo SELLER_SKU para ML exibir SKU na UI

**Pictures:**
- Copiados como `{"source": secure_url or url}`
- **Criticamente importante:** NÃO usar picture IDs da origem — eles frequentemente falham em create (são específicos de seller). Use URLs em vez disso.

**Attributes:**
- Filtrados: remove `EXCLUDED_ATTRIBUTES` + read-only fields
- Extrai `value_id` e `value_name` de cada atributo
- Só incluídos se têm pelo menos um dos dois

**Sale Terms:**
- Formato: `[{"id": term_id, "value_id": value_id}, ...]`
- Extraídos do source item

**Shipping:**
- **Sempre usa `mode: "me2"`** (standard ML Logistic) — me1 (Full) é seller-specific
- **`local_pick_up: false`** — forçado false, sellers multi-warehouse rejeitam true
- Copia `free_shipping` do source

**Variations:**
- **User Products NÃO aceitam variations no create** — são adicionadas depois via PUT
- Para regular items:
  - Copia `available_quantity`, `price` por variation
  - Copia `seller_custom_field` da variation
  - Copia `attribute_combinations` (definem cor, tamanho, etc.)
  - Copia `attributes` (incluindo SELLER_SKU se presente)
  - **NÃO copia picture_ids** — usaria source pictures em destino
- Com variations, `available_quantity` é removido do top-level (ML espera stock por variation)

**Fulfillment (Full) Logic:**
- Se source shipping é logistic_type "fulfillment", item tem stock em warehouse ML = `available_quantity: 0`
- Força `available_quantity >= 1` para garantir listado ativo no destino

**Channels:**
- Copiados se presentes (para listar em mercados adicionais)
- Safe mode exclui (pode ter campos seller-specific)

**Safe Mode:**
- Ativado após 3 tentativas normais falharem
- Remove: `video_id`, `channels`, variation attributes (exceto SELLER_SKU)
- Payload minimalista — apenas campos essenciais

### Ajuste de Payload para Erros

**`_adjust_payload_for_ml_error(payload: dict, item: dict, exc: MlApiError) -> tuple[dict, list[str]]`**

Função crucial: dado erro do ML, modifica payload inteligentemente para retry. Retorna `(adjusted_payload, list_of_actions)`.

**Estratégia geral:**
1. Extrai campos `invalid_fields` e `required_fields` da resposta de erro
2. Remove campos inválidos (top-level ou nested como shipping.methods)
3. Adiciona campos obrigatórios faltantes
4. Handles fallbacks inteligentes (title ↔ family_name)

**Ações específicas:**

| Erro | Ação |
|------|------|
| `shipping.methods` inválido | Remove `shipping.methods` (mas mantém shipping) |
| `title` inválido + não tem `family_name` | Adiciona `family_name` como fallback |
| `family_name` inválido + não tem `title` | Adiciona `title` como fallback |
| `family_name` obrigatório | Adiciona via `_get_family_name()` |
| `title` obrigatório | Adiciona via item.title |
| `variations` + `family_name` conflito | Remove `variations` (brand account não aceita) + força `available_quantity` top-level |
| `family_name` length error | Trunca para 60 chars em vez de remover |
| `pictures` obrigatório | Reconstrói a partir do source item |
| `condition` obrigatório | Copia do source |
| `seller_custom_field` obrigatório | Extrai via SKU |

**Exemplo de fluxo com erro:**

```
Tentativa 1:
  Error: "[invalid_fields, title]"
  Action: remove title
  Add: family_name from source

Tentativa 2:
  Error: "[required_fields, official_store_id]"
  Action: fetch official_store_id via API
  Add: official_store_id + force free_shipping

Tentativa 3: Success
```

### Loop de Retry

**`async copy_single_item(source_seller: str, dest_seller: str, item_id: str, ...) -> dict`**

Função principal que copia um item individual. Implementa loop de retry 4-tentativas com múltiplos níveis.

**Fluxo completo:**

1. **GET item source:** `get_item(source_seller, item_id)`
   - Extrai SKU para resultado
   - Detecta se item tem compatibilidades para copiar depois

2. **GET description:** `get_item_description(source_seller, item_id)`

3. **Build payload:** `_build_item_payload(item, safe_mode=False)`

4. **Loop de retry (até 4 tentativas):**

   **Iteração com flags:**
   - `force_no_title` — se título inválido, remove em próximas tentativas
   - `force_no_family_name` — se family_name inválido, remove em próximas tentativas
   - `safe_mode_retry_used` — se ainda não usou safe mode, próxima tentativa usa

   **Lógica de tentativa:**

   a. **Aplica flags da iteração anterior** — modifica payload se `force_no_title` ou `force_no_family_name`

   b. **POST item:** `create_item(dest_seller, payload)`

   c. **Se sucesso:** quebra loop, vai para próximo passo

   d. **Se erro MlApiError:**
      - Log erro em `api_debug_logs` para debugging
      - Se título inválido: set `force_no_title = True`
      - Se family_name inválido (não-length): set `force_no_family_name = True`
      - **Tenta ajustar payload:** `_adjust_payload_for_ml_error(payload, item, exc)`
      - Se official_store_id faltante:
        - Fetch via `get_seller_official_store_id()` (resolves ID de contas marca)
        - Adiciona ao payload + força `free_shipping: true`
      - Se payload foi ajustado: continue (retry com novo payload)
      - Se não ajustado E ainda não usou safe_mode:
        - Reconstrói com `safe_mode=True`
        - Aplica força_no_title/family_name flags
        - **Preserva `official_store_id` descoberto** em iterações anteriores
        - Se payload mudou: set `safe_mode_retry_used = True`, continue
      - Senão: **raise (sem mais retries)**

5. **Marca como resolvido:** Se item foi criado após retries (`attempt > 1`), update `api_debug_logs.resolved = true` para debugging

6. **POST description:** Se source tinha, copy para destino via `set_item_description()`
   - Logged separadamente em `api_debug_logs` se falhar

7. **Copy compatibilidades:** Se source tinha compat, copy via `copy_item_compatibilities()`
   - Pre-fetch source compat products para fallback User Product
   - Logged separadamente se falhar

8. **Status sucesso**

**Tratamento de erros final:**

```python
except MlApiError as e:
    if _is_dimension_error(e):
        status = "needs_dimensions"  # User pode retry com dimensions
        error = "Item sem dimensoes de envio..."
    else:
        status = "error"
        error = str(e)
    # Log final para debugging
except Exception as e:
    status = "error"
    error = str(e)
```

**Retorno:**
```python
{
    "source_item_id": str,
    "dest_seller": str,
    "status": "success" | "error" | "needs_dimensions",
    "dest_item_id": str | None,
    "error": str | None,
    "sku": str | None,
}
```

### Cópia em Bulk

**`async copy_items(source_seller: str, dest_sellers: list[str], item_ids: list[str], ...) -> list[dict]`**

Copia múltiplos items para múltiplos sellers. Loga cada item em `copy_logs`.

**Fluxo:**

1. Para cada item_id:
   - Cria log "in_progress" em DB (antes de começar copy)
   - Para cada dest_seller: chama `copy_single_item()`
   - Coleta resultados (success, error, needs_dimensions)
   - Determina status final do item:
     - `success` — todos os sellers OK
     - `error` — nenhum seller OK
     - `partial` — alguns sellers OK, alguns falharam
     - `needs_dimensions` — todos falharam por dimensions (user pode retry com dimensions)
   - Update log com `dest_item_ids` (mapping seller → novo_item_id) e `error_details` (mapping seller → error)

2. Retorna lista de todos os resultados (item × seller combinations)

### Cópia com Dimensões (Workflow para Items sem Shipping Dimensions)

**`async copy_with_dimensions(source_seller: str, dest_sellers: list[str], item_id: str, dimensions: dict, ...) -> list[dict]`**

Útil quando copy falha por dimensões faltantes. User fornece dimensions e retry automaticamente.

**Fluxo:**

1. **Build dimension attributes** via `_build_dimension_attributes()`:
   ```python
   {
       "height": 10,   # cm
       "width": 20,    # cm
       "length": 30,   # cm
       "weight": 1000, # g
   }
   ```
   Mapeia para atributos ML:
   ```json
   [
       {"id": "SELLER_PACKAGE_HEIGHT", "value_name": "10 cm"},
       {"id": "SELLER_PACKAGE_WIDTH", "value_name": "20 cm"},
       {"id": "SELLER_PACKAGE_LENGTH", "value_name": "30 cm"},
       {"id": "SELLER_PACKAGE_WEIGHT", "value_name": "1000 g"}
   ]
   ```

2. **PUT dimensions no source item** via `update_item(source_seller, item_id, {"attributes": dim_attrs})`
   - Modifica source item — importante que user entenda isto

3. **Copy para todos os destinos** via `copy_single_item()` (agora item tem dimensions, deve passar)

4. **Retorna resultados** (lista de status por seller)

---

## compat_copier.py — Cópia de Compatibilidades Veiculares

Serviço de orquestração para copiar compatibilidades (autopartes com veículos) de um item source para múltiplos items destino.

### Busca de SKU Across Sellers

**`async search_sku_all_sellers(skus: list[str], allowed_sellers: list[str] | None = None, org_id: str = "") -> list[dict[str, Any]]`**

Busca items em múltiplos sellers que correspondem a SKUs fornecidos. Usado no workflow de "cópia de compatibilidades".

**Estratégia de concorrência:**
- Usa semáforo com limit 10 concurrent requests (evita rate limit do ML)
- Cria tasks para: `search_items_by_sku()` por seller × SKU
- Depois cria tasks para: `get_item()` para cada resultado (obter título)

**Fluxo:**

1. Query sellers conectados da org (filtrado por `allowed_sellers` se fornecido)
2. Para cada seller × SKU: task `search_items_by_sku()` com semáforo
3. Coleta item IDs de todas as buscas
4. Para cada item ID: task `get_item()` para obter title + dados adicionais
5. Retorna lista:
   ```python
   [
       {
           "seller_slug": "seller1",
           "seller_name": "Loja 1",
           "item_id": "MLBxxxxxx",
           "sku": "SKU123",
           "title": "Peça XYZ",
       }
   ]
   ```

**Tratamento de erro:** Continua mesmo se seller/item falhar, só loga warning.

### Resolução de Seller Source

**`async _resolve_source_seller(source_item_id: str, org_id: str = "") -> str | None`**

Encontra qual seller conectado é owner do item source (tentando GET /items em cada um).

Útil quando user fornece item_id sem especificar seller.

### Cópia de Compatibilidades para Múltiplos Itens

**`async copy_compat_to_targets(source_item_id: str, targets: list[dict[str, str]], skus: list[str] | None = None, log_id: int | None = None, org_id: str = "") -> list[dict[str, Any]]`**

Copia compatibilidades de um item source para múltiplos itens target.

**Parâmetros:**
- `source_item_id: str` — item com compatibilidades a copiar (e.g., "MLBxxxxxx")
- `targets: list[dict]` — cada com `seller_slug` e `item_id`
- `skus: list[str] | None` — SKUs (para logging, não afeta copy)
- `log_id: int | None` — ID de `compat_logs` row para update (vs insert new)

**Fluxo:**

1. **Pre-fetch compatibilidades source uma única vez:**
   - Resolve seller source via `_resolve_source_seller()`
   - GET compatibilidades via `get_item_compatibilities()` com source seller's token
   - Extrai `products[]` para fallback User Product (se necessário)

2. **Para cada target item (com pacing de 1s):**
   - Call `copy_item_compatibilities()` com source item ID + pre-fetched products
   - Se sucesso: resultado `{"status": "ok", "error": None}`
   - Se erro: resultado `{"status": "error", "error": str(exc)}`
   - Log erro em `api_debug_logs` se falhar

3. **Determina status final:**
   - `success` — todos OK
   - `error` — todos falharam
   - `partial` — alguns OK, alguns falharam

4. **Update ou insert `compat_logs`:**
   - Se `log_id`: UPDATE row existente com results finais
   - Senão: INSERT novo row (legacy)
   - Salva: `targets` (resultados por target), `success_count`, `error_count`, `status`

5. **Retorna resultados** (lista de status por target)

---

## email.py — Serviço de Email

Serviço SMTP para envio de emails transacionais (reset de senha).

### Função Principal

**`def send_reset_email(to_email: str, reset_token: str) -> None`**

Envia email de redefinição de senha. Implementação:

**Segurança:**
- Silenciosamente skippa se SMTP não configurado (não falha se feature desativada)
- Token é hash de 64 caracteres (gerado em `app/routers/auth.py`)

**Construção de email:**

Body (plain text em português):
```
Voce solicitou a redefinicao de senha.

Clique no link abaixo:
{BASE_URL}?reset_token={RESET_TOKEN}

Este link expira em 1 hora.

Se voce nao solicitou, ignore este email.
```

Headers:
- `Subject: "Copy Anuncios — Redefinir senha"`
- `From: {settings.smtp_from or settings.smtp_user}`
- `To: {to_email}`
- `Content-Type: text/plain; charset=utf-8`

**Fluxo SMTP:**

1. Conecta via SMTP (host + port do settings, default port 587)
2. `starttls()` — upgrade para encrypted connection
3. `login(username, password)`
4. `send_message(msg)` — envia MIMEText
5. Logs: "Reset email sent to X" (sucesso) ou exception (erro)

**Tratamento de erro:**
- Se falha: logs exception com `logger.exception()` + **re-raises** para caller
- Caller em `auth.py` captura e retorna erro 500 ao user

**Importante:** Este é endpoint síncrono (bloqueante). Em produção, considerar async via background task.

---

## config.py — Configuração

Sistema de configuração via environment variables usando Pydantic BaseSettings.

### Variáveis de Ambiente

**Mercado Livre OAuth (Plataforma SaaS):**
- `ML_APP_ID: str` — App ID da aplicação ML registrada no Dev Center
- `ML_SECRET_KEY: str` — Secret key da app
- `ML_REDIRECT_URI: str` — OAuth callback URL (e.g., `https://copy.levermoney.com.br/api/ml/callback`)

**Supabase (Database):**
- `SUPABASE_URL: str` — URL do projeto Supabase
- `SUPABASE_SERVICE_ROLE_KEY: str` — Service role key (bypass RLS, REQUIRED para app)
- `SUPABASE_KEY: str` — Anon key (alternative, menos comum)

**Autenticação:**
- `ADMIN_MASTER_PASSWORD: str` — Master password para setup do primeiro admin (one-time, depois descarta)

**Stripe (Billing):**
- `STRIPE_SECRET_KEY: str` — Secret API key do Stripe
- `STRIPE_WEBHOOK_SECRET: str` — Webhook signing secret
- `STRIPE_PRICE_ID: str` — Price ID do plano de subscripção

**SMTP (Email):**
- `SMTP_HOST: str` — Servidor SMTP (e.g., `smtp.gmail.com`)
- `SMTP_PORT: int` — Porta (default 587)
- `SMTP_USER: str` — Usuário SMTP
- `SMTP_PASSWORD: str` — Senha SMTP
- `SMTP_FROM: str` — From address (fallback para SMTP_USER)

**Server:**
- `BASE_URL: str` — URL pública da app (default `http://localhost:8000`). Usado em OAuth redirects e reset token links.
- `CORS_ORIGINS: str` — Origens CORS permitidas (comma-separated, default `http://localhost:5173,http://localhost:3000`)

### Inicialização

```python
from app.config import settings

# Acessa:
settings.ml_app_id
settings.supabase_service_role_key
settings.smtp_host  # "" se não configurado
```

Settings são loaded uma única vez na startup da app.

---

## Padrões de Erro ML e Tratamento

Resumo de erros comuns do Mercado Livre e como são tratados no sistema.

### Estrutura de Erro ML

API do Mercado Livre retorna JSON estruturado:

```json
{
  "error": "CODE",
  "message": "Human-readable message",
  "cause": [
    {
      "code": "SPECIFIC_CODE",
      "message": "[field_type, field1, field2]",
      "type": "error"
    },
    {
      "code": "WARNING_CODE",
      "message": "This is just a warning",
      "type": "warning"
    }
  ]
}
```

**Regra crítica:** Sempre verificar `cause[].type` — "error" bloqueia, "warning" é informativo (ignorar).

### Erros de Validação de Campo

| Código/Campo | Causa | Detecção | Tratamento |
|--------------|-------|----------|-----------|
| `[invalid_fields, title]` | Title vazio/inválido | `_is_title_invalid_error()` | Remove title, adiciona family_name como fallback |
| `[invalid_fields, family_name]` | Family_name vazio/inválido (não-length) | `_is_family_name_invalid_error()` | Remove family_name, tenta title como fallback |
| `[invalid_fields, family_name]` (length > 120) | Family_name muito longo | `_is_family_name_length_error()` | Trunca para 60 chars, retenta |
| `[required_fields, title]` | Brand account precisa title | `_adjust_payload_for_ml_error()` | Adiciona title do source |
| `[required_fields, family_name]` | Brand account precisa family_name | `_adjust_payload_for_ml_error()` | Adiciona via `_get_family_name()` |
| `[invalid_fields, shipping.methods]` | Shipping methods inválido | `_extract_ml_error_fields()` | Remove shipping.methods (mantém shipping base) |
| `[invalid_fields, shipping]` | Shipping inteiro inválido | Detecção por campo | Remove shipping inteiro |

### Erros de Contas Marca (Brand Accounts / Official Store)

| Erro | Contexto | Detecção | Tratamento |
|------|----------|----------|-----------|
| "official_store_id" required | Create em brand account sem ID | `_is_official_store_id_error()` | `get_seller_official_store_id()` + adiciona ao payload + força `free_shipping: true` |
| "variations incompatible with family_name" | Item tem variations mas dest é brand | `_is_variations_invalid_with_family_name_error()` | Remove variations, força available_quantity top-level |
| "User Product not supported" | Compat copy em User Product item | Fallback detectado 400/403 em compat copy | Fallback para `/user-products/{id}/compatibilities` endpoint |

### Erros de Dimensões

| Erro | Causa | Detecção | Tratamento |
|------|-------|----------|-----------|
| "Missing shipping dimensions" | Categoria requer package dimensions | `_is_dimension_error()` | User deve fornecer dimensions via `/copy/with-dimensions` endpoint |

### Erros de Taxa (Rate Limiting)

| Status | Causa | Retry | Espera |
|--------|-------|-------|--------|
| 429 Too Many Requests | Limite da API ML | Sim, até 5x | 3s + exponential backoff (dobra cada vez, máx 24s) |
| 429 em compat calls | Muitas compat requests | Sim, com pacing | Automático: 1s entre batches |

**Estratégia de retry:** `_post_with_retry()` implementa automático backoff.

### Erros de Autenticação / Autorização

| Status | Causa | Detecção | Tratamento |
|--------|-------|----------|-----------|
| 400/401 em token refresh | Refresh token revogado | Status 400/401 em refresh POST | Clear tokens na DB, lança RuntimeError "refresh token inválido ou revogado" |
| 403 Forbidden | Seller sem permissão | `MlApiError` com status 403 | Lança erro — user precisa reconnect seller |
| 401 Unauthorized | Access token inválido | `MlApiError` com status 401 | Auto-refresh via `_get_token()` retry |

### Erros de Recurso Não Encontrado

| Status | Contexto | Tratamento |
|--------|----------|-----------|
| 404 item não existe | GET `/items/{invalid_id}` | Lança MlApiError — user vê erro |
| 404 no description GET | Item sem description | Retorna `{}` (não é erro) |
| 404 em compat GET | Item sem compatibilities | Retorna `None` (não é erro) |
| 404 em compat POST | Item destino não existe | Lança erro |

### Logging e Debugging

**Cada tentativa falhada de create_item é logged em `api_debug_logs` com:**
- `action`: "create_item"
- `source_seller`, `dest_seller`, `source_item_id`, `dest_item_id`
- `api_method`, `api_url` (endpoint do ML)
- `request_payload`: JSON enviado (truncado a 50KB)
- `response_status`: HTTP status
- `response_body`: JSON de resposta (com cause[])
- `error_message`: extracted detail string
- `attempt_number`: 1, 2, 3, ou 4
- `adjustments`: list de ações (e.g., ["removed title", "added family_name"])
- `resolved`: true se item foi criado após retries

**Debugging workflow:**

1. Consultar `api_debug_logs` para a tentativa falhada
2. Examinar `response_body.cause[]` — quais campos exatamente são problema?
3. Verificar `request_payload` — qual valor foi enviado?
4. Comparar com payload esperado — qual campo está faltando ou inválido?
5. Se padrão novo de erro, documentar em `error-history.yaml`

---

## Diagrama de Fluxos Principais

### Copy de Item (Happy Path)

```
User POST /api/copy
  ↓
copy_items(source, [dest1, dest2], [item1])
  ↓
Para cada item:
  ├─ Insert log "in_progress"
  ├─ Para cada dest:
  │   ├─ copy_single_item()
  │   │   ├─ GET /items/{item_id} (source)
  │   │   ├─ GET /items/{item_id}/description (source)
  │   │   ├─ GET /items/{item_id}/compatibilities (source)
  │   │   ├─ Build payload (_build_item_payload)
  │   │   ├─ Loop retry (até 4):
  │   │   │   ├─ POST /items (create em dest)
  │   │   │   └─ Se erro: ajusta + retenta
  │   │   ├─ POST /items/{new_id}/description (dest)
  │   │   └─ POST /items/{new_id}/compatibilities (dest)
  │   └─ Return {status, dest_item_id, error}
  ├─ Aggregate resultados
  └─ Update log com status final
  ↓
Return lista de resultados
```

### Copy com Dimensions

```
User POST /api/copy/with-dimensions
  ↓
copy_with_dimensions(source, [dest1, dest2], item, {height, width, ...})
  ↓
1. Build dimension attributes
   ↓
2. PUT /items/{item_id} (add dimensions to source)
   ↓
3. Para cada dest:
   └─ copy_single_item() (item agora tem dimensions)
   ↓
4. Return resultados
```

### Copy de Compatibilidades

```
User POST /api/compat/copy
  ↓
copy_compat_to_targets(source_item_id, [target1, target2, ...], skus)
  ↓
1. Resolve source seller
2. GET /items/{source}/compatibilities (pre-fetch products)
   ↓
3. Para cada target (com pacing 1s):
   ├─ POST /items/{target_id}/compatibilities
   │   └─ Se 400/403 "User Product": fallback para /user-products/{id}/compatibilities
   └─ Return {status, error}
   ↓
4. Aggregate resultados + Update compat_logs
5. Return resultados
```

---

## Resumo de Campos Críticos

### Item Source → Destination Payload Mapping

| Source Field | Destination Payload Field | Notas |
|--------------|---------------------------|-------|
| `id` | — | Skipped, nova ID gerada |
| `title` | `title` | Excluído para User Products, fallback family_name |
| `family_name` | `family_name` | Brand accounts |
| `seller_custom_field` | `seller_custom_field` | SKU do seller |
| `category_id` | `category_id` | Copiado |
| `price` | `price` | Copiado |
| `currency_id` | `currency_id` | Copiado (BRL) |
| `available_quantity` | `available_quantity` | Copiado (ou por variation se existem variations) |
| `condition` | `condition` | Copiado |
| `buying_mode` | `buying_mode` | Copiado |
| `pictures[].secure_url` | `pictures[].source` | URLs copiadas (NÃO picture IDs) |
| `attributes` | `attributes` | Filtrado (removed EXCLUDED_ATTRIBUTES) |
| `variations` | `variations` | Copiado (exceto para User Products em create) |
| `shipping` | `shipping` | mode="me2", local_pickup=false, free_shipping copiado |
| `sale_terms` | `sale_terms` | Copiado |
| `channels` | `channels` | Copiado (exceto safe_mode) |
| `video_id` | `video_id` | Copiado (exceto safe_mode) |
| `tags` | — | Skipped |
| `status` | — | Skipped, novo item é "active" |
| `description.plain_text` | POST /items/{id}/description | Copiado em step separado |
| `compatibilities` | POST /items/{id}/compatibilities | Copiado em step separado |

---

## Notas de Implementação Importantes

### 1. Tokens Nunca Hardcoded

Tokens são SEMPRE obtidos via `_get_token()` que auto-refresha. Nunca passar token direto entre funções.

### 2. Per-Seller Locks Essencial

Token refresh sem locks causa race conditions que revogam refresh tokens. Locks são per-seller porque diferentes sellers podem refresh em paralelo.

### 3. Official Store ID é Seller-Specific

Não pode ser copiado cross-account. Deve ser descoberto via API se necessário (inspecionando items existentes).

### 4. Picture URLs, Não IDs

Picture IDs falham frequentemente em cross-account create. Sempre usar `secure_url` ou `url`.

### 5. User Products API É Diferente

- Não aceitam title na criação (usam family_name)
- Não aceitam variations na criação
- Compatibilidades via `/user-products/{id}/compatibilities` em vez de `/items/{id}/compatibilities`

### 6. Shipping Mode me2 vs me1

- me1 (Full) = Mercado Livre full logistics — seller-specific
- me2 (Standard) = seller responsável — copiável cross-account

### 7. Safe Mode é Fallback Nuclear

Depois de 3 tentativas normais, payload é rebuild minimalista (only essential fields). Garante que mesmo payloads problemáticos eventuellement criam item.

### 8. Dimension Errors São User-Facing

Quando copy falha por dimensions faltantes, user recebe `status: "needs_dimensions"` e pode retry com `/copy/with-dimensions` endpoint.

### 9. Logging Extensivo para Debugging

`api_debug_logs` captura cada tentativa falhada com payload completo. Essencial para investigar problemas nuances do ML.

### 10. Compat Copy é Tolerante

Se compat copy falha, main item copy já passou. Erro de compat não falha item copy (logged separadamente).

---

## Conclusão

Este sistema implementa cópia robusta de anúncios com:
- **Autenticação OAuth2** com refresh automático e locks por-seller
- **Retry inteligente** com ajustes específicos de error
- **Safe mode** para payloads problemáticos
- **Logging extensivo** para debugging
- **Compatibilidade** com regular items E brand accounts (official stores, User Products)
- **Rate limiting handling** com exponential backoff
- **Gerenciamento de dimensões** para categorias que exigem

O código prioriza resiliência e debugging — erros são capturados, adjusted, retried, e fully logged.
