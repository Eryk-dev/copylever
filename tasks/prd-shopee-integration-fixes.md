# PRD: Correcao Completa da Integracao Shopee

**Data:** 2026-03-06
**Versao:** 1.0
**Status:** Aprovado
**Escopo:** Bugs + DB + Frontend + Seguranca + Performance + Cleanup de codigo morto + Variacoes

---

## 1. Introducao / Visao Geral

Auditoria completa da integracao Shopee (Fases 1 e 2) revelou **43 problemas** distribuidos em 7 categorias: bugs de logica, gaps de banco de dados, falhas de frontend, vulnerabilidades de seguranca, gargalos de performance, features ausentes e divida tecnica. Este PRD organiza todas as correcoes em user stories priorizadas e sequenciadas para implementacao.

**Diagnostico realizado por 5 agentes paralelos:**
- Explorador de documentacao Shopee Open Platform
- Auditor de codigo backend (Python/FastAPI)
- Auditor de schema de banco (Supabase/PostgreSQL)
- Auditor de frontend (React/TypeScript)
- Explorador de configuracao e historico de erros

---

## 2. Objetivos

- Corrigir todos os bugs que causam falha silenciosa ou comportamento incorreto
- Alinhar schema do banco com padroes ja estabelecidos (ML)
- Implementar copia de variacoes/models (feature critica ausente)
- Fechar vulnerabilidades de seguranca no fluxo OAuth e sanitizacao
- Eliminar codigo morto e duplicacoes
- Melhorar performance (image upload, caching de logistics, connection pooling)
- Garantir que retry de dimensoes funcione corretamente no frontend

---

## 3. User Stories

### FASE 1 — BUGS CRITICOS (falhas silenciosas)

---

### US-001: Corrigir `_strip_attributes` que remove todos os atributos no retry

**Descricao:** Como sistema, quero que o retry attempt 2 remova apenas atributos nao-essenciais (brand, etc.) em vez de remover todos, para que itens com atributos obrigatorios nao falhem desnecessariamente.

**Contexto:** `shopee_copier.py:291` filtra por `a.get("is_mandatory")` mas esse campo vem de `get_attributes` (API de categoria), nao de `get_item_base_info`. O campo nunca existe nos atributos do item fonte, entao o filtro retorna lista vazia — removendo TODOS os atributos.

**Acceptance Criteria:**
- [ ] `_strip_attributes()` remove apenas atributos conhecidos como problematicos (brand, etc.) via lista de exclusao, em vez de filtrar por `is_mandatory`
- [ ] Atributos que nao estao na lista de exclusao sao mantidos no retry
- [ ] Se a lista filtrada ficar vazia, o campo `attribute_list` e removido do payload (comportamento atual mantido)
- [ ] Teste manual: item com 5 atributos → retry 2 mantem pelo menos os atributos nao-brand

**Arquivo:** `app/services/shopee_copier.py` linhas 286-297

---

### US-002: Corrigir retry de dimensoes Shopee no frontend (payload errado)

**Descricao:** Como operador, quero que o botao "Informar dimensoes" funcione para copias Shopee que falharam por dimensoes ausentes, para que eu possa reenviar com as dimensoes corretas.

**Contexto:** `CopyPage.tsx:192` envia `{ log_id, dimensions }` para `/api/shopee/copy/with-dimensions`, mas o backend espera `{ source, destinations, item_id, dimensions }`. O endpoint retorna 422 em toda tentativa. O `ShopeeCopyPage.tsx` (codigo morto) tem a implementacao correta.

**Acceptance Criteria:**
- [ ] `handleLogRetry` para platform `'shopee'` reconstroi o payload a partir dos dados do log: `{ source: log.source_seller, destinations: log.dest_sellers, item_id: log.source_item_id, dimensions: dims }`
- [ ] O tipo `CopyLog` no frontend inclui `source_seller`, `dest_sellers`, `source_item_id` para Shopee logs
- [ ] Retry Shopee retorna sucesso (status 200) quando dimensoes validas sao informadas
- [ ] Retry ML continua funcionando com `{ log_id, dimensions }` (sem regressao)

**Arquivos:** `frontend/src/pages/CopyPage.tsx` linhas 183-206, `frontend/src/lib/api.ts`

---

### US-003: Implementar rate limiting com backoff no Shopee API client

**Descricao:** Como sistema, quero tratar o erro `error.too_fast` da Shopee com retry exponencial, para que operacoes de copia em lote nao falhem por rate limiting.

**Contexto:** `shopee_api.py:26-27` define `_RATE_LIMIT_RETRIES = 5` e `_RATE_LIMIT_BASE_WAIT = 2` mas essas constantes nunca sao usadas. Nenhum retry e feito quando a Shopee retorna `error.too_fast`.

**Acceptance Criteria:**
- [ ] `_shop_get()` e `_shop_post()` detectam `error.too_fast` na resposta
- [ ] Retry automatico com backoff exponencial: 2s, 4s, 8s, 16s, 32s (5 tentativas max)
- [ ] Log de warning a cada retry com tentativa numero e tempo de espera
- [ ] Apos esgotar retries, `ShopeeApiError` e levantado normalmente
- [ ] `upload_image()` tambem implementa o mesmo backoff

**Arquivo:** `app/services/shopee_api.py`

---

### US-004: Corrigir TOCTOU race em `_get_shop_lock`

**Descricao:** Como sistema, quero que o lock por shop seja thread-safe, para que token refreshes concorrentes nao criem locks duplicados.

**Contexto:** `shopee_api.py:30-33` — duas coroutines podem ambas passar o `if` check antes de qualquer uma atribuir, criando dois `Lock()` diferentes para o mesmo `shop_id`.

**Acceptance Criteria:**
- [ ] `_get_shop_lock()` usa `_token_locks.setdefault(shop_id, asyncio.Lock())` em uma unica linha
- [ ] Nenhuma outra alteracao necessaria — fix de 1 linha

**Arquivo:** `app/services/shopee_api.py` linha 30-33

---

### US-005: Tratar imagens vazias antes de chamar `add_item`

**Descricao:** Como sistema, quero abortar a copia se nenhuma imagem foi uploadada com sucesso, para evitar 3 tentativas inuteis de `add_item` que vao falhar por `image_id_list` vazio.

**Contexto:** `shopee_copier.py:351-352` — se todos os uploads falham, `image_ids` e uma lista vazia. `add_item` e chamado mesmo assim e falha. Os 3 retries tambem falham porque `_minimal_payload` herda a lista vazia.

**Acceptance Criteria:**
- [ ] Se `image_ids` estiver vazio apos `_upload_images()`, a funcao retorna erro imediato: `"Falha no upload de todas as imagens — nao e possivel criar o anuncio"`
- [ ] Nenhum `add_item` e chamado com `image_id_list: []`
- [ ] O erro e registrado no `shopee_copy_logs` com status `"error"` e detalhe claro
- [ ] O `api_debug_logs` registra o motivo (todas imagens falharam)

**Arquivo:** `app/services/shopee_copier.py` linhas 345-355

---

### FASE 2 — DATABASE (migration 013)

---

### US-006: Criar migration 013 com correcoes de schema Shopee

**Descricao:** Como DBA, quero que o schema Shopee siga os mesmos padroes do ML, para consistencia e integridade referencial correta.

**Acceptance Criteria:**
- [ ] FK `shopee_sellers.org_id` alterada para `ON DELETE CASCADE` (igual `copy_sellers`)
- [ ] FK `shopee_copy_logs.org_id` alterada para `ON DELETE SET NULL` + coluna tornada nullable
- [ ] FK `shopee_copy_logs.user_id` alterada para `ON DELETE SET NULL`
- [ ] Index `idx_shopee_sellers_slug_org` substituido por UNIQUE index `uq_shopee_sellers_slug_org(slug, org_id)`
- [ ] Index `idx_shopee_copy_logs_created_at(created_at DESC)` criado
- [ ] Index `idx_shopee_copy_logs_source_seller(source_seller)` criado
- [ ] Migration aplicada com sucesso via `mcp__supabase__apply_migration`
- [ ] Rollback documentado no header da migration

**Arquivo:** `app/db/migrations/013_shopee_schema_fixes.sql`

---

### FASE 3 — SEGURANCA

---

### US-007: Adicionar CSRF protection no OAuth Shopee

**Descricao:** Como sistema, quero validar o parametro `state` do OAuth com um token assinado, para impedir que atacantes conectem shops a orgs alheias.

**Contexto:** `auth_shopee.py:49-52` — `org_id` e extraido de `state` sem validacao criptografica. Um atacante que forje o callback pode conectar uma shop a qualquer org.

**Acceptance Criteria:**
- [ ] `/api/shopee/install` gera um token `state` assinado: `hmac(secret, org_id + timestamp)` truncado + `org_id`
- [ ] O token e armazenado temporariamente (cache in-memory com TTL 10min, ou tabela `oauth_states`)
- [ ] `/api/shopee/callback` valida o token antes de processar o callback
- [ ] Tokens expirados (>10min) sao rejeitados com 400
- [ ] Tokens reutilizados sao rejeitados (single-use)
- [ ] `state` continua sendo passado via redirect URI (compatibilidade Shopee)

**Arquivos:** `app/routers/auth_shopee.py`, `app/services/shopee_api.py`

---

### US-008: Sanitizar slug de shops Shopee

**Descricao:** Como sistema, quero que slugs de shops Shopee contenham apenas caracteres seguros, para evitar conflitos com rotas e injection.

**Contexto:** `auth_shopee.py:83` — `slug = shop_name.lower().replace(" ", "-")[:50]` aceita caracteres especiais como `/`, `.`, unicode.

**Acceptance Criteria:**
- [ ] Slug e gerado com `re.sub(r'[^a-z0-9-]', '', ...)` apos lowercase e replace de espacos
- [ ] Slugs vazios apos sanitizacao recebem fallback `f"shop-{shop_id}"`
- [ ] Slugs duplicados dentro da mesma org recebem sufixo numerico (`-2`, `-3`)

**Arquivo:** `app/routers/auth_shopee.py` linha 83

---

### FASE 4 — VARIACOES / MODELS (feature nova)

---

### US-009: Implementar copia de variacoes Shopee (tier_variation + models)

**Descricao:** Como operador, quero que produtos com variacoes (tamanho, cor, etc.) sejam copiados com todas as variantes, precos e estoques individuais, para que a copia seja fiel ao produto original.

**Contexto:** `shopee_copier.py` busca `models` via `get_model_list` mas nunca usa os dados. O `add_item` cria item simples. Shopee exige chamadas separadas: `init_tier_variation` → `add_model` apos criacao.

**Acceptance Criteria:**
- [ ] Novo endpoint em `shopee_api.py`: `init_tier_variation(shop_id, item_id, tier_variation, org_id)` — POST `/api/v2/product/init_tier_variation`
- [ ] Novo endpoint em `shopee_api.py`: `add_model(shop_id, item_id, model_list, org_id)` — POST `/api/v2/product/add_model`
- [ ] `_build_shopee_payload()` detecta `has_model: True` e exclui `normal_stock` do payload base
- [ ] Apos `add_item` sucesso, se item fonte tem models:
  1. Chama `init_tier_variation` com tier names e options do fonte
  2. Chama `add_model` com precos, estoques e SKUs por modelo
- [ ] Se `init_tier_variation` ou `add_model` falhar, o item ja criado e logado como `"partial"` (criado sem variacoes)
- [ ] Imagens de variacao (tier images) sao uploadadas e incluidas
- [ ] Log de copia inclui contagem de models copiados vs total
- [ ] Item sem models continua funcionando como antes (sem regressao)

**Arquivos:** `app/services/shopee_api.py`, `app/services/shopee_copier.py`

---

### FASE 5 — FRONTEND

---

### US-010: Deletar `ShopeeCopyPage.tsx` (codigo morto)

**Descricao:** Como desenvolvedor, quero remover o arquivo `ShopeeCopyPage.tsx` que nunca e importado/renderizado, para reduzir confusao e divida tecnica.

**Contexto:** `App.tsx` renderiza `CopyPage` unificada. `ShopeeCopyPage` e um arquivo orfao de ~950 linhas que nao e importado em lugar nenhum.

**Acceptance Criteria:**
- [ ] `frontend/src/pages/ShopeeCopyPage.tsx` deletado
- [ ] Nenhuma referencia a `ShopeeCopyPage` existe no codebase
- [ ] Build do frontend (`npm run build`) passa sem erros
- [ ] Antes de deletar: extrair qualquer logica correta que falte no `CopyPage` (especificamente o retry payload da US-002 e o peso no preview da US-012)

**Arquivo:** `frontend/src/pages/ShopeeCopyPage.tsx`

---

### US-011: Adicionar opcao Shopee no empty state de onboarding

**Descricao:** Como admin de uma org nova, quero ver a opcao de conectar Shopee na tela inicial (alem do ML), para que orgs Shopee-only tenham um caminho guiado.

**Contexto:** `App.tsx:418-491` — tela "Conecte sua conta" mostra apenas botao ML.

**Acceptance Criteria:**
- [ ] Tela de empty state inclui botao "Conectar loja Shopee" ao lado do botao ML
- [ ] Botao redireciona para `/api/shopee/install` (mesmo fluxo do Admin)
- [ ] Visual consistente com o botao ML existente
- [ ] QuickStartGuide (linhas 748-833) menciona Shopee como opcao

**Arquivo:** `frontend/src/App.tsx`

---

### US-012: Mostrar peso e `has_description` no preview Shopee

**Descricao:** Como operador, quero ver o peso e status da descricao no preview de itens Shopee, para saber antecipadamente se a copia vai precisar de dimensoes manuais.

**Contexto:** `CopyPage.handlePreview` (linhas 154-162) normaliza o preview Shopee mas descarta `weight`, `has_description`, `stock`, `category_id`.

**Acceptance Criteria:**
- [ ] Preview Shopee mostra peso do item (em kg) quando disponivel
- [ ] Preview mostra indicador de "sem descricao" quando `has_description: false`
- [ ] Preview mostra estoque quando disponivel
- [ ] Tipo `ItemPreview` estendido com campos opcionais: `weight?`, `has_description?`, `stock?`
- [ ] Preview ML nao e afetado (campos opcionais)

**Arquivo:** `frontend/src/pages/CopyPage.tsx` linhas 154-162

---

### US-013: Corrigir `resolve-sellers` Shopee silenciando erros no CopyForm

**Descricao:** Como operador, quero ver mensagem de erro quando a resolucao de sellers Shopee falha, para saber porque meus IDs nao foram encontrados.

**Contexto:** `CopyForm.tsx:198` — `if (!res.ok) return;` sem feedback ao usuario.

**Acceptance Criteria:**
- [ ] Erro de `resolve-sellers` para Shopee exibe toast com a mensagem do backend
- [ ] Se o usuario nao tem shops Shopee conectadas e cola URL Shopee, mensagem especifica: "Nenhuma loja Shopee conectada"
- [ ] Loading state e resetado em caso de erro

**Arquivo:** `frontend/src/components/CopyForm.tsx`

---

### US-014: Limpar tipos mortos e duplicacoes no frontend

**Descricao:** Como desenvolvedor, quero remover tipos nao utilizados e extrair componentes duplicados, para melhorar manutenibilidade.

**Acceptance Criteria:**
- [ ] `ShopeeCopyResponse`, `ShopeeCopyResult` removidos de `api.ts` (nunca usados)
- [ ] `StatusBadge` extraido para `components/StatusBadge.tsx` (compartilhado entre CopyPage e logs)
- [ ] `isDimensionError` extraido para `lib/helpers.ts` com a verificacao de `weight` inclusa (unificando ML e Shopee)
- [ ] Build passa sem erros
- [ ] Paywall feature list (App.tsx:308-323) inclui menção a Shopee

**Arquivos:** `frontend/src/lib/api.ts`, `frontend/src/components/StatusBadge.tsx`, `frontend/src/lib/helpers.ts`, `frontend/src/pages/CopyPage.tsx`, `frontend/src/App.tsx`

---

### FASE 6 — PERFORMANCE

---

### US-015: Paralelizar upload de imagens Shopee

**Descricao:** Como sistema, quero fazer upload de imagens em paralelo (max 3 concorrentes), para reduzir o tempo de copia de itens com muitas imagens.

**Contexto:** `shopee_copier.py:68-72` — upload sequencial de ate 9 imagens. Com ~2s por upload = 18s. Paralelo com semaforo(3) = ~6s.

**Acceptance Criteria:**
- [ ] `_upload_images()` usa `asyncio.gather()` com `asyncio.Semaphore(3)`
- [ ] Retry individual de 1x por imagem mantido
- [ ] Ordem das imagens mantida (primeira imagem = capa)
- [ ] Erro em uma imagem nao cancela as outras
- [ ] Log indica quantas imagens uploadadas com sucesso vs total

**Arquivo:** `app/services/shopee_copier.py` linhas 60-92

---

### US-016: Cache de logistics por destination shop

**Descricao:** Como sistema, quero buscar logistics uma vez por shop destino por operacao de copia, para evitar chamadas repetidas identicas.

**Contexto:** `shopee_copier.py` chama `_fetch_dest_logistics()` para cada par (item, destino). 10 itens x 3 destinos = 30 chamadas, mas so 3 sao distintas.

**Acceptance Criteria:**
- [ ] `copy_items()` e `copy_with_dimensions()` fazem pre-fetch de logistics para cada dest shop antes do loop de itens
- [ ] Dict `{shop_id: logistics_list}` passado para `copy_single_item()`
- [ ] `copy_single_item()` recebe `logistics` como parametro opcional; se `None`, busca (backward compat)
- [ ] Reducao de chamadas API proporcional ao numero de itens (N*M → M)

**Arquivo:** `app/services/shopee_copier.py`

---

### US-017: Reutilizar dados do item fonte entre destinos

**Descricao:** Como sistema, quero buscar dados do item fonte uma vez e reutilizar para todos os destinos, para evitar chamadas repetidas.

**Contexto:** 1 item x 3 destinos = 9 API calls (3x base + 3x extra + 3x models). Deveria ser 3 calls total.

**Acceptance Criteria:**
- [ ] `copy_items()` faz pre-fetch do item fonte (base + extra + models) antes do loop de destinos
- [ ] `copy_single_item()` aceita `source_data` como parametro opcional
- [ ] Se `source_data` fornecido, pula `_fetch_source_item()`
- [ ] Reducao de chamadas: 1 item x N destinos = 3 calls (em vez de 3*N)

**Arquivo:** `app/services/shopee_copier.py`

---

### US-018: Criar httpx.AsyncClient reutilizavel

**Descricao:** Como sistema, quero reutilizar conexoes HTTP com a Shopee, para reduzir latencia de TCP handshake em operacoes com muitas chamadas.

**Contexto:** `shopee_api.py` cria e destroi um `httpx.AsyncClient` por chamada. Sem connection pooling.

**Acceptance Criteria:**
- [ ] Modulo `shopee_api.py` cria um `httpx.AsyncClient` com `limits=httpx.Limits(max_connections=20)` e `timeout=60.0`
- [ ] Client e reutilizado em todas as funcoes (`_shop_get`, `_shop_post`, `upload_image`)
- [ ] Lifecycle gerenciado via funcao de startup/shutdown registrada no FastAPI app (ou lazy singleton)
- [ ] Client e fechado graciosamente no shutdown

**Arquivo:** `app/services/shopee_api.py`, `app/main.py`

---

### FASE 7 — CORRECOES MENORES

---

### US-019: `updated_at` atualizado no token refresh + condition nao hardcoded

**Descricao:** Como sistema, quero que `updated_at` em `shopee_sellers` seja atualizado quando o token e refreshed, e que `condition` do item fonte seja respeitado.

**Acceptance Criteria:**
- [ ] `_get_token()` refresh path inclui `.update({"updated_at": "now()"})` junto com token updates
- [ ] `_build_shopee_payload()` usa `condition` do item fonte (default "NEW" se ausente)
- [ ] Import morto `urlencode` removido de `auth_shopee.py`

**Arquivos:** `app/services/shopee_api.py`, `app/services/shopee_copier.py`, `app/routers/auth_shopee.py`

---

### US-020: Wrap logistics fetch em try/except + discriminar debug logs

**Descricao:** Como sistema, quero que falhas de logistics tenham tratamento especifico, e que debug logs Shopee sejam identificaveis.

**Acceptance Criteria:**
- [ ] `_fetch_dest_logistics()` wrapped em try/except em `copy_single_item()` com mensagem de erro especifica
- [ ] `_log_debug()` inclui campo `platform: "shopee"` no insert de `api_debug_logs`
- [ ] `_log_debug()` tambem aceita o campo `action` existente (backward compat com ML)

**Arquivo:** `app/services/shopee_copier.py`

---

### US-021: `refresh_token_expires_at` baseado na resposta da API

**Descricao:** Como sistema, quero calcular o expiry do refresh token a partir da resposta da Shopee quando disponivel, em vez de hardcode 30 dias.

**Acceptance Criteria:**
- [ ] `auth_shopee.py` callback: usa `refresh_token_expire_in` da resposta se presente; fallback 30 dias
- [ ] `_get_token()` refresh path: se a resposta retorna novo `refresh_token`, recalcula `refresh_token_expires_at`
- [ ] Log de warning se `refresh_token_expire_in` nao vier na resposta

**Arquivos:** `app/routers/auth_shopee.py`, `app/services/shopee_api.py`

---

### US-022: Unificar `copy_items` e `copy_with_dimensions` (DRY)

**Descricao:** Como desenvolvedor, quero eliminar a duplicacao de ~90% entre as duas funcoes de copia Shopee.

**Acceptance Criteria:**
- [ ] Nova funcao interna `_run_copy_job(item_ids, dest_shop_ids, org_id, user_id, dimensions=None, log_id=None)` encapsula a logica compartilhada
- [ ] `copy_items()` e `copy_with_dimensions()` sao wrappers finos que chamam `_run_copy_job()`
- [ ] Comportamento identico ao anterior (sem regressao)
- [ ] Trial accounting unificado: ambos os endpoints usam o mesmo padrao (pre-incremento + refund)

**Arquivo:** `app/services/shopee_copier.py`

---

## 4. Requisitos Funcionais

| ID | Requisito |
|----|-----------|
| FR-01 | O sistema deve manter atributos nao-brand no retry attempt 2 de `add_item` |
| FR-02 | O frontend deve enviar payload correto (`source, destinations, item_id, dimensions`) para retry Shopee |
| FR-03 | O sistema deve implementar backoff exponencial em respostas `error.too_fast` da Shopee |
| FR-04 | O lock por shop deve ser atomico usando `dict.setdefault()` |
| FR-05 | O sistema deve abortar `add_item` se zero imagens foram uploadadas |
| FR-06 | FKs de tabelas Shopee devem usar `CASCADE`/`SET NULL` consistente com ML |
| FR-07 | Index UNIQUE em `(slug, org_id)` para `shopee_sellers` |
| FR-08 | OAuth state deve ser assinado criptograficamente e single-use |
| FR-09 | Slugs devem conter apenas `[a-z0-9-]` |
| FR-10 | Itens com variacoes devem ser copiados com `init_tier_variation` + `add_model` |
| FR-11 | Upload de imagens deve ser paralelo com semaforo(3) |
| FR-12 | Logistics devem ser cached por shop destino durante uma operacao |
| FR-13 | Dados do item fonte devem ser buscados uma vez e reutilizados entre destinos |
| FR-14 | `httpx.AsyncClient` deve ser reutilizado entre chamadas |
| FR-15 | `ShopeeCopyPage.tsx` deve ser deletado |
| FR-16 | Empty state deve oferecer conexao Shopee |
| FR-17 | Preview Shopee deve mostrar peso e status de descricao |

---

## 5. Nao-Objetivos (Fora de Escopo)

- **Tokens criptografados at-rest** — risco baixo, complexidade alta, mesma situacao do ML
- **Wholesale pricing** — feature de nicho, fase futura
- **Video support** — requer upload chunked complexo, fase futura
- **Extended description** (com imagens) — fase futura
- **Seller stock / multi-warehouse** — fase futura
- **Category attribute validation** (pre-check via `get_attributes`) — fase futura, significaria + API calls
- **Testes automatizados** — o projeto nao tem test suite, manter padrao atual
- **Refactor ML para mesmos padroes** — fora de escopo, exceto onde compartilham componentes

---

## 6. Consideracoes Tecnicas

### Dependencias entre User Stories

```
US-001 ─────────────────────────────── independente
US-002 ← extrair logica de ShopeeCopyPage antes de US-010
US-003 ─────────────────────────────── independente
US-004 ─────────────────────────────── independente (1 linha)
US-005 ─────────────────────────────── independente
US-006 ─────────────────────────────── independente (migration)
US-007 ─────────────────────────────── independente
US-008 ─────────────────────────────── independente
US-009 ← depende de US-003 (rate limit) e US-018 (client reuse)
US-010 ← depende de US-002 (extrair logica antes de deletar)
US-011 ─────────────────────────────── independente
US-012 ─────────────────────────────── independente
US-013 ─────────────────────────────── independente
US-014 ← depende de US-010 (ShopeeCopyPage deletado)
US-015 ─────────────────────────────── independente
US-016 ← pode ser feito junto com US-017 e US-022
US-017 ← pode ser feito junto com US-016 e US-022
US-018 ─────────────────────────────── independente
US-019 ─────────────────────────────── independente
US-020 ─────────────────────────────── independente
US-021 ─────────────────────────────── independente
US-022 ← deve ser feito apos US-016 e US-017 (refactor conjunto)
```

### Ordem de implementacao sugerida

**Batch 1 (quick fixes, sem dependencias):** US-001, US-004, US-005, US-008, US-019, US-020, US-021
**Batch 2 (database):** US-006
**Batch 3 (seguranca):** US-007
**Batch 4 (frontend criticos):** US-002, US-012, US-013
**Batch 5 (performance):** US-003, US-015, US-018
**Batch 6 (feature — variacoes):** US-009
**Batch 7 (performance avancada):** US-016, US-017, US-022
**Batch 8 (cleanup):** US-010, US-011, US-014

### Riscos

| Risco | Mitigacao |
|-------|-----------|
| Variacoes Shopee tem muitas edge cases (tier images, modelos com precos zerados) | Implementar modo basico primeiro; logar `"partial"` em falhas |
| Migration 013 pode falhar se tabelas nao estao vazias | Tabelas estao vazias (0 rows confirmado pela auditoria) |
| CSRF token pode quebrar reconexao se token expirar durante OAuth | TTL de 10min e generoso; fallback com mensagem clara |
| Shopee docs inacessiveis via fetch (requer login partner) | Validar contra SDK de terceiros e testes manuais |

---

## 7. Metricas de Sucesso

- **Zero falhas silenciosas**: Toda falha de copia Shopee deve ter erro visivel no log
- **Retry de dimensoes funcional**: Botao "Informar dimensoes" para Shopee retorna sucesso com dimensoes validas
- **Variacoes copiadas**: Item com N models → item destino com N models (ou status `"partial"` com log claro)
- **Performance**: Copia de 1 item com 9 imagens para 3 destinos: <30s (vs ~60s atual estimado)
- **Schema alinhado**: `\d shopee_sellers` e `\d shopee_copy_logs` mostram FKs e indexes corretos
- **Build limpo**: `npm run build` sem warnings de imports nao utilizados

---

## 8. Questoes em Aberto

1. **Campo `url` vs `image_url` no upload**: O auditor backend reportou como BUG-2 que o campo deveria ser `image_url`, mas a documentacao e SDKs confirmam que `url` e o campo correto para upload via URL. **Resolvido: NAO e bug — `url` esta correto.**

2. **`refresh_token_expires_at` no refresh**: A documentacao sugere que refresh tokens Shopee nao estendem vida quando usados. Mas se a Shopee retornar um NOVO `refresh_token` no refresh, esse novo token tem vida propria? **US-021 trata isso conservadoramente.**

3. **Category cross-compatibility**: Se o `category_id` do item fonte nao existe na shop destino (mercados diferentes), a copia falha. Deve-se implementar category mapping? **Fora de escopo por agora — documentar como limitacao conhecida.**

4. **Brand validation**: Brands sao shop/category-specific. Um item copiado com `brand_id: X` pode falhar se o brand nao e valido na categoria destino. `_strip_attributes` (US-001) mitiga parcialmente ao remover brand no retry.
