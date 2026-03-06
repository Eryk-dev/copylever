# PRD: Platform Hardening — Seguranca, Performance, DevOps e Frontend

## 1. Introduction/Overview

Apos auditoria completa com 6 agentes especializados (Arquitetura, Seguranca, Database, Frontend, API Design, DevOps), o projeto Copy Anuncios ML recebeu score medio de 5.3/10. Este PRD consolida as 8 melhorias prioritarias identificadas em um unico esforco de hardening, cobrindo vulnerabilidades criticas de seguranca, melhorias de performance, infraestrutura Docker e qualidade do frontend.

**Problema:** A plataforma esta funcional mas apresenta vulnerabilidades de seguranca exploraveis (OAuth CSRF, XSS, brute force), gargalos de performance (single worker, httpx sem pool), e fragilidades de infraestrutura (sem healthcheck Docker, sem .dockerignore).

## 2. Goals

- Eliminar todas as vulnerabilidades criticas de seguranca identificadas na auditoria
- Melhorar performance do runtime com workers e connection pooling
- Hardening da infraestrutura Docker para producao
- Resolver tech debt critica do frontend (error boundaries, componentes compartilhados)
- Adicionar contratos formais de API (response_model, validacao de enum)
- Migrar operacoes de copia para processamento assincrono

## 3. User Stories

### US-201: Rate Limiting em Endpoints de Autenticacao

**Description:** As a platform operator, I want rate limiting on authentication endpoints so that brute-force attacks are prevented.

**Acceptance Criteria:**
- [ ] `slowapi` instalado e configurado como middleware no FastAPI
- [ ] `POST /api/auth/login` limitado a 5 requests/minuto por IP
- [ ] `POST /api/auth/signup` limitado a 3 requests/minuto por IP
- [ ] `POST /api/auth/admin-promote` limitado a 3 requests/15 minutos por IP
- [ ] `POST /api/auth/forgot-password` limitado a 3 requests/15 minutos por IP
- [ ] Respostas de rate limit retornam HTTP 429 com mensagem em portugues
- [ ] `admin_master_password` comparado com `hmac.compare_digest()` em vez de `!=`
- [ ] Typecheck/lint passa

---

### US-202: Corrigir OAuth State com Nonce Criptografico

**Description:** As a platform operator, I want the OAuth callback to validate a cryptographic nonce so that CSRF attacks cannot link malicious ML accounts to victim organizations.

**Acceptance Criteria:**
- [ ] `GET /api/ml/install` gera nonce com `secrets.token_urlsafe(32)` e armazena no banco (nova tabela `oauth_states` ou campo em `user_sessions`) com org_id, user_id, e TTL de 10 minutos
- [ ] O `state` enviado ao ML e o nonce (nao mais `org_` + org_id)
- [ ] `GET /api/ml/callback` valida o nonce contra o armazenado, extrai org_id do registro (nao do parametro)
- [ ] Nonces expirados ou ja utilizados sao rejeitados com 403
- [ ] Nonce e deletado apos uso (single-use)
- [ ] `slug` na `_success_page` e escapado com `html.escape()` antes de inserir no HTML
- [ ] Typecheck/lint passa

---

### US-203: Corrigir Cross-Tenant Data Leak no compat_copier

**Description:** As a platform operator, I want all multi-tenant queries to require a valid org_id so that data from one organization is never exposed to another.

**Acceptance Criteria:**
- [ ] Em `compat_copier.py`, funcao `search_sku_all_sellers` (linhas ~33-36): se `org_id` for falsy (vazio, None), levanta `ValueError("org_id is required")` em vez de omitir o filtro
- [ ] Em `compat_copier.py`, funcao `_resolve_source_seller` (linhas ~94-97): mesmo tratamento — org_id obrigatorio
- [ ] Em `ml_api.py`, funcao `search_items_by_sku`: mesma validacao
- [ ] Nenhuma query ao Supabase em todo o codebase omite `org_id` condicionalmente com `if org_id:`
- [ ] Typecheck/lint passa

---

### US-204: Docker Hardening (.dockerignore, usuario nao-root, HEALTHCHECK)

**Description:** As a DevOps engineer, I want the Docker image to follow production best practices so that the container is secure and monitorable.

**Acceptance Criteria:**
- [ ] `.dockerignore` criado excluindo: `.env`, `.env.*`, `venv/`, `.venv/`, `__pycache__/`, `*.pyc`, `.mypy_cache/`, `.ruff_cache/`, `.git/`, `.github/`, `frontend/node_modules/`, `frontend/dist/`, `*.swp`, `.DS_Store`, `docs/`, `scripts/`, `tasks/`
- [ ] Dockerfile adiciona usuario nao-root (`appuser` com UID 1001) e usa `USER appuser` antes do CMD
- [ ] Dockerfile inclui `HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3` apontando para `/api/health`
- [ ] `# syntax=docker/dockerfile:1` adicionado no topo do Dockerfile
- [ ] Build funciona corretamente (`docker build` sem erros)
- [ ] Container sobe e responde em `/api/health`

---

### US-205: Configurar Uvicorn Workers para Producao

**Description:** As a DevOps engineer, I want the container to run multiple Uvicorn workers so that the application can handle concurrent requests without blocking.

**Acceptance Criteria:**
- [ ] Dockerfile CMD atualizado para usar Gunicorn com UvicornWorker: `gunicorn app.main:app -w 3 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --timeout 120 --graceful-timeout 30`
- [ ] `gunicorn` adicionado ao `requirements.txt`
- [ ] Numero de workers configuravel via env var `WEB_WORKERS` (default: 3)
- [ ] Graceful shutdown respeita Background Tasks em andamento (timeout de 30s)
- [ ] Build e runtime funcionam corretamente

---

### US-206: Reutilizar httpx.AsyncClient com Connection Pool

**Description:** As a developer, I want a shared httpx.AsyncClient so that ML API calls reuse TCP connections instead of creating new ones per request.

**Acceptance Criteria:**
- [ ] `ml_api.py` cria um `httpx.AsyncClient` compartilhado com `limits=httpx.Limits(max_connections=20, max_keepalive_connections=10)` e `timeout=30.0`
- [ ] O client e inicializado no startup do FastAPI (lifespan) e fechado no shutdown
- [ ] Todas as funcoes em `ml_api.py` usam o client compartilhado em vez de criar `async with httpx.AsyncClient()` a cada chamada
- [ ] `compat_copier.py` e `item_copier.py` que chamam `ml_api` nao criam seus proprios clients
- [ ] O client lida com retries e timeouts corretamente (mantendo o comportamento atual)
- [ ] Typecheck/lint passa

---

### US-207: Migrar /api/copy para Background Tasks

**Description:** As a user, I want copy operations to run in the background so that I don't get timeout errors on large batch copies.

**Acceptance Criteria:**
- [ ] `POST /api/copy` retorna imediatamente com `{"log_id": ..., "status": "in_progress"}` (status 202 Accepted)
- [ ] A copia real executa via `BackgroundTasks` do FastAPI (mesmo padrao do `POST /api/compat/copy`)
- [ ] `POST /api/copy/with-dimensions` tambem migrado para Background Tasks
- [ ] Frontend `CopyPage` ja usa polling de logs — comportamento do frontend nao muda
- [ ] Copy logs sao atualizados em tempo real durante a operacao (como compat ja faz)
- [ ] Erros durante a copia sao registrados no log com status adequado
- [ ] `POST /api/copy/retry-dimensions` tambem migrado para Background Tasks
- [ ] Typecheck/lint passa

---

### US-208: Response Models Pydantic e Validacao de Enum

**Description:** As an API consumer, I want formal response contracts and input validation so that the API is predictable and secure.

**Acceptance Criteria:**
- [ ] `CreateUserRequest.role` validado com `Literal["admin", "operator"]` (impede valores invalidos como "super_admin")
- [ ] `UpdateUserRequest.role` validado com `Optional[Literal["admin", "operator"]]`
- [ ] `response_model` declarado nos endpoints criticos: `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/admin/users`, `GET /api/admin/users`
- [ ] Response models filtram campos sensiveis (nunca retornam `password_hash`)
- [ ] Mensagens de erro user-facing que estao em ingles corrigidas para portugues (pelo menos nos routers auth, copy, compat)
- [ ] Typecheck/lint passa

---

### US-209: Frontend Error Boundary e Componentes Compartilhados

**Description:** As a user, I want the app to handle errors gracefully and as a developer, I want shared components properly organized so that maintenance is easier.

**Acceptance Criteria:**
- [ ] `ErrorBoundary` component criado em `frontend/src/components/ErrorBoundary.tsx` com fallback UI amigavel
- [ ] `ErrorBoundary` aplicado no nivel raiz do App (envolve o conteudo principal)
- [ ] `Card` component movido de `CopyPage.tsx` para `frontend/src/components/Card.tsx`
- [ ] Todos os imports de `Card` atualizados (CopyPage, CompatPage, Admin, BillingPage, UsersPage, SuperAdminPage)
- [ ] `StatusBadge` extraido para `frontend/src/components/StatusBadge.tsx` (unificando CopyPage e CompatPage)
- [ ] `normalizeItemId` extraido para `frontend/src/lib/utils.ts` (removendo duplicata de CopyForm e CompatPage)
- [ ] Side-effect `if (!logsLoaded) loadLogs()` em `CopyPage.tsx` movido para dentro de `useEffect`
- [ ] Cast `(results as any).source` removido — `source?: string` adicionado ao tipo `CopyResponse` em `lib/api.ts`
- [ ] Typecheck/lint passa
- [ ] App renderiza corretamente sem erros no console

## 4. Functional Requirements

**Security:**
- FR-1: O sistema deve limitar tentativas de login a 5/minuto por IP usando slowapi
- FR-2: O sistema deve limitar tentativas de signup a 3/minuto por IP
- FR-3: O sistema deve limitar tentativas de admin-promote a 3/15min por IP
- FR-4: O sistema deve limitar tentativas de forgot-password a 3/15min por IP
- FR-5: O sistema deve usar nonce criptografico no OAuth state, nao org_id previsivel
- FR-6: O sistema deve validar e consumir o nonce na callback OAuth (single-use, TTL 10min)
- FR-7: O sistema deve escapar HTML em qualquer dado externo renderizado em templates
- FR-8: O sistema deve exigir org_id valido em toda query multi-tenant (nunca omitir filtro)
- FR-9: O sistema deve usar comparacao constant-time para admin_master_password

**Performance:**
- FR-10: O sistema deve reutilizar conexoes HTTP para a API do MercadoLivre via connection pool
- FR-11: O sistema deve executar copias em background, retornando imediatamente ao cliente
- FR-12: O sistema deve rodar multiplos workers para processar requests concorrentes

**DevOps:**
- FR-13: A imagem Docker deve excluir arquivos sensiveis e desnecessarios via .dockerignore
- FR-14: O container deve rodar como usuario nao-root
- FR-15: O container deve ter HEALTHCHECK configurado
- FR-16: O container deve suportar graceful shutdown (30s para Background Tasks)

**API:**
- FR-17: Campos de role devem ser validados com Literal types (apenas "admin" ou "operator")
- FR-18: Endpoints criticos devem declarar response_model Pydantic
- FR-19: Response models nao devem expor password_hash ou outros campos sensiveis

**Frontend:**
- FR-20: A aplicacao deve ter Error Boundary no nivel raiz com fallback UI
- FR-21: Componentes compartilhados (Card, StatusBadge) devem residir em /components/
- FR-22: Funcoes utilitarias compartilhadas (normalizeItemId) devem residir em /lib/

## 5. Non-Goals (Out of Scope)

- **Indices de banco de dados** — removido do escopo por decisao do usuario
- **pg_cron / cleanup automatico** — removido do escopo por decisao do usuario
- **Sentry / error tracking** — removido do escopo por decisao do usuario
- **React Router** — refactor grande, fica para fase futura
- **API versioning** (/api/v1/) — fica para fase futura
- **Criptografia de tokens ML** — fica para fase futura
- **Logging estruturado JSON** — fica para fase futura
- **CI/CD pipeline** — fica para fase futura
- **Testes automatizados** — fica para fase futura
- **Acessibilidade (WCAG)** — fica para fase futura
- **Refatoracao do item_copier.py** — fica para fase futura
- **Repository pattern** — fica para fase futura
- **Migracao de token para cookies HttpOnly** — fica para fase futura

## 6. Technical Considerations

- **slowapi** depende de `limits` e usa IP do request. Em ambientes com proxy reverso (Easypanel), garantir que o IP real e extraido via `X-Forwarded-For` ou `X-Real-IP`.
- **Gunicorn + UvicornWorker** requer que o estado em memoria (`_token_locks` em ml_api.py) funcione corretamente com multiplos workers. Cada worker tera seu proprio dicionario de locks — o double-check pattern no banco mitiga race conditions entre workers.
- **httpx.AsyncClient compartilhado** deve ser criado no lifespan do FastAPI, nao como variavel global, para garantir shutdown correto.
- **Background Tasks do FastAPI** sao per-worker e nao persistentes. Se o worker morrer, a task e perdida. Isso e aceitavel para esta fase — fila de tarefas (Celery/ARQ) fica para fase futura.
- **OAuth nonce** requer tabela no Supabase ou reutilizar mecanismo existente. Uma tabela simples `oauth_states(nonce TEXT PK, org_id UUID, user_id UUID, created_at TIMESTAMPTZ)` e suficiente.

## 7. Success Metrics

- Zero vulnerabilidades criticas de seguranca (OAuth CSRF, XSS, brute force, cross-tenant leak)
- Requests de copia em batch nao causam timeout (retornam 202 imediatamente)
- Container Docker passa HEALTHCHECK e roda como usuario nao-root
- API rejeita roles invalidos e nunca expoe password_hash em responses
- Frontend nao mostra tela branca em caso de erro (Error Boundary captura)
- Tempo de resposta da ML API reduzido em ~30% com connection pooling (menos TCP handshakes)

## 8. Open Questions

- Qual o limite exato de RAM do container no Easypanel? (assumido ~1GB, 3 workers)
- O Easypanel faz proxy reverso? Se sim, slowapi precisa de configuracao de trusted proxies para extrair IP real.
- Background Tasks perdidas em restart sao aceitaveis? Se nao, considerar fila de tarefas em fase futura.
