# Changelog

Todas as mudancas notaveis deste projeto serao documentadas neste arquivo.

O formato e baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere ao [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [Unreleased]

### Fixed
- Race condition (TOCTOU) no lock por loja Shopee (`_get_shop_lock`) — coroutines concorrentes podiam criar locks duplicados; agora usa `dict.setdefault` atomico
- Copia Shopee agora aborta imediatamente quando nenhuma imagem foi enviada com sucesso, em vez de tentar criar o anuncio 3 vezes com lista de imagens vazia
- Retry de copia Shopee (attempt 2) agora remove apenas atributos com valores vazios em vez de remover todos os atributos — preserva atributos obrigatorios da categoria
- Token refresh Shopee agora atualiza `updated_at` na tabela `shopee_sellers`
- Condicao do item Shopee (`condition`) agora vem do item origem em vez de hardcoded `NEW`
- Removido import nao utilizado `urlencode` de `auth_shopee.py`
- Busca de canais logisticos Shopee agora tem try/except especifico com mensagem clara em vez de cair no handler generico
- Debug logs Shopee agora incluem campo `platform: 'shopee'` para distinguir de logs ML
- Expiracao do refresh token Shopee agora usa `refresh_token_expire_in` da resposta da API em vez de hardcoded 30 dias; fallback para 30 dias se campo ausente
- Token refresh Shopee agora recalcula `refresh_token_expires_at` quando um novo refresh token e retornado
- Slug de lojas Shopee agora sanitizado para conter apenas `[a-z0-9-]`, com fallback para `shop-{shop_id}` e sufixo numerico (`-2`, `-3`, ...) em caso de duplicata na mesma org
- Schema Shopee corrigido: FK `shopee_sellers.org_id` agora ON DELETE CASCADE, FKs `shopee_copy_logs.org_id` e `user_id` agora ON DELETE SET NULL, `org_id` nullable em `shopee_copy_logs`, indice `slug+org_id` agora UNIQUE, adicionados indices em `created_at` e `source_seller`

### Security
- Protecao CSRF no fluxo OAuth Shopee — parametro `state` agora assinado com HMAC-SHA256 (usando `partner_key`) e inclui timestamp; callback valida assinatura e rejeita estados expirados (>10 minutos)

### Fixed (Frontend)
- Botao "Informar dimensoes" para copias Shopee agora envia payload correto (`source`, `destinations`, `item_id`, `dimensions`) em vez de `log_id` — antes a requisicao sempre falhava pois o backend esperava campos diferentes
- Erro ao resolver sellers Shopee agora exibe mensagem ao usuario em vez de falhar silenciosamente; mensagem especifica 'Nenhuma loja Shopee conectada' quando usuario cola URL Shopee sem ter loja conectada

### Added (Frontend)
- Preview Shopee agora exibe peso do item (em g ou kg) e alerta visual quando item nao tem descricao (Shopee exige descricao para criar anuncio)
- Tela de onboarding (empty state) agora inclui botao "Conectar loja Shopee" ao lado do botao do Mercado Livre, para orgs que usam apenas Shopee
- QuickStartGuide atualizado para mencionar Shopee como opcao de conexao
- Paywall (tela de assinatura) agora lista "Integracao com Shopee" entre as funcionalidades do plano

### Added
- Rate limiting com backoff exponencial no cliente Shopee API — `_shop_get`, `_shop_post` e `upload_image` agora detectam erro `too_fast` e fazem retry automatico (ate 5 tentativas: 2s, 4s, 8s, 16s, 32s)
- Cliente HTTP reutilizavel (singleton `httpx.AsyncClient`) para APIs Shopee — conexoes TCP reutilizadas via connection pooling (max 20 conexoes, 10 keep-alive), com shutdown graceful registrado no FastAPI
- Upload de imagens Shopee agora e paralelo com semaforo (max 3 simultaneos) via `asyncio.gather` — reduz tempo de upload de ~18s para ~6s em itens com 9 imagens, mantendo ordem (primeira imagem = capa)
- Cache de canais logisticos por loja destino em operacoes de copia Shopee — busca feita 1 vez por loja (nao por item x destino), reduzindo chamadas de N*M para M
- Reutilizacao de dados do item origem entre lojas destino em copias Shopee — busca feita 1 vez por item (nao por item x destino), reduzindo chamadas de 3*N para 3 por item
- Refatoracao DRY: logica duplicada entre `copy_items` e `copy_with_dimensions` extraida para funcao interna `_run_copy_job` — ambas funcoes publicas agora sao thin wrappers
- Metodos `init_tier_variation` e `add_model` no cliente Shopee API — wrappers para `/api/v2/product/init_tier_variation` (definir tiers de variacao) e `/api/v2/product/add_model` (criar combinacoes SKU com preco/estoque)
- Copia de variacoes Shopee: produtos com variacoes (cor, tamanho) agora sao copiados com todos os modelos, precos individuais, estoque por SKU e imagens de tier; se `init_tier_variation` ou `add_model` falhar, item e criado com status 'partial'; resultado inclui `models_copied` e `models_total`

### Changed
- **Historico de copias ML redesenhado**: tabela substituida por cards com borda de status colorida, titulo do item em destaque, MLB ID em tag mono, fluxo origem/destinos, chips verdes para novos MLBs criados, bloco de erros com destaque vermelho, e form de dimensoes inline. Responsivo e com suporte completo a dark mode via classes CSS (`log-chip-success`, `log-error-block`)

### Fixed
- Erros de dimensão (`seller_package_dimensions`) agora fazem bail-out imediato no retry loop em vez de tentar 2 vezes inutilmente antes de detectar; debug log já é salvo como `resolved=true`
- Auto-fix para atributo MODEL faltando: quando ML rejeita por `missing_required`, o retry agora extrai MODEL do título/family_name do item fonte e adiciona ao payload automaticamente

### Changed
- **Copia ML e Shopee agora rodam em background** — endpoint retorna imediatamente com `{"status":"queued"}`, frontend acompanha progresso via polling de logs (mesmo padrao da copia de compatibilidades)
- Trial copies: reserva upfront antes de enfileirar, devolve falhas apos conclusao do background task
- Logs de copia (ML e Shopee) agora mostram nome e thumbnail do item origem para facilitar identificacao (especialmente no retry de dimensoes)
- Startup cleanup: ao reiniciar o servidor, logs `in_progress` orfaos sao marcados como `error`
- Frontend: CopyPage e ShopeeCopyPage usam toast de confirmacao + polling em vez de aguardar resposta sincrona
- Migration `012_copy_logs_item_meta.sql`: colunas `source_item_title` e `source_item_thumbnail` em `copy_logs` e `shopee_copy_logs`
- Copia ML agora roda em paralelo (semaphore=3, ~80% do rate limit ML) via `asyncio.gather` em vez de sequencial
- Todas as chamadas ML API (`get_item`, `create_item`, `update_item`, etc.) agora tem retry automatico em 429 (rate limit) com exponential backoff (base 3s, max 5 tentativas)
- Preview da compatibilidade agora carrega automaticamente ao digitar o ID (debounce de 600ms), sem precisar clicar fora
- Preview de cópia: preço exibe "R$" em vez do código "BRL", cor verde dinheiro (`--success`)
- Formulário de cópia: ao colar um MLB, adiciona quebra de linha automaticamente para o próximo ID

### Added
- Trial system: 20 copias gratuitas por org antes de exigir assinatura
- Migration `010_trial_copies.sql`: campos `trial_copies_used` e `trial_copies_limit` na tabela `orgs`
- Endpoint `PUT /api/sellers/{slug}/name` para renomear sellers conectados
- Billing status agora retorna `trial_copies_used`, `trial_copies_limit`, `trial_active`, `trial_exhausted`
- `require_active_org` permite acesso durante trial (bloqueia quando esgotado com HTTP 402)
- `_check_trial_limit()` e `_increment_trial_copies()` no router de copy

#### Shopee Integration (Phase 1 — Foundation)
- Config: `shopee_partner_id`, `shopee_partner_key`, `shopee_redirect_uri`, `shopee_sandbox` em `app/config.py`
- Migration `011_shopee_sellers.sql`: tabelas `shopee_sellers` e `shopee_copy_logs`
- `app/services/shopee_api.py`: cliente API Shopee com HMAC-SHA256 signing, token management com locks async, wrappers para product/logistics/media APIs
- `app/routers/auth_shopee.py`: OAuth2 flow Shopee (install, callback, list/rename/delete shops)
- Endpoints: `GET /api/shopee/install`, `GET /api/shopee/callback`, `GET /api/shopee/sellers`, `PUT /api/shopee/sellers/{slug}/name`, `DELETE /api/shopee/sellers/{slug}`
- Debug env endpoint agora mostra status das vars Shopee

#### Shopee Integration (Phase 2 — Copy Engine + Frontend)
- `app/services/shopee_copier.py`: motor de copia Shopee com fetch source, upload de imagens, build payload, retry (3 tentativas), logging de debug
- `app/routers/shopee_copy.py`: router completo com 5 endpoints — `POST /api/shopee/copy` (copia bulk), `POST /api/shopee/copy/with-dimensions` (copia com dimensoes), `GET /api/shopee/copy/preview/{item_id}` (preview com auto-detect de shop), `GET /api/shopee/copy/logs` (historico org-scoped), `POST /api/shopee/copy/resolve-sellers` (resolve shop por item)
- Permissoes admin agora incluem lojas Shopee: GET permissions retorna campo `platform` (ml/shopee)
- Super admin: `GET /api/super/orgs` inclui `shopee_seller_count` e `shopee_copy_count` por org
- Frontend: tipos TypeScript para Shopee (ShopeeSeller, ShopeeCopyResult, ShopeeCopyLog, ShopeeItemPreview)
- Frontend: `useAuth` hook com estado de shopeeSellers, loadShopeeSellers, disconnectShopeeSeller
- Frontend: `ShopeeCopyPage.tsx` — pagina completa de copia Shopee (formulario, preview, resultados, logs, dimensoes)
- Frontend: tab "Shopee" na navegacao principal (App.tsx)
- Frontend: secao "Lojas Shopee" no painel Admin com badge laranja, connect/rename/disconnect
- Frontend: colunas Shopee Sellers e Shopee Copies na tabela SuperAdminPage

### Changed
- Billing status endpoint retorna campos adicionais de trial
- `require_active_org` usa logica de trial em vez de bloquear imediatamente sem pagamento

---

## [1.0.0] - 2026-03-05

Release estavel da plataforma Copy Anuncios ML. Plataforma SaaS multi-tenant completa
para copiar anuncios e compatibilidades veiculares entre contas do Mercado Livre.

### Core Platform

#### Added
- Copy engine com retry inteligente (ate 4 tentativas com ajuste automatico de payload)
- Suporte a Regular Items e User Products (family_name vs title)
- Suporte a brand accounts (official_store_id auto-detectado e cacheado)
- Copy de descricao e compatibilidades veiculares apos criacao do item
- Tratamento de dimensoes: status `needs_dimensions` com retry via frontend
- Debug logging: toda falha de API logada em `api_debug_logs` com request/response completos
- `error-history.yaml`: base de conhecimento estruturada de erros ML (34+ erros documentados)
- Error Debugging Playbook no CLAUDE.md

#### ML API Client (`ml_api.py`)
- Client HTTP async (httpx) com gestao automatica de tokens por seller
- Auto-refresh de tokens com locks async por seller (previne race conditions)
- `MlApiError` exception customizada com status_code, method, url, detail, payload
- Exponential backoff em 429 (rate limit): 3s base, max 5 retries
- Suporte a User Products: fallback para `/user-products/{id}/compatibilities`
- Busca por SKU: `search_items_by_sku` com query dupla (seller_sku + sku)

#### Item Copier (`item_copier.py`, ~1100 linhas)
- `_build_item_payload()`: transforma item source em payload de criacao
  - Include: category_id, price, currency_id, available_quantity, buying_mode, condition, title/family_name, pictures (secure_url), attributes (filtrados), sale_terms, shipping (mode=me2), variations, channels, seller_custom_field
  - Exclude: id, seller_id, date_created, sold_quantity, status, permalink, health, GTIN, package dimensions
  - Atributos com id nulo filtrados automaticamente
  - SELLER_SKU adicionado como atributo para User Products
- `_adjust_payload_for_ml_error()`: ajusta payload baseado no erro ML
- `copy_single_item()`: retry loop com safe_mode e preservacao de campos descobertos
- `copy_with_dimensions()`: aplica dimensoes no source e copia
- Fulfillment items: stock forcado para 1 quando source tem 0

### Authentication & RBAC

#### Added
- Self-service signup: cria org + admin user + session token em uma chamada
- Login por email com bcrypt password hashing
- Session tokens: 32-byte URL-safe, TTL 7 dias, validados por request
- RBAC com 3 niveis: `super_admin` > `admin` > `operator`
- Permissoes granulares por seller: `can_copy_from`, `can_copy_to`
- `can_run_compat` flag para acesso a compatibilidade
- Admin promote via master password (bootstrap do primeiro admin)
- Forgot/reset password com token por email (SMTP), expira em 1 hora
- Reset invalida todas as sessions do usuario (seguranca)
- Protecao contra remocao do ultimo admin da org
- Audit logging: toda acao de auth logada em `auth_logs`

### Multi-Tenant SaaS

#### Added
- Tabela `orgs` como unidade de tenant (billing, data isolation)
- `org_id` FK em todas as tabelas (users, copy_sellers, permissions, logs)
- Data isolation: todo query filtra por `org_id`
- Super-admin bypassa checks de org (acesso global)
- `GET /api/super/orgs` com stats de uso (30 dias)
- `PUT /api/super/orgs/{org_id}` para ativar/desativar orgs
- Migration `007_multi_tenant.sql` + `008_backfill_org_data.sql`

### Billing (Stripe)

#### Added
- Stripe Checkout integration para assinaturas
- Stripe Customer Portal para gerenciamento de pagamento
- Webhook handler: `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`
- Paywall: bloqueia acesso ate assinatura ativa
- Auto-detect payment apos retorno do Stripe (polling 2s, max 10 tentativas)
- Billing status endpoint com info de assinatura

### Vehicle Compatibility Copy

#### Added
- Preview de compatibilidades com contagem de veiculos
- Extracao de SKUs: item-level (seller_custom_field + SELLER_SKU attr) + variation-level
- Busca por SKU em todos os sellers conectados (paralelo, semaphore 10)
- Copy de compatibilidades: regular items + User Products (fallback automatico)
- Background tasks para operacoes longas
- Rate limiting: 1s pacing entre calls de compat
- Limite de 50 SKUs por busca

### Frontend (React 19 + TypeScript + Vite)

#### Added
- SPA servida pelo FastAPI (monolito, Docker multi-stage)
- Auth via `useAuth()` hook, token em localStorage, header `X-Auth-Token`
- CopyPage: paste de IDs, auto-detect de seller source, selecao de destinos, preview, copy com confirmacao
- CopyForm: auto-resolve de sellers, deduplicacao de IDs, two-step confirmation
- CopyProgress: resultados com retry de dimensoes inline
- DimensionForm: input de dimensoes agrupado por SKU
- CompatPage: preview de source, busca por SKU, copy de compatibilidades
- Admin: CRUD de usuarios, permissoes por seller, OAuth install
- SuperAdminPage: gestao de orgs com stats
- BillingPage: status de assinatura, checkout, portal
- Login/Signup com validacao e animacao de erro (shake)
- Landing page redesenhada (tier 1 quality)
- Connect screen para onboarding (quando nenhum seller conectado)
- Polling 5s para progresso de operacoes in_progress
- Permission-aware: tabs e sellers filtrados por role e permissoes
- CSS variables design system (--ink, --paper, --surface, --line, etc.)
- Flash prevention: `initializing` state no refresh

### Infrastructure

#### Added
- FastAPI backend com Uvicorn
- Supabase (PostgreSQL) com service_role key (bypass RLS)
- Docker multi-stage build (Node frontend + Python backend)
- Deploy via Easypanel
- CORS configuravel via env var
- Health check endpoints (`/api/health`, `/health`)
- Debug env endpoint (`/api/debug/env`, super_admin only)
- 10 migrations SQL (001-010)

### Database Schema

#### Tables
- `orgs` — multi-tenant: id, name, email, active, payment_active, stripe_*, trial_*
- `users` — auth: id, email, username, password_hash, role, is_super_admin, can_run_compat, org_id
- `user_sessions` — sessions: token (32-byte), user_id, expires_at (7 days)
- `user_permissions` — RBAC: user_id, seller_slug, can_copy_from, can_copy_to
- `password_reset_tokens` — reset: token, user_id, expires_at (1 hour)
- `auth_logs` — audit: user_id, username, org_id, action
- `copy_sellers` — ML OAuth: slug, ml_user_id, ml_access/refresh_token, official_store_id, org_id
- `copy_logs` — copy history: source_seller, dest_sellers[], source_item_id, status, dest_item_ids, error_details
- `compat_logs` — compat history: source_item_id, skus[], targets (JSONB), success/error counts
- `api_debug_logs` — debug: full request/response, attempt_number, adjustments, resolved flag

### Bug Fixes (acumulados pre-release)
- OAuth token: preservar refresh_token existente quando ML nao retorna novo
- OAuth token exchange: usar endpoint MercadoPago (nao MercadoLibre)
- family_name: detectar erro sem brackets, truncar para 60 chars no length error
- official_store_id: buscar de items ativos do seller (nao de /users/me), cachear no DB
- Atributos com id nulo: filtrar automaticamente no payload
- local_pick_up: forcar false (multi-warehouse sellers rejeitam true)
- SELLER_SKU: adicionar como atributo para User Products (interface ML le do atributo)
- Fulfillment items: forcar stock 1 quando source tem 0
- Variations + family_name: remover variations quando conflitam com family_name
- SKU search: filtrar sellers inativos, tratar erros gracefully
- Compat copy: passar source_compat_products no flow de User Products
- Preview: auto-detect seller via fallback autenticado em 403
- Resolve sellers: resolver em paralelo, filtrar por can_copy_from
- Cross-org: prevenir acesso cross-org em copy_logs, admin_users, permissions
- Race conditions: lock por seller no token refresh, prevenir paste+blur duplicado
- Deduplicacao: normalizar IDs (MLB/MLB-/numeros) e deduplicar

---

## Convencoes de Versionamento

- **MAJOR** (X.0.0): breaking changes na API ou estrutura de dados
- **MINOR** (0.X.0): nova funcionalidade (ex: integracao Shopee)
- **PATCH** (0.0.X): bugfix ou melhoria sem mudar interface

### Formato de Commits
```
tipo: descricao curta

tipos: feat, fix, chore, docs, style, refactor, perf
```

### Processo de Release
1. Atualizar CHANGELOG.md movendo itens de [Unreleased] para nova versao
2. Criar commit: `chore: release vX.Y.Z`
3. Criar tag: `git tag -a vX.Y.Z -m "vX.Y.Z"`
4. Push: `git push && git push --tags`

[Unreleased]: https://github.com/user/copy-anuncios/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/user/copy-anuncios/releases/tag/v1.0.0
