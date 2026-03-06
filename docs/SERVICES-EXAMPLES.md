# Exemplos Práticos e Troubleshooting

Guia com exemplos reais de uso dos serviços e resolução de problemas comuns.

---

## Exemplos de Uso

### 1. Copy Simples de Item

**Cenário:** User quer copiar um item de "seller_origem" para "seller_destino".

```python
from app.services.item_copier import copy_single_item

# Frontend envia request
result = await copy_single_item(
    source_seller="seller_origem",
    dest_seller="seller_destino",
    item_id="MLBxxxx123",
    user_email="user@example.com",
    user_id="user_123",
    copy_log_id=42,  # Log ID para tracking
    org_id="org_456"
)

# Resultado possível:
{
    "source_item_id": "MLBxxxx123",
    "dest_seller": "seller_destino",
    "status": "success",
    "dest_item_id": "MLBxxxx456",  # Novo item criado
    "error": None,
    "sku": "SKU123",  # SKU do item copiado
}
```

**O que acontece internamente:**

1. GET `/items/MLBxxxx123` no seller_origem → extrai todos os dados
2. Build payload com título, preço, pictures, atributos, etc.
3. POST `/items` no seller_destino com payload
4. Se erro (ex: title inválido):
   - Extrai erro structured
   - Remove title, adiciona family_name
   - Retry com payload ajustado
5. Se sucesso: POST description, POST compatibilities
6. Log resultado em DB para auditoria

---

### 2. Copy com Retry Automático (Safe Mode)

**Cenário:** Item tem estrutura complexa que falha na primeira tentativa.

**Request:**
```json
POST /api/copy
{
  "source_seller": "seller_origem",
  "dest_sellers": ["seller_destino"],
  "item_ids": ["MLBxxxx123"]
}
```

**Fluxo interno (4 tentativas):**

```
Tentativa 1: Payload completo (title, family_name, variations, channels, video_id)
  → Erro: "[invalid_fields, variations]"
  → Ação: Remove variations, adiciona available_quantity top-level

Tentativa 2: Payload ajustado (sem variations, mas com título, family_name, channels)
  → Erro: "[invalid_fields, title, family_name]"
  → Ação: Remove title e family_name, busca fallback

Tentativa 3: Payload ajustado (sem título/family_name, com channels, video_id)
  → Erro: "[invalid_fields, channels]"
  → Ação: Ativa safe_mode

Tentativa 4: Safe payload (mínimo: categoria, preço, quantidade, pictures, condition)
  → Sucesso! Item criado com ID MLBxxxx456
  → Marca api_debug_logs como "resolved"
```

**Resultado para o user:**
```json
{
  "status": "success",
  "dest_item_id": "MLBxxxx456",
  "error": null
}
```

---

### 3. Copy Bloqueado por Dimensões Faltantes

**Cenário:** Item é da categoria "Peças de Carro" que requer shipping dimensions.

**Request:**
```json
POST /api/copy
{
  "source_seller": "seller_origem",
  "dest_sellers": ["seller_destino"],
  "item_ids": ["MLBxxxx123"]
}
```

**Resposta:**
```json
{
  "status": "needs_dimensions",
  "dest_item_id": null,
  "error": "Item sem dimensoes de envio. Informe as dimensoes para continuar."
}
```

**O que user faz:**
1. Obtém dimensões do produto
2. Faz novo request com dimensions:

```json
POST /api/copy/with-dimensions
{
  "source_seller": "seller_origem",
  "dest_sellers": ["seller_destino"],
  "item_id": "MLBxxxx123",
  "dimensions": {
    "height": 10,
    "width": 20,
    "length": 30,
    "weight": 1000
  }
}
```

**Fluxo:**
1. Build dimension attributes (SELLER_PACKAGE_*)
2. PUT `/items/MLBxxxx123` no source (adiciona dimensions)
3. Copy item (agora tem dimensions, deve passar)

---

### 4. Copy de Múltiplos Items para Múltiplos Sellers

**Cenário:** Copy 5 items para 3 sellers (15 operações totais).

**Request:**
```json
POST /api/copy
{
  "source_seller": "seller_origem",
  "dest_sellers": ["seller_destino1", "seller_destino2", "seller_destino3"],
  "item_ids": ["MLBxxxx1", "MLBxxxx2", "MLBxxxx3", "MLBxxxx4", "MLBxxxx5"]
}
```

**Processamento:**
- Para cada item:
  1. INSERT `copy_logs` com status "in_progress"
  2. Para cada dest_seller:
     - Chama `copy_single_item()`
     - Coleta resultado (success/error)
  3. UPDATE `copy_logs` com status final + mapping de IDs

**Resposta:**
```json
{
  "results": [
    {
      "source_item_id": "MLBxxxx1",
      "dest_seller": "seller_destino1",
      "status": "success",
      "dest_item_id": "MLByyyy1"
    },
    {
      "source_item_id": "MLBxxxx1",
      "dest_seller": "seller_destino2",
      "status": "error",
      "error": "Seller desconectado. Reconecte via /api/ml/install"
    },
    ...
  ]
}
```

---

### 5. Copy de Compatibilidades Veiculares

**Cenário:** Item source tem compatibilidades com 50 veículos, copy para 3 items destino.

**Request:**
```json
POST /api/compat/copy
{
  "source_item_id": "MLBxxxx123",
  "targets": [
    {"seller_slug": "seller1", "item_id": "MLByyyy1"},
    {"seller_slug": "seller2", "item_id": "MLByyyy2"},
    {"seller_slug": "seller3", "item_id": "MLByyyy3"}
  ],
  "skus": ["SKU1", "SKU2"]  # Opcional, para logging
}
```

**Processamento:**
1. Resolve seller source (tenta GET item em cada seller conectado)
2. GET `/items/MLBxxxx123/compatibilities` (pre-fetch)
3. Para cada target item (com pacing 1s):
   - POST `/items/{target_id}/compatibilities` com copy from source
   - Se falha com "User Product error": fallback para `/user-products/{id}/compatibilities`
   - Batch products em groups de 200 (limite ML)

**Resposta:**
```json
{
  "results": [
    {
      "seller_slug": "seller1",
      "item_id": "MLByyyy1",
      "status": "ok",
      "error": null
    },
    {
      "seller_slug": "seller2",
      "item_id": "MLByyyy2",
      "status": "error",
      "error": "Item destino não tem compatibilidades habilitadas"
    },
    {
      "seller_slug": "seller3",
      "item_id": "MLByyyy3",
      "status": "ok",
      "error": null
    }
  ],
  "success_count": 2,
  "error_count": 1,
  "status": "partial"
}
```

---

### 6. Busca de SKU em Múltiplos Sellers

**Cenário:** User quer encontrar onde está um produto por SKU.

**Request:**
```json
POST /api/compat/search-sku
{
  "skus": ["SKU001", "SKU002"]
}
```

**Processamento:**
1. Query sellers conectados da org
2. Para cada seller × SKU: busca via `search_items_by_sku()`
   - Tenta `seller_sku` parameter
   - Tenta `sku` parameter
3. Para cada item encontrado: GET dados completos (title, etc.)

**Resposta:**
```json
{
  "results": [
    {
      "seller_slug": "seller_origem",
      "seller_name": "Loja de Origem",
      "item_id": "MLBxxxx123",
      "sku": "SKU001",
      "title": "Peça Automóvel XYZ"
    },
    {
      "seller_slug": "seller_backup",
      "seller_name": "Loja Backup",
      "item_id": "MLBzzzz456",
      "sku": "SKU001",
      "title": "Peça Automóvel XYZ (Cópia)"
    },
    {
      "seller_origem": "seller_origem",
      "seller_name": "Loja de Origem",
      "item_id": "MLBxxxx124",
      "sku": "SKU002",
      "title": "Peça Automóvel ABC"
    }
  ]
}
```

---

## Troubleshooting Guia

### Problema: Copy Falha com "invalid_fields, title"

**Sintomas:**
- Copy retorna erro em todas as tentativas
- `api_debug_logs` mostra `[invalid_fields, title]` no cause

**Causa possível:**
- Title muito longo (>200 chars)
- Title contém caracteres inválidos
- Item é User Product (brand account) — não aceita title

**Debug:**
```sql
SELECT request_payload->'title' as title,
       response_body->>'message' as error_msg
FROM api_debug_logs
WHERE source_item_id = 'MLBxxxx123'
ORDER BY id DESC LIMIT 1;
```

**Solução:**
1. Se title muito longo: system tenta safe_mode automaticamente
2. Se caracteres inválidos: update source item title e retry
3. Se User Product: system deve detectar e usar family_name (verificar logs)

---

### Problema: Copy Falha com "required_fields, official_store_id"

**Sintomas:**
- Copy falha ao criar item em seller destino
- Erro menciona "official_store_id"

**Causa:**
- Dest seller é conta marca (brand account)
- System tentar resolver official_store_id mas não encontrou

**Debug:**
```sql
SELECT source_item_id, dest_seller, response_body
FROM api_debug_logs
WHERE dest_seller = 'seller_destino'
  AND response_body LIKE '%official_store_id%'
ORDER BY id DESC LIMIT 1;
```

**Solução:**
1. Verificar se seller destino tem items ativos:
   - GET `/users/{user_id}/items/search?status=active`
2. Se nenhum item ativo: user precisa criar 1 item manualmente primeiro
3. Depois retry copy — system encontrará official_store_id

---

### Problema: Copy Bloqueado por "needs_dimensions"

**Sintomas:**
- Copy retorna `status: "needs_dimensions"`
- Precisa de shipping dimensions para continuar

**Causa:**
- Categoria do item requer dimensões (ex: Peças de Carro)
- Source item não tem dimensions configuradas

**Solução:**
1. User obtém dimensões do produto (altura, largura, comprimento, peso)
2. POST `/api/copy/with-dimensions`:
   ```json
   {
     "source_seller": "seller_origem",
     "dest_sellers": ["seller_destino"],
     "item_id": "MLBxxxx123",
     "dimensions": {
       "height": 15,
       "width": 25,
       "length": 35,
       "weight": 2000
     }
   }
   ```
3. System aplica dimensions ao source item + retry copy

---

### Problema: Copy de Compatibilidades Falha Silenciosamente

**Sintomas:**
- Item copy sucede, mas compatibilities não são copiadas
- Logs mostram erro em compat copy

**Causa possível:**
- Item destino é User Product (brand account)
- Item destino não tem compatibilidades habilitadas
- Source compat products não foram encontrados

**Debug:**
```sql
SELECT source_item_id, dest_item_id, response_status,
       error_message
FROM api_debug_logs
WHERE action = 'copy_compat'
  AND resolved = false
ORDER BY id DESC LIMIT 5;
```

**Verificação:**
1. Item destino aceitava compatibilities em GET?
   - GET `/items/{dest_item_id}/compatibilities`
2. Se 404: item não tem compat habilitadas (normal)
3. Se 400/403 "User Product": system deve fallback para `/user-products/{id}/compatibilities`

**Solução:**
- Se User Product: verificar se fallback funcionou (batch copy de products)
- Se item não aceita compat: não é erro, apenas ignorado
- Se erro real: checked response_body no log para detalhes

---

### Problema: Token Expirado / Seller Desconectado

**Sintomas:**
- Copy retorna erro: "Seller 'seller_destino' is disconnected"
- Ou: "refresh token inválido ou revogado"

**Causa:**
- User revogou acesso no Mercado Livre
- Refresh token foi revogado
- Session expirou

**Debug:**
```sql
SELECT slug, ml_access_token, ml_token_expires_at
FROM copy_sellers
WHERE slug = 'seller_destino' AND org_id = 'org_id';
```

**Solução:**
1. User precisa reconectar seller via `/api/ml/install`
2. OAuth flow completo
3. Novos access/refresh tokens armazenados
4. Retry copy

---

### Problema: Rate Limit (429 Too Many Requests)

**Sintomas:**
- Múltiplas copies falhando com 429
- ML rejeitando requests

**Causa:**
- Muitas requests simultâneas ao ML
- User ativou copy em muitos items de uma vez

**Mitigações Implementadas:**
- `_post_with_retry()` com exponential backoff automático
- Compatibilities com 1s pacing entre batches
- Semáforo com limit 10 em search_sku_all_sellers

**User Action:**
- Esperar (system retenta automaticamente)
- Se persistente: spread copies ao longo do tempo
- Não fazer copy de 1000 items em paralelo

---

### Problema: Descripção Não Copiada

**Sintomas:**
- Item copy sucede, mas description está vazia no destino

**Causa possível:**
- Source item não tinha description
- Description copy falhou (não é erro fatal)

**Debug:**
```sql
SELECT source_item_id, dest_item_id, action, error_message
FROM api_debug_logs
WHERE action = 'set_description'
  AND error_message IS NOT NULL
ORDER BY id DESC LIMIT 5;
```

**Nota:** Description copy é best-effort — não falha copy se description falhar.

---

### Problema: Picture URL Inválida

**Sintomas:**
- Copy falha com erro sobre pictures

**Causa:**
- Source pictures usam HTTP em vez de HTTPS
- URL picture expirou (temporário)
- Sem acesso cross-account

**Solução implementada:**
- System tenta `secure_url` primeiro (HTTPS), depois `url`
- Se ambas falharem: ML rejeita
- Não há workaround — ML é estrito sobre pictures

---

## Análise de api_debug_logs

Tabela `api_debug_logs` é essencial para debugging. Estrutura:

```sql
CREATE TABLE api_debug_logs (
  id BIGINT PRIMARY KEY,

  -- Context
  action VARCHAR,                    -- create_item, set_description, copy_compat, etc.
  source_seller VARCHAR,
  dest_seller VARCHAR,
  source_item_id VARCHAR,
  dest_item_id VARCHAR,
  user_id VARCHAR,
  copy_log_id INT,
  org_id VARCHAR,

  -- Request
  api_method VARCHAR,                -- POST, PUT, GET
  api_url TEXT,
  request_payload JSONB,
  attempt_number INT,
  adjustments TEXT[],

  -- Response
  response_status INT,               -- 400, 404, 429, etc.
  response_body JSONB,               -- Full ML response with cause[]
  error_message TEXT,

  -- Metadata
  resolved BOOLEAN,
  created_at TIMESTAMP
);
```

**Queries úteis:**

Erros não resolvidos últimas 24h:
```sql
SELECT id, action, source_item_id, dest_seller,
       response_status, error_message, created_at
FROM api_debug_logs
WHERE resolved = false
  AND created_at > now() - interval '24 hours'
ORDER BY created_at DESC;
```

Padrão de erro mais comum:
```sql
SELECT response_body->'cause'->0->>'code' as error_code,
       COUNT(*) as count
FROM api_debug_logs
WHERE resolved = false
GROUP BY error_code
ORDER BY count DESC;
```

Tentativas por item (retry analysis):
```sql
SELECT source_item_id, dest_seller,
       COUNT(*) as total_attempts,
       MAX(attempt_number) as max_attempt,
       MAX(resolved::int) as eventually_succeeded
FROM api_debug_logs
WHERE action = 'create_item'
GROUP BY source_item_id, dest_seller
ORDER BY total_attempts DESC;
```

---

## Performance e Otimização

### Concorrência

**Semáforo em search_sku_all_sellers:**
- Limit 10 concurrent requests
- Evita rate limit do ML
- Searchers × SKUs em paralelo, respeitando limit

**Per-seller token locks:**
- Evita race condition em token refresh
- Máximo 1 refresh por seller por vez
- Timeout 30s (detecta deadlock)

### Timeouts HTTP

- GET/POST regular: 30s
- POST /items (upload): 60s
- Token refresh: 30s

### Pacing

- Compatibilities: 1s entre batches de 200
- Evita 429 rate limit

### Safe Mode

- Ativado após 3 tentativas normais
- Payload minimalista: categoria, preço, quantidade, pictures, condition
- Garante que mesmo itens problemáticos criam

---

## Checklist para Deploy

Antes de deploy, verificar:

- [ ] SUPABASE_SERVICE_ROLE_KEY está configurado (bypass RLS)
- [ ] ML_APP_ID, ML_SECRET_KEY estão corretos
- [ ] ML_REDIRECT_URI bate com configurado no ML Dev Center
- [ ] STRIPE_SECRET_KEY está correto (se billing habilitado)
- [ ] SMTP_HOST está configurado (se email habilitado)
- [ ] BASE_URL é público e acessível para OAuth redirect
- [ ] CORS_ORIGINS inclui frontend URL
- [ ] ADMIN_MASTER_PASSWORD é strong e armazenado seguro

---

## Conclusão

Este guia cobre:
- Exemplos de uso das principais funções
- Scenarios reais e fluxos esperados
- Problemas comuns e soluções
- Debugging via `api_debug_logs`
- Otimizações e considerations de performance

Para issues complexas não cobertas: consultar `error-history.yaml` para padrões conhecidos.
