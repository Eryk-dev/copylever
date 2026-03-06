# PRD: Shopee Integration — Copy de Anuncios entre Contas Shopee

## 1. Introduction/Overview

Estender a plataforma Copy Anuncios para suportar a **Shopee** como segunda marketplace, permitindo copiar anuncios (produtos) entre lojas Shopee conectadas. A integracao reutiliza toda a infraestrutura existente (auth, billing, multi-tenant, RBAC) e adiciona um fluxo paralelo ao do Mercado Livre, com tab dedicada no frontend.

**O que ja esta pronto (Phase 1 — Foundation):**
- `app/config.py` — settings Shopee (partner_id, partner_key, redirect_uri, sandbox)
- `app/services/shopee_api.py` — cliente API com HMAC-SHA256 signing, token management, wrappers de produto/logistica/media
- `app/routers/auth_shopee.py` — OAuth2 flow completo (install, callback, list/rename/delete shops)
- `app/db/migrations/011_shopee_sellers.sql` — tabelas `shopee_sellers` e `shopee_copy_logs`
- Tabelas aplicadas no Supabase

**O que falta (este PRD):**
- Copy engine Shopee (payload transform, image upload, product creation, retry)
- Copy router Shopee (endpoints de copy, preview, logs, resolve-sellers)
- Permissoes Shopee por shop (user_permissions para shops)
- Frontend: tab Shopee, ShopeeCopyPage, ShopeeCopyForm, ShopeeCopyProgress
- Admin: secao de Shopee sellers no painel admin
- Integracao com trial/billing (trial_copies contam Shopee tambem)
- Debug logging para falhas de API Shopee

---

## 2. Goals

- Permitir que usuarios copiem produtos entre lojas Shopee conectadas a mesma org
- Manter paridade funcional com o fluxo ML (preview, copy, retry dimensoes, logs)
- Reutilizar 100% da infraestrutura existente (auth, billing, trial, RBAC)
- Suportar imagens (upload obrigatorio), descricao, variacoes e atributos obrigatorios por categoria
- Respeitar rate limits da Shopee (100 req/min) com throttling inteligente
- Interface clara e separada (tab propria) para nao confundir fluxos ML vs Shopee

---

## 3. User Stories

### US-201: Copy de produto Shopee simples (sem variacoes)

**Description:** As a user com permissao, I want to copiar um produto Shopee de uma loja source para uma ou mais lojas destino so that o produto fique publicado nas lojas destino com os mesmos dados.

**Acceptance Criteria:**
- [ ] User cola um ou mais item_ids Shopee (numeros inteiros) no textarea
- [ ] Sistema auto-detecta qual loja source possui cada item (resolve-sellers)
- [ ] User seleciona lojas destino (filtradas por permissao can_copy_to)
- [ ] Sistema faz upload das imagens do source na loja destino via `/api/v2/media_space/upload_image`
- [ ] Sistema cria o produto via `/api/v2/product/add_item` com: item_name, description, category_id, price, stock, weight, images, logistics, atributos obrigatorios
- [ ] Resultado exibe status por item/destino (success, error, needs_dimensions)
- [ ] Log salvo em `shopee_copy_logs` com status final, dest_item_ids, error_details
- [ ] Trial counter incrementado por copia bem-sucedida

---

### US-202: Copy de produto Shopee com variacoes (models/tiers)

**Description:** As a user, I want to copiar produtos que possuem variacoes (cor, tamanho) so that as variacoes sejam preservadas na loja destino.

**Acceptance Criteria:**
- [ ] Sistema detecta se item source tem variacoes via `/api/v2/product/get_model_list`
- [ ] Variacoes copiadas com: tier_variation (nome + opcoes), model (preco + estoque por combinacao)
- [ ] SKU por variacao preservado quando existente
- [ ] Se API rejeitar variacoes, sistema tenta criar sem variacoes e reporta warning

---

### US-203: Preview de produto Shopee antes de copiar

**Description:** As a user, I want to ver um preview do produto antes de copiar so that eu possa confirmar que e o produto correto.

**Acceptance Criteria:**
- [ ] Endpoint `GET /api/shopee/copy/preview/{item_id}` retorna dados resumidos
- [ ] Preview mostra: nome, preco, estoque, categoria, thumbnail, qtd imagens, qtd variacoes, status
- [ ] Preview exibido no frontend em card com layout similar ao ML preview
- [ ] Erro claro se item nao encontrado ou shop nao conectada

---

### US-204: Retry com dimensoes para erros de logistica Shopee

**Description:** As a user, I want to fornecer dimensoes (altura, largura, comprimento, peso) quando a Shopee rejeitar por falta de dimensoes so that o produto possa ser criado com sucesso.

**Acceptance Criteria:**
- [ ] Quando API retorna erro de dimensoes, status do resultado = `needs_dimensions`
- [ ] Frontend exibe DimensionForm inline (reusa componente existente)
- [ ] Endpoint `POST /api/shopee/copy/with-dimensions` aceita dimensoes e retenta
- [ ] Dimensoes em cm (altura/largura/comprimento) e gramas (peso), convertidas para kg para API
- [ ] Log atualizado com resultado do retry

---

### US-205: Historico de copias Shopee (logs)

**Description:** As a user, I want to ver o historico de copias Shopee so that eu possa acompanhar operacoes passadas.

**Acceptance Criteria:**
- [ ] Endpoint `GET /api/shopee/copy/logs` retorna logs paginados (50 por pagina)
- [ ] Logs filtrados por org_id (data isolation)
- [ ] Admins veem todos os logs da org; operators veem apenas seus proprios
- [ ] Frontend exibe tabela com: data, origem, destino(s), item_id, status, novos IDs
- [ ] Filtro por status (todos, success, error, needs_dimensions)

---

### US-206: Auto-detect source shop (resolve sellers)

**Description:** As a user, I want que o sistema detecte automaticamente qual loja e a source de cada item_id so that eu nao precise selecionar manualmente.

**Acceptance Criteria:**
- [ ] Endpoint `POST /api/shopee/copy/resolve-sellers` recebe lista de item_ids
- [ ] Sistema testa cada shop conectada da org em paralelo (com semaphore para rate limit)
- [ ] Retorna: `{results: [{item_id, shop_slug}], errors: [{item_id, error}]}`
- [ ] Filtrado por permissoes do user (apenas shops com can_copy_from)

---

### US-207: Permissoes Shopee por shop

**Description:** As a admin, I want to configurar permissoes de copy por shop Shopee para cada operator so that o acesso seja granular.

**Acceptance Criteria:**
- [ ] Endpoint de permissoes lista shops Shopee junto com sellers ML
- [ ] Cada shop tem can_copy_from e can_copy_to por user
- [ ] Permissoes salvas em `user_permissions` usando slug do shop como seller_slug
- [ ] Admin UI de permissoes mostra shops Shopee com label "[Shopee]" para diferenciar de ML
- [ ] Operators filtram shops por suas permissoes no frontend

---

### US-208: Admin — Conectar/gerenciar lojas Shopee

**Description:** As a admin, I want to conectar e gerenciar lojas Shopee no painel admin so that operators possam copiar entre elas.

**Acceptance Criteria:**
- [ ] Secao "Lojas Shopee" no painel Admin (abaixo da secao ML existente)
- [ ] Botao "Autorizar loja Shopee" → redireciona para OAuth Shopee
- [ ] Lista de shops conectadas com: nome, shop_id, status do token, data de conexao
- [ ] Rename inline (mesmo padrao do ML)
- [ ] Botao "Desconectar" com confirmacao
- [ ] Badge Shopee (cor laranja #EE4D2D) para diferenciar de ML

---

### US-209: Frontend — Tab Shopee no menu principal

**Description:** As a user, I want to ver uma tab "Shopee" no menu principal so that eu possa acessar a funcionalidade de copy Shopee.

**Acceptance Criteria:**
- [ ] Tab "Shopee" aparece entre "Copy" (ML) e "Compat" no nav
- [ ] Visibilidade segue mesma logica de permissoes que "Copy" (admin ou operator com permissoes)
- [ ] Tab renderiza `ShopeeCopyPage` com mesma estrutura visual do CopyPage
- [ ] Cores de accent usam laranja Shopee (#EE4D2D) para diferenciar visualmente

---

### US-210: Super Admin — Stats Shopee por org

**Description:** As a super_admin, I want to ver estatisticas de uso Shopee por org so that eu possa monitorar a adocao.

**Acceptance Criteria:**
- [ ] Endpoint `GET /api/super/orgs` inclui `shopee_seller_count` e `shopee_copy_count` por org
- [ ] SuperAdminPage exibe colunas adicionais para Shopee

---

## 4. Functional Requirements

### Backend — Copy Engine (`app/services/shopee_copier.py`)

**FR-1:** O sistema deve buscar dados completos do item source via:
- `GET /api/v2/product/get_item_base_info` (nome, preco, estoque, categoria, imagens, atributos)
- `GET /api/v2/product/get_item_extra_info` (descricao, logistica)
- `GET /api/v2/product/get_model_list` (variacoes/models)

**FR-2:** O sistema deve fazer upload de todas as imagens do source para a loja destino:
- Extrair URLs das imagens do source (`image.image_url_list`)
- Para cada imagem: `POST /api/v2/media_space/upload_image` com campo `url` (form-data)
- Coletar `image_id` retornados para usar no payload de criacao
- Maximo 9 imagens por produto
- Timeout de 60s por upload (imagens podem ser grandes)
- Retry 1x em caso de falha de upload

**FR-3:** O sistema deve construir payload de criacao com campos obrigatorios:
```python
{
    "item_name": str,          # max 120 chars (BR market)
    "description": str,        # max 3000 chars
    "original_price": float,   # preco em BRL
    "normal_stock": int,       # estoque disponivel
    "category_id": int,        # mesma categoria do source
    "image": {
        "image_id_list": [str] # IDs das imagens uploaded
    },
    "weight": float,           # peso em kg (source pode ser em gramas)
    "dimension": {             # dimensoes em cm (opcional mas recomendado)
        "package_height": int,
        "package_width": int,
        "package_length": int,
    },
    "logistic_info": [         # pelo menos 1 canal logistico habilitado
        {"logistic_id": int, "enabled": True}
    ],
    "item_sku": str,           # SKU do item (opcional)
    "condition": "NEW",        # condicao
    "pre_order": {             # pre-order config
        "is_pre_order": False,
        "days_to_ship": 2      # default 2 dias
    },
    "brand": {                 # marca (opcional)
        "brand_id": int,
        "original_brand_name": str
    },
    "attribute_list": [        # atributos obrigatorios por categoria
        {"attribute_id": int, "attribute_value_list": [{"value_id": int}]}
    ],
}
```

**FR-4:** O sistema deve buscar canais logisticos da loja destino via `GET /api/v2/logistics/get_channel_list` e habilitar os mesmos canais que o source usa. Se nenhum match, habilitar todos os canais ativos da loja destino.

**FR-5:** O sistema deve buscar atributos obrigatorios da categoria via `GET /api/v2/product/get_attributes` e copiar do source. Atributos obrigatorios sem valor no source devem gerar warning (nao bloquear).

**FR-6:** Para produtos com variacoes, o sistema deve:
- Copiar `tier_variation` (nomes e opcoes) do source
- Copiar `model` (preco, estoque, SKU por combinacao) do source
- Usar `POST /api/v2/product/add_item` com campos de variacao incluidos
- Se variacoes falharem, tentar sem variacoes e reportar warning

**FR-7:** O sistema deve implementar retry com ate 3 tentativas:
- Tentativa 1: payload completo
- Tentativa 2: remove campos opcionais problematicos (brand, attributes nao-obrigatorios)
- Tentativa 3: payload minimo (nome, descricao, preco, estoque, categoria, imagens, peso, logistica)
- Cada tentativa logada em `api_debug_logs`

**FR-8:** Rate limiting: maximo 100 req/min para API Shopee. Implementar:
- Semaphore global de 80 concurrent requests (margem de seguranca)
- Sleep de 0.7s entre calls sequenciais de copy
- Exponential backoff em respostas com erro de rate limit

### Backend — Copy Router (`app/routers/shopee_copy.py`)

**FR-9:** `POST /api/shopee/copy` — aceita `ShopeeCopyRequest`:
```python
class ShopeeCopyRequest(BaseModel):
    source: str                    # shop slug
    destinations: list[str]        # shop slugs
    item_ids: list[str]            # item IDs (numeros como string)
```
- Valida permissoes (can_copy_from source, can_copy_to cada destino)
- Checa trial limit (mesmo counter de trial_copies_used, compartilhado com ML)
- Normaliza item_ids para int
- Chama `shopee_copier.copy_items()` para cada item/destino
- Retorna `{total, success, errors, needs_dimensions, results}`
- Incrementa trial counter por copias bem-sucedidas

**FR-10:** `POST /api/shopee/copy/with-dimensions` — retry com dimensoes:
```python
class ShopeeCopyWithDimensionsRequest(BaseModel):
    source: str
    destinations: list[str]
    item_id: str
    dimensions: Dimensions  # height, width, length (cm), weight (g)
```

**FR-11:** `GET /api/shopee/copy/preview/{item_id}` — preview resumido:
- Auto-detect shop via resolve
- Retorna: nome, preco, estoque, categoria, thumbnail, qtd_imagens, qtd_variacoes, status

**FR-12:** `GET /api/shopee/copy/logs` — logs paginados:
- Query `shopee_copy_logs` com org_id filter
- Admins: todos da org. Operators: apenas user_id proprio
- Paginacao: `?page=1` (50 por pagina)

**FR-13:** `POST /api/shopee/copy/resolve-sellers` — auto-detect shop:
- Recebe `{item_ids: [str]}`
- Para cada shop ativa da org (paralelo com semaphore 5):
  - `GET /api/v2/product/get_item_base_info?item_id_list=ID`
  - Se retornar dados, essa shop e a source
- Retorna `{results: [{item_id, shop_slug}], errors: [{item_id, error}]}`
- Filtra por can_copy_from do user

### Backend — Permissoes

**FR-14:** `user_permissions` usa slug do shop Shopee como `seller_slug` (nao cria tabela separada):
- Slugs de shops Shopee nunca colidem com slugs ML (Shopee slugs gerados do shop_name)
- Se houver risco de colisao, prefixar com `shopee:` (ex: `shopee:minha-loja`)
- Endpoints `GET/PUT /api/admin/users/{id}/permissions` retornam shops Shopee junto com sellers ML
- Cada entry tem campo `platform: "ml" | "shopee"` no response (frontend precisa diferenciar)

**FR-15:** Endpoint de permissoes do admin_users.py deve listar sellers ML + shops Shopee:
- Query `copy_sellers` + `shopee_sellers` com org_id filter
- Merge results com platform label
- Upsert `user_permissions` com seller_slug (funciona para ambos)

### Backend — Billing/Trial

**FR-16:** Trial counter e compartilhado: copias ML + Shopee somam no mesmo `trial_copies_used`. Nao criar contador separado.

**FR-17:** `require_active_org` ja gatea acesso para ambos (ja implementado).

### Backend — Super Admin

**FR-18:** `GET /api/super/orgs` inclui contagem de shopee_sellers e shopee_copy_logs por org (subqueries adicionais).

### Frontend — Tipos (`lib/api.ts`)

**FR-19:** Adicionar tipos Shopee:
```typescript
interface ShopeeSeller {
  slug: string
  name: string
  shop_id: number
  token_valid: boolean
  token_expires_at: string | null
  created_at: string
}

interface ShopeeCopyResult {
  source_item_id: string       // Shopee item ID (number as string)
  dest_seller: string          // shop slug
  status: 'success' | 'error' | 'pending' | 'needs_dimensions'
  dest_item_id: string | null  // new item ID
  error: string | null
  sku?: string | null
}

interface ShopeeCopyResponse {
  total: number
  success: number
  errors: number
  needs_dimensions?: number
  results: ShopeeCopyResult[]
}

interface ShopeeItemPreview {
  item_id: number
  item_name: string
  original_price: number
  currency: string
  stock: number
  category_id: number
  status: string
  image_url: string            // primeira imagem
  image_count: number
  model_count: number          // qtd variacoes
  has_description: boolean
  weight: number               // kg
}
```

### Frontend — Auth Hook (`hooks/useAuth.ts`)

**FR-20:** Adicionar estado `shopeeSellers`:
- Nova funcao `loadShopeeSellers()` que chama `GET /api/shopee/sellers`
- Nova funcao `disconnectShopeeSeller(slug)` que chama `DELETE /api/shopee/sellers/{slug}`
- Retornar `shopeeSellers`, `loadShopeeSellers`, `disconnectShopeeSeller` no hook

### Frontend — App.tsx

**FR-21:** Adicionar tab "Shopee" ao menu:
- Tipo View: `'copy' | 'shopee' | 'compat' | 'admin' | 'super'`
- Visibilidade: admin OR (operator com pelo menos 1 permissao shopee can_copy_from AND can_copy_to)
- Renderizar `ShopeeCopyPage` quando `activeView === 'shopee'`
- Props: `shopeeSellers`, `headers`, `user`

**FR-22:** Adicionar connect Shopee screen quando org tem 0 shopee_sellers e admin acessa tab Shopee.

### Frontend — ShopeeCopyPage (`pages/ShopeeCopyPage.tsx`)

**FR-23:** Pagina completa com mesma estrutura do CopyPage:
- `ShopeeCopyForm` (textarea de item_ids, auto-resolve, selecao de destinos)
- Preview cards
- `ShopeeCopyProgress` (resultados com DimensionForm inline)
- Secao de logs (collapsible, paginada, filtro por status)
- Polling de logs a cada 5s enquanto houver status `in_progress`

**FR-24:** Normalizacao de item IDs Shopee:
- Aceitar numeros puros (ex: `1234567890`)
- Aceitar com prefixo (ex: `SHP1234567890` → `1234567890`)
- Aceitar URLs da Shopee (ex: `https://shopee.com.br/product/123/456` → extrair item_id `456`)
- Deduplicar

### Frontend — Admin.tsx

**FR-25:** Adicionar secao "Lojas Shopee" abaixo de "Contas ML":
- Mesmo layout: card com lista de shops, rename inline, disconnect
- Botao "Autorizar loja Shopee" → `GET /api/shopee/install` → redirect
- Badge laranja Shopee nos nomes
- Separador visual entre secoes ML e Shopee

**FR-26:** Na tela de permissoes de usuario, listar shops Shopee com label "[Shopee]":
- Diferenciar visualmente de sellers ML (cor/badge)
- Mesmos toggles can_copy_from, can_copy_to

### Frontend — SuperAdminPage.tsx

**FR-27:** Adicionar colunas `shopee_sellers` e `shopee_copies` na tabela de orgs.

---

## 5. Non-Goals (Out of Scope)

- **Compatibilidade veicular Shopee** — Shopee nao tem API de compatibilidade
- **Edicao/atualizacao de produtos existentes** — apenas criacao (copy)
- **Sincronizacao de estoque/preco** — copia e pontual, nao sincroniza
- **Copy cross-platform** (ML → Shopee ou Shopee → ML) — apenas same-platform
- **Shopee Ads / campanhas** — fora do escopo
- **Multi-country** — apenas Shopee Brasil (shopee.com.br) nesta versao
- **Wholesale pricing** — copiar apenas preco normal, nao tiers de atacado
- **Video upload** — apenas imagens nesta versao
- **Size charts** — nao copiar size charts nesta versao
- **Shopee Premium / Shopee Mall** — tratar como loja normal

---

## 6. Technical Considerations

### Shopee API — Limites e Restricoes

| Restricao | Valor | Impacto |
|---|---|---|
| Rate limit global | 100 req/min | Throttling com semaphore + pacing |
| Access token TTL | 4 horas | Auto-refresh ja implementado |
| Refresh token TTL | 30 dias | Reconexao necessaria apos expiracao |
| Imagens por produto | Max 9 | Upload obrigatorio via media_space |
| Tamanho max imagem | 10 MB | Resize se necessario |
| Formatos de imagem | JPG, JPEG, PNG | Converter se necessario |
| Titulo max | 120 chars (BR) | Truncar se source exceder |
| Descricao max | 3000 chars | Truncar se source exceder |
| Variacoes (tier names) | Max 20 chars | Truncar nome do tier |
| Tiers de variacao | Max 2 tiers | Limitar a 2 niveis |
| Auth link expiry | 5 minutos | Gerar URL fresca no install |
| Peso | Obrigatorio, em kg | Converter de g se source usar gramas |
| Logistica | Min 1 canal | Buscar canais ativos da loja destino |
| Atributos obrigatorios | Por categoria | Buscar e copiar do source |

### Shopee API — Fluxo de Criacao de Produto

```
1. GET /api/v2/product/get_item_base_info (source)
2. GET /api/v2/product/get_item_extra_info (source — descricao)
3. GET /api/v2/product/get_model_list (source — variacoes)
4. GET /api/v2/product/get_attributes?category_id=X (dest — attrs obrigatorios)
5. GET /api/v2/logistics/get_channel_list (dest — canais logisticos)
6. POST /api/v2/media_space/upload_image × N (dest — upload imagens)
7. POST /api/v2/product/add_item (dest — criar produto)
8. [Se variacoes] POST /api/v2/product/init_tier_variation (dest — add variacoes)
```

**Calls por copy de 1 item para 1 destino: ~10-15 requests**
(3 source reads + 2 dest queries + N image uploads + 1-2 product creation)

**Rate limit budget:** Com 100 req/min, copy de 1 item leva ~10s. Para 10 items = ~2 min. Paralelismo limitado a 2-3 items simultaneos.

### Shopee API — Error Format

Shopee retorna HTTP 200 com campo `"error"` no body:
```json
{
    "error": "error.param_error",
    "message": "Invalid parameter: item_name",
    "request_id": "abc123"
}
```

Erros comuns:
- `error.param_error` — campo invalido/faltando
- `error.permission_denied` — token invalido ou sem permissao
- `error.rate_limit` — rate limit excedido
- `error.logistics_not_supported` — canal logistico nao disponivel
- `error.category_not_leaf` — categoria nao e folha (tem subcategorias)
- `error.image_format_error` — imagem invalida

### Arquivos a Criar

| Arquivo | Descricao | Linhas est. |
|---|---|---|
| `app/services/shopee_copier.py` | Copy engine Shopee | ~500 |
| `app/routers/shopee_copy.py` | Router de copy Shopee | ~350 |
| `frontend/src/pages/ShopeeCopyPage.tsx` | Pagina de copy Shopee | ~400 |
| `frontend/src/components/ShopeeCopyForm.tsx` | Form de copy Shopee | ~250 |
| `frontend/src/components/ShopeeCopyProgress.tsx` | Resultados Shopee | ~200 |

### Arquivos a Modificar

| Arquivo | Mudanca |
|---|---|
| `app/main.py` | Registrar `shopee_copy` router |
| `app/routers/admin_users.py` | Listar shops Shopee nas permissoes |
| `app/routers/super_admin.py` | Incluir stats Shopee |
| `frontend/src/App.tsx` | Tab Shopee, View type, render ShopeeCopyPage |
| `frontend/src/hooks/useAuth.ts` | shopeeSellers state + load/disconnect |
| `frontend/src/lib/api.ts` | Tipos Shopee |
| `frontend/src/pages/Admin.tsx` | Secao "Lojas Shopee" |
| `frontend/src/pages/SuperAdminPage.tsx` | Colunas Shopee |
| `CHANGELOG.md` | Documentar todas as mudancas |
| `CLAUDE.md` | Atualizar rotas e schemas |

### Migracao DB Adicional

**`012_shopee_permissions.sql`** — Nao necessaria se usar `user_permissions` existente (recomendado). Apenas garantir que slugs Shopee nao colidem com ML.

### Dependencias

- Nenhuma dependencia Python nova (httpx, hmac, hashlib ja disponiveis)
- Nenhuma dependencia npm nova (React, Vite, TypeScript ja disponiveis)

---

## 7. Success Metrics

- [ ] Produto Shopee sem variacoes copiado com sucesso entre 2 lojas da mesma org
- [ ] Produto Shopee com variacoes (2 tiers) copiado com sucesso
- [ ] Imagens do source aparecem corretamente no destino
- [ ] Descricao copiada integralmente (ate 3000 chars)
- [ ] Preview mostra dados corretos do item antes de copiar
- [ ] Retry com dimensoes funciona quando API rejeita por falta de dimensoes
- [ ] Logs exibem historico correto, filtrado por org/user
- [ ] Permissoes por shop funcionam (operator so ve shops autorizados)
- [ ] Trial counter compartilhado ML+Shopee funciona
- [ ] Rate limit respeitado (nenhum ban da Shopee)
- [ ] Tab Shopee visivel e funcional no frontend

---

## 8. Implementation Order (Sugestao)

### Phase 2A — Copy Engine Backend (~3 sessoes)

1. `app/services/shopee_copier.py`:
   - `_fetch_source_item()` — busca dados completos do source
   - `_upload_images()` — upload de imagens para loja destino
   - `_fetch_dest_logistics()` — busca canais logisticos do destino
   - `_fetch_category_attributes()` — busca atributos obrigatorios
   - `_build_shopee_payload()` — constroi payload de criacao
   - `_adjust_payload_for_error()` — ajusta payload baseado no erro
   - `copy_single_item()` — copy 1 item para 1 destino com retry
   - `copy_items()` — bulk copy com logging
   - `copy_with_dimensions()` — retry com dimensoes

2. `app/routers/shopee_copy.py`:
   - POST `/api/shopee/copy`
   - POST `/api/shopee/copy/with-dimensions`
   - GET `/api/shopee/copy/preview/{item_id}`
   - GET `/api/shopee/copy/logs`
   - POST `/api/shopee/copy/resolve-sellers`

3. Modificar `app/routers/admin_users.py` — incluir shops Shopee nas permissoes

4. Modificar `app/routers/super_admin.py` — incluir stats Shopee

5. Registrar router em `app/main.py`

### Phase 2B — Frontend (~2 sessoes)

6. `frontend/src/lib/api.ts` — tipos Shopee
7. `frontend/src/hooks/useAuth.ts` — shopeeSellers
8. `frontend/src/components/ShopeeCopyForm.tsx`
9. `frontend/src/components/ShopeeCopyProgress.tsx`
10. `frontend/src/pages/ShopeeCopyPage.tsx`
11. `frontend/src/App.tsx` — tab Shopee
12. `frontend/src/pages/Admin.tsx` — secao Shopee
13. `frontend/src/pages/SuperAdminPage.tsx` — stats Shopee

### Phase 2C — Polish (~1 sessao)

14. Testar fluxo completo com conta sandbox
15. Ajustar error handling baseado em erros reais
16. Atualizar `CHANGELOG.md`, `CLAUDE.md`, `docs/API.md`

---

## 9. Open Questions

1. **Shopee partner credentials**: O app Shopee ja foi aprovado? Temos partner_id e partner_key? (necessario para qualquer teste)
2. **Sandbox vs Production**: Usar sandbox para desenvolvimento? (config `SHOPEE_SANDBOX=true` ja existe)
3. **Categorias cross-shop**: Se source e destino estiverem em categorias diferentes (Shopee pode ter arvore diferente por loja?), como resolver?
4. **Atributos obrigatorios sem valor**: Warning ou erro? (sugestao: warning, criar sem o atributo e reportar)
5. **Slug collision ML vs Shopee**: Prefixar slugs Shopee com `shopee:` ou confiar que nao colidem? (sugestao: nao prefixar, colisao improvavel e complicaria queries)
