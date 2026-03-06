# Documentação do Schema do Banco de Dados

Documentação completa da estrutura de dados da plataforma Copy Anuncios ML. O banco de dados é um Supabase (PostgreSQL) multi-tenant com isolamento de dados por organização.

**Projeto Supabase:** parts-catalogs (ID: `wrbrbhuhsaaupqsimkqz`, region: sa-east-1)

---

## Índice

1. [Visão Geral](#visão-geral)
2. [Diagrama ER](#diagrama-er)
3. [Tabelas](#tabelas)
4. [Relações](#relações)
5. [Multi-tenancy](#multi-tenancy)
6. [Histórico de Migrations](#histórico-de-migrations)
7. [Dados de Exemplo](#dados-de-exemplo)

---

## Visão Geral

O banco de dados é organizado em 4 grupos principais:

### Grupo 1: Multi-tenancy (`orgs`)
- Tabela central que define organizações (empresas/SaaS clientes)
- Isolamento de dados por `org_id`
- Integração com Stripe para pagamentos e faturamento

### Grupo 2: Autenticação & Autorização
- Gerenciamento de usuários, sessões e permissões
- Sistema de tokens de sessão (7 dias TTL)
- RBAC com 3 papéis: super_admin, admin, operator
- Auditoria via auth_logs

### Grupo 3: Operações (Copy & Compat)
- Tabelas de histórico: `copy_logs`, `compat_logs`
- Tabela de integradores: `copy_sellers` (contas ML conectadas)
- Rastreamento de execução de operações

### Grupo 4: Debug & Observabilidade
- `api_debug_logs` — histórico detalhado de chamadas à API do ML
- `password_reset_tokens` — tokens para resetar senha

---

## Diagrama ER

```
┌─────────────────────────────────────────────────────────────────┐
│                          orgs                                   │
├──────────────────────────────────────────────────────────────────┤
│ PK  id (UUID)                                                   │
│     name (TEXT)                                                 │
│     email (TEXT UNIQUE)                                         │
│     active (BOOLEAN, default: true)                            │
│     payment_active (BOOLEAN, default: false)                   │
│     stripe_customer_id (TEXT UNIQUE, nullable)                │
│     stripe_subscription_id (TEXT UNIQUE, nullable)            │
│     trial_copies_used (INTEGER, default: 0)                   │
│     trial_copies_limit (INTEGER, default: 20)                 │
│     created_at (TIMESTAMPTZ, default: NOW())                  │
│     updated_at (TIMESTAMPTZ, default: NOW())                  │
└──────┬──────────────────────────────────────────────────────────┘
       │
       ├─────────────────────────┬──────────────────────────┐
       │                         │                          │
       ▼ FK org_id              ▼ FK org_id               ▼ FK org_id
┌──────────────────────┐ ┌──────────────────┐ ┌──────────────────────┐
│       users          │ │  copy_sellers    │ │   user_permissions   │
├──────────────────────┤ ├──────────────────┤ ├──────────────────────┤
│ PK id (UUID)         │ │ PK id (UUID)     │ │ PK id (UUID)         │
│ org_id (FK)          │ │ org_id (FK)      │ │ org_id (FK)          │
│ email (TEXT, nullable)
│ username (TEXT)      │ │ slug (TEXT)      │ │ user_id (FK users)   │
│ password_hash (TEXT) │ │ active (BOOLEAN) │ │ seller_slug (TEXT)   │
│ role (admin|operator)│ │                  │ │ can_copy_from (BOOL) │
│ is_super_admin (BOOL)│ │ ml_user_id       │ │ can_copy_to (BOOL)   │
│ can_run_compat (BOOL)│ │ ml_access_token  │ │                      │
│ active (BOOLEAN)     │ │ ml_refresh_token │ │ UNIQUE(user_id,     │
│ created_at (TS)      │ │ ml_token_expires │ │         seller_slug) │
│ last_login_at (TS)   │ │ official_store_id│ │                      │
│                      │ │ created_at (TS)  │ │                      │
│                      │ │ updated_at (TS)  │ │                      │
└──────┬───────────────┘ └──────────────────┘ └──────────────────────┘
       │
       ├───────────────────────────────────────────────┐
       │                                               │
       ▼ FK user_id                              ▼ FK user_id
┌──────────────────────┐               ┌──────────────────────────┐
│  user_sessions       │               │ password_reset_tokens    │
├──────────────────────┤               ├──────────────────────────┤
│ PK id (UUID)         │               │ PK id (SERIAL)           │
│ user_id (FK)         │               │ user_id (FK)             │
│ token (TEXT UNIQUE)  │               │ token (TEXT UNIQUE)      │
│ created_at (TS)      │               │ expires_at (TIMESTAMPTZ) │
│ expires_at (TS)      │               │ created_at (TS)          │
└──────────────────────┘               └──────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│                   Logs (org-scoped)                            │
├────────────┬──────────────────┬──────────────────────────────────┤
│  copy_logs │  compat_logs     │   api_debug_logs / auth_logs     │
├────────────┼──────────────────┼──────────────────────────────────┤
│ PK id      │ PK id            │ PK id                            │
│ user_id    │ user_id          │ user_id (nullable)               │
│ org_id     │ org_id           │ org_id (nullable)                │
│ source_...│ source_item_id   │ action / api_method              │
│ dest_...  │ skus[]           │ request_payload / response_body  │
│ created_at│ targets (JSONB)  │ error_message / attempt_number   │
└────────────┴──────────────────┴──────────────────────────────────┘
```

---

## Tabelas

### 1. `orgs` — Organizações (Multi-tenant)

**Propósito:** Representa uma organização (cliente SaaS) na plataforma. Cada organização é isolada por `org_id` em todas as tabelas operacionais.

**Colunas:**

| Nome | Tipo | Nullable | Default | Constraints |
|------|------|----------|---------|-------------|
| `id` | UUID | ✗ | gen_random_uuid() | PK |
| `name` | TEXT | ✗ | — | Nome da empresa |
| `email` | TEXT | ✗ | — | UNIQUE |
| `active` | BOOLEAN | ✗ | true | Org desativada = acesso bloqueado |
| `payment_active` | BOOLEAN | ✗ | false | Se assinou (libera limite de cópias) |
| `stripe_customer_id` | TEXT | ✓ | — | UNIQUE, FK para Stripe |
| `stripe_subscription_id` | TEXT | ✓ | — | UNIQUE, ID da subscription ativa |
| `trial_copies_used` | INTEGER | ✗ | 0 | Contador de cópias trial usadas |
| `trial_copies_limit` | INTEGER | ✗ | 20 | Limite gratuito (padrão: 20) |
| `created_at` | TIMESTAMPTZ | ✗ | NOW() | Timestamp de criação |
| `updated_at` | TIMESTAMPTZ | ✗ | NOW() | Timestamp da última atualização |

**Índices:**
- `idx_orgs_email` — para busca rápida por email
- `idx_orgs_stripe_customer` — para webhook de Stripe

**Relacionamentos:**
- 1 org → N users
- 1 org → N copy_sellers
- 1 org → N copy_logs
- 1 org → N compat_logs
- 1 org → N user_permissions
- 1 org → N auth_logs
- 1 org → N api_debug_logs

---

### 2. `users` — Usuários

**Propósito:** Representa um usuário do sistema com autenticação, função e permissões.

**Colunas:**

| Nome | Tipo | Nullable | Default | Constraints |
|------|------|----------|---------|-------------|
| `id` | UUID | ✗ | gen_random_uuid() | PK |
| `org_id` | UUID | ✗ | — | FK → orgs(id) ON DELETE CASCADE |
| `email` | TEXT | ✓ | — | Email (opcional, para reset de senha) |
| `username` | TEXT | ✗ | — | UNIQUE index per org: `idx_users_org_username` |
| `password_hash` | TEXT | ✗ | — | bcrypt hash (nunca retornar ao cliente) |
| `role` | TEXT | ✗ | 'operator' | CHECK: admin \| operator |
| `is_super_admin` | BOOLEAN | ✗ | false | Administrador da plataforma (global) |
| `can_run_compat` | BOOLEAN | ✗ | false | Permissão para rodar compatibilidades |
| `active` | BOOLEAN | ✗ | true | Usuário desativado = não pode logar |
| `created_at` | TIMESTAMPTZ | ✗ | NOW() | Timestamp de criação |
| `last_login_at` | TIMESTAMPTZ | ✓ | — | Última autenticação bem-sucedida |

**Índices:**
- `idx_users_org` — org_id
- `idx_users_org_username` — UNIQUE(org_id, username)
- `idx_users_email` — UNIQUE(email) WHERE email IS NOT NULL

**Papéis (RBAC):**
- **super_admin** (is_super_admin=true): Acesso global a todas as orgs, ignora org_id
- **admin** (role='admin'): Acesso completo dentro da org (users, permissions, cópias ilimitadas)
- **operator** (role='operator'): Acesso filtrado por seller_slug via user_permissions

**Relacionamentos:**
- N users → 1 org
- 1 user → N user_sessions
- 1 user → N user_permissions
- 1 user → N copy_logs (opcional)
- 1 user → N compat_logs (opcional)
- 1 user → N auth_logs (opcional)
- 1 user → N password_reset_tokens
- 1 user → N api_debug_logs (opcional)

---

### 3. `user_sessions` — Sessões de Autenticação

**Propósito:** Rastreia tokens de sessão ativa com expiração (7 dias).

**Colunas:**

| Nome | Tipo | Nullable | Default | Constraints |
|------|------|----------|---------|-------------|
| `id` | UUID | ✗ | gen_random_uuid() | PK (gerado mas não usado para lookup) |
| `user_id` | UUID | ✗ | — | FK → users(id) ON DELETE CASCADE |
| `token` | TEXT | ✗ | — | UNIQUE, 32-byte URL-safe (secrets.token_urlsafe) |
| `created_at` | TIMESTAMPTZ | ✗ | NOW() | Timestamp de criação |
| `expires_at` | TIMESTAMPTZ | ✗ | — | NOW() + 7 days |

**Fluxo de Autenticação:**
1. POST `/api/auth/login` → verifica email + bcrypt → cria row em user_sessions
2. Token é retornado ao cliente, armazenado em localStorage
3. Cliente envia via header `X-Auth-Token` em todas as requests
4. `require_user()` dependency busca `user_sessions.token` e verifica `expires_at`
5. Sessão expirada = row é deletada, 401 retornado

**Limpeza:**
- ON DELETE CASCADE garante que ao deletar user, todas as sessões são limpas
- Sessões expiradas são limpas lazily quando cliente tenta usar

---

### 4. `user_permissions` — Permissões por Seller

**Propósito:** Define quais sellers um operator pode copiar FROM/TO.

**Colunas:**

| Nome | Tipo | Nullable | Default | Constraints |
|------|------|----------|---------|-------------|
| `id` | UUID | ✗ | gen_random_uuid() | PK (gerado mas lookup via user_id + seller_slug) |
| `org_id` | UUID | ✗ | — | FK → orgs(id) ON DELETE CASCADE |
| `user_id` | UUID | ✗ | — | FK → users(id) ON DELETE CASCADE |
| `seller_slug` | TEXT | ✗ | — | Slug do seller (ex: "lever-money") |
| `can_copy_from` | BOOLEAN | ✗ | false | Pode copiar anúncios FROM este seller |
| `can_copy_to` | BOOLEAN | ✗ | false | Pode copiar anúncios TO este seller |
| — | — | — | — | UNIQUE(user_id, seller_slug) |

**Notas:**
- Admins (`role='admin'`) ignoram estas permissões (full access)
- Operators devem ter entrada na tabela para cada seller que usam
- Operador com admin permission: pode usar ambos can_copy_from e can_copy_to

**Exemplo:**
```
user_id: 12345, seller_slug: "lever-money", can_copy_from: true, can_copy_to: false
→ Operador pode copiar FROM lever-money, mas NÃO pode copiar TO
```

---

### 5. `auth_logs` — Auditoria de Autenticação

**Propósito:** Histórico de eventos de login, logout, signup, admin_promote, falhas.

**Colunas:**

| Nome | Tipo | Nullable | Default | Constraints |
|------|------|----------|---------|-------------|
| `id` | UUID | ✗ | gen_random_uuid() | PK |
| `org_id` | UUID | ✓ | — | FK → orgs(id) ON DELETE SET NULL |
| `user_id` | UUID | ✓ | — | FK → users(id) ON DELETE SET NULL |
| `username` | TEXT | ✓ | — | Username no momento do log (para failed logins) |
| `action` | TEXT | ✗ | — | login \| logout \| login_failed \| signup \| admin_promote |
| `created_at` | TIMESTAMPTZ | ✗ | NOW() | Timestamp |

**Ações:**
- `login` — autenticação bem-sucedida
- `login_failed` — tentativa de login com senha errada ou user inativo
- `logout` — POST /api/auth/logout
- `signup` — novo usuário criado via POST /api/auth/signup
- `admin_promote` — primeiro admin criado via POST /api/auth/admin-promote

---

### 6. `copy_sellers` — Contas ML Conectadas

**Propósito:** Rastreia contas de Mercado Livre conectadas via OAuth2, com tokens de acesso.

**Colunas:**

| Nome | Tipo | Nullable | Default | Constraints |
|------|------|----------|---------|-------------|
| `id` | UUID | ✗ | gen_random_uuid() | PK |
| `org_id` | UUID | ✗ | — | FK → orgs(id) ON DELETE CASCADE |
| `slug` | TEXT | ✗ | — | Slug único per org: `idx_copy_sellers_org_slug` |
| `active` | BOOLEAN | ✗ | true | Seller desativado = não aparece em dropdowns |
| `ml_user_id` | TEXT | ✗ | — | ML user ID (ex: "12345678") |
| `ml_access_token` | TEXT | ✗ | — | OAuth2 access token (refreshable) |
| `ml_refresh_token` | TEXT | ✗ | — | OAuth2 refresh token |
| `ml_token_expires_at` | TIMESTAMPTZ | ✗ | — | Token expiry time |
| `official_store_id` | INTEGER | ✓ | — | ID da loja oficial (para brand accounts, cacheado) |
| `created_at` | TIMESTAMPTZ | ✗ | NOW() | Timestamp de conexão |
| `updated_at` | TIMESTAMPTZ | ✗ | NOW() | Timestamp da última atualização |

**Fluxo OAuth:**
1. User acessa GET `/api/ml/install` → redireciona para ML OAuth
2. User autoriza → ML redireciona para `/api/ml/callback?code=...`
3. Backend troca `code` por `access_token` + `refresh_token`
4. Nova row criada em copy_sellers
5. Token auto-refresh via `_get_token()` quando próximo de expirar

**Tokens:**
- Armazenados em plaintext (segurança = RBAC no Supabase + service_role key)
- Auto-refresh acontece em background antes de expirar
- Se refresh falhar, seller fica desconectado (manual reconnect needed)

---

### 7. `copy_logs` — Histórico de Cópias de Anúncios

**Propósito:** Rastreia cada operação de cópia de anúncios (POST /api/copy).

**Colunas:**

| Nome | Tipo | Nullable | Default | Constraints |
|------|------|----------|---------|-------------|
| `id` | BIGSERIAL | ✗ | auto-increment | PK |
| `org_id` | UUID | ✓ | — | FK → orgs(id) ON DELETE SET NULL |
| `user_id` | UUID | ✓ | — | FK → users(id) ON DELETE SET NULL |
| `source_seller` | TEXT | ✗ | — | Seller slug de origem (ex: "lever-money") |
| `dest_sellers` | TEXT[] | ✗ | — | Array de seller slugs de destino (ex: ["seller1", "seller2"]) |
| `source_item_id` | TEXT | ✗ | — | ID do item no ML (ex: "MLBxxxxxxxxxxxxx") |
| `status` | TEXT | ✗ | — | pending \| in_progress \| success \| error \| partial |
| `error_message` | TEXT | ✓ | — | Descrição do erro (se status=error) |
| `created_at` | TIMESTAMPTZ | ✗ | NOW() | Timestamp da requisição |
| `completed_at` | TIMESTAMPTZ | ✓ | — | Timestamp da conclusão |

**Estados:**
- `pending` — operação enfileirada
- `in_progress` — cópia em andamento
- `success` — todos os destinos copiados com sucesso
- `partial` — alguns destinos falharam (error_message tem detalhes)
- `error` — nenhum destino conseguiu copiar

**Polling:**
- Frontend faz polling GET /api/copy/logs a cada 5s enquanto operation em progress
- Quando status != pending/in_progress, frontend para polling

---

### 8. `compat_logs` — Histórico de Compatibilidades Veiculares

**Propósito:** Rastreia operações de cópia de compatibilidades veiculares.

**Colunas:**

| Nome | Tipo | Nullable | Default | Constraints |
|------|------|----------|---------|-------------|
| `id` | BIGSERIAL | ✗ | auto-increment | PK |
| `org_id` | UUID | ✓ | — | FK → orgs(id) ON DELETE SET NULL |
| `user_id` | UUID | ✓ | — | FK → users(id) ON DELETE SET NULL |
| `source_item_id` | TEXT | ✗ | — | ID do item no ML com compatibilidades |
| `skus` | TEXT[] | ✗ | — | Array de SKUs extraídos do item |
| `targets` | JSONB | ✗ | — | Config de destino: {sellers: [], categories: []} |
| `total_targets` | INT | ✗ | — | Contagem total de targets a processar |
| `success_count` | INT | ✗ | — | Targets processados com sucesso |
| `error_count` | INT | ✗ | — | Targets com erro |
| `status` | TEXT | ✗ | 'in_progress' | in_progress \| success \| error \| partial |
| `error_message` | TEXT | ✓ | — | Descrição de erro geral (se aplicável) |
| `created_at` | TIMESTAMPTZ | ✗ | NOW() | Timestamp da requisição |

**Targets (JSONB):**
```json
{
  "sellers": ["seller1", "seller2"],
  "categories": ["MLC123", "MLC456"]
}
```

**Fluxo:**
1. User submete POST /api/compat/copy com source item + target sellers/categories
2. Backend extrai SKUs do item
3. Cria compat_logs row (status='in_progress')
4. Background task busca compatibilidades no ML
5. Cria/atualiza items nos sellers de destino
6. Atualiza success_count/error_count

---

### 9. `api_debug_logs` — Histórico Detalhado de Chamadas ML

**Propósito:** Debug de erros de cópia — rastreia CADA chamada à API do ML (requests/responses completas).

**Colunas:**

| Nome | Tipo | Nullable | Default | Constraints |
|------|------|----------|---------|-------------|
| `id` | BIGSERIAL | ✗ | auto-increment | PK |
| `org_id` | UUID | ✓ | — | FK → orgs(id) ON DELETE SET NULL |
| `user_id` | UUID | ✓ | — | FK → users(id) ON DELETE SET NULL |
| `copy_log_id` | BIGINT | ✓ | — | FK → copy_logs(id) (opcional) |
| `created_at` | TIMESTAMPTZ | ✗ | NOW() | Timestamp |
| `action` | TEXT | ✗ | — | copy_item \| get_item \| get_compat \| search_sku \| etc |
| `source_seller` | TEXT | ✓ | — | Seller de origem |
| `dest_seller` | TEXT | ✓ | — | Seller de destino |
| `source_item_id` | TEXT | ✓ | — | Item ID de origem |
| `dest_item_id` | TEXT | ✓ | — | Item ID de destino (pode ser nulo se falhou na criação) |
| `api_method` | TEXT | ✓ | — | GET \| POST \| PUT \| PATCH |
| `api_url` | TEXT | ✓ | — | URL completa da API |
| `request_payload` | JSONB | ✓ | — | Body completo do request (pode ser grande) |
| `response_status` | INT | ✓ | — | HTTP status (ex: 400, 403, 429) |
| `response_body` | JSONB | ✓ | — | Response completa do ML (tem `cause[]` array) |
| `error_message` | TEXT | ✓ | — | Mensagem de erro extraída |
| `attempt_number` | INT | ✗ | 1 | Qual tentativa foi (retry counter) |
| `adjustments` | TEXT[] | ✓ | — | Array de adjustments aplicados (ex: ["removed_title", "removed_shipping"]) |
| `resolved` | BOOLEAN | ✗ | false | Flag: problema foi resolvido? |

**Uso:**
- Quando ocorre erro na cópia, log é inserido com detalhes completos
- Support/developer consulta `api_debug_logs` para entender causa do erro
- `resolved` marcado como true quando problema foi fix e item copiado com sucesso
- Índices garantem busca rápida por created_at e source_item_id

---

### 10. `password_reset_tokens` — Tokens de Reset de Senha

**Propósito:** Tokens temporários para reset de senha via email.

**Colunas:**

| Nome | Tipo | Nullable | Default | Constraints |
|------|------|----------|---------|-------------|
| `id` | SERIAL | ✗ | auto-increment | PK |
| `user_id` | UUID | ✗ | — | FK → users(id) ON DELETE CASCADE |
| `token` | TEXT | ✗ | — | UNIQUE, token aleatório enviado por email |
| `expires_at` | TIMESTAMPTZ | ✗ | — | Expiração (ex: NOW() + 1 hour) |
| `created_at` | TIMESTAMPTZ | ✗ | NOW() | Timestamp |

**Fluxo:**
1. User: POST /api/auth/forgot-password com email
2. Backend busca user por email
3. Gera token aleatório + expires_at = NOW() + 1 hour
4. Insere em password_reset_tokens
5. Envia email com link `/reset-password?token=...`
6. User: POST /api/auth/reset-password com token + new_password
7. Backend valida token (exists + not expired), atualiza password_hash, deleta token

---

## Relações

### Isolamento por Organização (Multi-tenancy)

Todas as operações devem ser filtradas por `org_id` para garantir isolamento de dados. Super admins têm acesso a todas as orgs.

**Tabelas com org_id NOT NULL (Core):**
- `users` — users só acessam dados da própria org
- `copy_sellers` — sellers pertencem a uma org específica
- `user_permissions` — permissões scoped por org

**Tabelas com org_id nullable (Logs):**
- `copy_logs`, `compat_logs`, `api_debug_logs`, `auth_logs` — org_id seta NULL se org deletada

**Queries exemplo:**
```sql
-- Listar sellers da org do usuário
SELECT * FROM copy_sellers WHERE org_id = $1 AND active = true;

-- Histórico de cópias da org
SELECT * FROM copy_logs WHERE org_id = $1 ORDER BY created_at DESC;

-- Todas as orgs (super_admin only)
SELECT * FROM orgs WHERE active = true;
```

### Usuário → Seller (Operador com Permissões)

Um operador pode ter diferentes permissões para cada seller conectado:

```sql
-- Permissões do operador 'joao' na org 'levermoney'
SELECT up.seller_slug, up.can_copy_from, up.can_copy_to
FROM user_permissions up
JOIN users u ON up.user_id = u.id
WHERE u.username = 'joao' AND u.org_id = 'org-id' AND up.org_id = 'org-id';
```

### Fluxo de Cópia (Users → Sellers → Logs)

1. User (com role=admin ou com permissions na seller) submete POST /api/copy
2. Request validada: user tem can_copy_from source + can_copy_to all dests
3. copy_sellers buscado para obter tokens ML
4. Para cada dest_seller, copy_logs criado (status=pending)
5. Background task executa cópia
6. copy_logs atualizado com status final (success/error/partial)
7. Se houve erro, api_debug_logs tem detalhes

---

## Multi-tenancy

### Arquitetura

- **Database único** — todas as orgs compartilham mesmo DB PostgreSQL
- **Row-level Security (RLS)** desativado — usamos service_role key do backend
- **Isolamento via aplicação** — backend sempre filtra queries por org_id
- **Super admin bypass** — super admins ignoram org_id, acessam tudo

### Princípios

1. **Sempre filtrar por org_id** em queries de dados operacionais
2. **Verificar org ativo** antes de permitir operação (require_active_org dependency)
3. **Deletar org = cascade** em users/copy_sellers/user_permissions, SET NULL em logs
4. **Unique constraints org-scoped** — username, seller_slug são únicos por org (não globalmente)

### Exemplo: Checkout Stripe

```python
# Quando user clica em "Assinar", backend:
org = db.table("orgs").select("*").eq("id", user["org_id"]).single().execute()
# Cria customer Stripe linked à org
customer = stripe.Customer.create(
    email=org["email"],
    name=org["name"],
    metadata={"org_id": str(org["id"])}
)
# Salva Stripe ID na org
db.table("orgs").update({"stripe_customer_id": customer.id}).eq("id", org["id"]).execute()

# Webhook Stripe usa metadata para atualizar org correta
event = stripe.Event.construct_from(json.loads(request.body), stripe.api_key)
org_id = event.data.object.metadata["org_id"]
db.table("orgs").update({"payment_active": True}).eq("id", org_id).execute()
```

---

## Histórico de Migrations

### Migration 001: `compat_logs` — Criação inicial

**Data:** Primeira migration (não datada, adicionada progressivamente)

**Tabelas criadas:**
- `compat_logs` — rastreamento de operações de compatibilidade

**Mudanças:**
```sql
CREATE TABLE IF NOT EXISTS compat_logs (
    id BIGSERIAL PRIMARY KEY,
    source_item_id TEXT NOT NULL,
    skus TEXT[] NOT NULL,
    targets JSONB NOT NULL,
    total_targets INT NOT NULL,
    success_count INT NOT NULL,
    error_count INT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

### Migration 002: `admin_sessions` — Sessões de Admin (Deprecated)

**Data:** Anterior à migration 004

**Mudanças:**
- Adicionou `session_token` e `session_created_at` à tabela `admin_config` (tabela legado)
- **Status:** Deprecated — substituído por `user_sessions` em migration 004

---

### Migration 003: `compat_logs_status` — Adiciona Status

**Data:** Após 002

**Mudanças:**
```sql
ALTER TABLE compat_logs ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'in_progress';
```

**Razão:** Rastrear progresso de operações async.

---

### Migration 004: `user_auth` — Sistema de Auth Completo

**Data:** Posterior

**Tabelas criadas:**
- `users` — usuários com bcrypt password, role, can_run_compat, org_id (nullable no início)
- `user_sessions` — tokens de sessão (7 dias TTL)
- `user_permissions` — permissões por seller (can_copy_from/to)
- `auth_logs` — auditoria de login/logout/signup/admin_promote

**Mudanças em tabelas existentes:**
```sql
ALTER TABLE copy_logs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE compat_logs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
```

**Razão:** Implementar autenticação via bcrypt + session tokens, RBAC.

---

### Migration 005: `api_debug_logs` — Debug de Erros

**Data:** Após 004

**Tabelas criadas:**
- `api_debug_logs` — rastreamento completo de chamadas ML (request/response/error)

**Mudanças:**
- Índices: `idx_debug_logs_created`, `idx_debug_logs_source_item`

**Razão:** Facilitar diagnóstico de erros de cópia sem depender de stdout logs.

---

### Migration 006: `seller_official_store_id` — Cache para Brand Accounts

**Data:** Após 005

**Mudanças:**
```sql
ALTER TABLE copy_sellers ADD COLUMN IF NOT EXISTS official_store_id integer;
```

**Razão:** Cachear `official_store_id` para lojas oficiais (brand accounts) evitar queries extras ao ML.

---

### Migration 007: `multi_tenant` — Arquitetura Multi-tenant Completa

**Data:** Crítica — transformação de arquitetura

**Tabelas criadas:**
- `orgs` — nova tabela central

**Mudanças em tabelas existentes:**
```sql
ALTER TABLE users ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE copy_sellers ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE user_permissions ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE CASCADE;
ALTER TABLE copy_logs ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;
ALTER TABLE compat_logs ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;
ALTER TABLE api_debug_logs ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;
ALTER TABLE auth_logs ADD COLUMN org_id UUID REFERENCES orgs(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN email TEXT;
```

**Índices criados:**
- `idx_orgs_email`
- `idx_orgs_stripe_customer`
- `idx_users_org`, `idx_users_org_username`
- `idx_copy_sellers_org`, `idx_copy_sellers_org_slug`
- `idx_user_permissions_org`
- `idx_copy_logs_org`, `idx_compat_logs_org`
- `idx_api_debug_logs_org`, `idx_auth_logs_org`
- `idx_users_email` (UNIQUE partial)

**Razão:** Transformar plataforma single-tenant para multi-tenant SaaS.

---

### Migration 008: `backfill_org_data` — Popula Dados Existentes

**Data:** Imediatamente após 007

**Mudanças:**
```sql
-- 1. Cria org padrão (Lever Money)
INSERT INTO orgs (id, name, email, active, payment_active)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, 'Lever Money', 'eryk@levermoney.com.br', true, true)
ON CONFLICT (id) DO NOTHING;

-- 2. Backfill org_id em todas as tabelas
UPDATE users SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE copy_sellers SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
-- ... (mais UPDATEs)

-- 3. Set eryk como super admin
UPDATE users SET is_super_admin = true WHERE username = 'eryk';

-- 4. Torna org_id NOT NULL em tabelas core
ALTER TABLE users ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE copy_sellers ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE user_permissions ALTER COLUMN org_id SET NOT NULL;

-- 5. Recria unique constraints org-scoped
ALTER TABLE users DROP CONSTRAINT users_username_key;
CREATE UNIQUE INDEX idx_users_org_username ON users(org_id, username);
ALTER TABLE copy_sellers DROP CONSTRAINT copy_sellers_slug_key;
CREATE UNIQUE INDEX idx_copy_sellers_org_slug ON copy_sellers(org_id, slug);
```

**Razão:** Migrar dados existentes (single-tenant) para org padrão, finalizando schema multi-tenant.

---

### Migration 009: `password_reset_tokens` — Reset de Senha

**Data:** Após 008

**Tabelas criadas:**
- `password_reset_tokens` — tokens para resetar senha via email

**Mudanças:**
- Índices: `idx_password_reset_tokens_token`, `idx_password_reset_tokens_user`

**Razão:** Implementar fluxo "Esqueci minha senha".

---

### Migration 010: `trial_copies` — Limite de Cópias Trial

**Data:** Após 009

**Mudanças:**
```sql
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS trial_copies_used integer NOT NULL DEFAULT 0;
ALTER TABLE orgs ADD COLUMN IF NOT EXISTS trial_copies_limit integer NOT NULL DEFAULT 20;
```

**Razão:** Implementar trial com limite de 20 cópias gratuitas antes de assinar.

---

## Dados de Exemplo

### Exemplo 1: Organização com Dois Usuários e Três Sellers

```
-- Organização
orgs:
  id: 11111111-1111-1111-1111-111111111111
  name: "Lever Money"
  email: "eryk@levermoney.com.br"
  active: true
  payment_active: true
  stripe_customer_id: "cus_ABC123"
  stripe_subscription_id: "sub_XYZ789"
  trial_copies_used: 0
  trial_copies_limit: 20
  created_at: 2025-01-15 10:00:00+00

-- Usuário 1: Admin
users:
  id: 22222222-2222-2222-2222-222222222222
  org_id: 11111111-1111-1111-1111-111111111111
  username: "eryk"
  email: "eryk@levermoney.com.br"
  password_hash: "$2b$12$..."
  role: "admin"
  is_super_admin: false
  can_run_compat: true
  active: true
  created_at: 2025-01-15 10:00:00+00
  last_login_at: 2026-03-05 14:30:00+00

-- Usuário 2: Operador
users:
  id: 33333333-3333-3333-3333-333333333333
  org_id: 11111111-1111-1111-1111-111111111111
  username: "joao"
  email: "joao@levermoney.com.br"
  password_hash: "$2b$12$..."
  role: "operator"
  is_super_admin: false
  can_run_compat: false
  active: true
  created_at: 2025-02-01 09:15:00+00
  last_login_at: 2026-03-04 16:45:00+00

-- Sessão ativa para eryk
user_sessions:
  id: 44444444-4444-4444-4444-444444444444
  user_id: 22222222-2222-2222-2222-222222222222
  token: "abcdef123456789..."
  created_at: 2026-03-05 14:30:00+00
  expires_at: 2026-03-12 14:30:00+00

-- Seller 1: Principal (ml_user_id: 12345678)
copy_sellers:
  id: 55555555-5555-5555-5555-555555555555
  org_id: 11111111-1111-1111-1111-111111111111
  slug: "lever-money"
  active: true
  ml_user_id: "12345678"
  ml_access_token: "APP_USR-1234567890..."
  ml_refresh_token: "TG-......"
  ml_token_expires_at: 2026-04-05 08:00:00+00
  official_store_id: null
  created_at: 2025-01-20 11:00:00+00
  updated_at: 2026-03-05 10:00:00+00

-- Seller 2: Secundário (ml_user_id: 87654321)
copy_sellers:
  id: 66666666-6666-6666-6666-666666666666
  org_id: 11111111-1111-1111-1111-111111111111
  slug: "seller-secundario"
  active: true
  ml_user_id: "87654321"
  ml_access_token: "APP_USR-0987654321..."
  ml_refresh_token: "TG-......"
  ml_token_expires_at: 2026-03-25 15:30:00+00
  official_store_id: null
  created_at: 2025-02-10 14:20:00+00
  updated_at: 2026-03-05 09:30:00+00

-- Seller 3: Inativo
copy_sellers:
  id: 77777777-7777-7777-7777-777777777777
  org_id: 11111111-1111-1111-1111-111111111111
  slug: "seller-antigo"
  active: false
  ml_user_id: "55555555"
  ml_access_token: "[redacted]"
  ml_refresh_token: "[redacted]"
  ml_token_expires_at: 2025-12-01 00:00:00+00
  official_store_id: null
  created_at: 2025-01-10 08:00:00+00
  updated_at: 2025-12-15 10:00:00+00

-- Permissões: joao pode copiar FROM/TO principais, mas SÓ FROM secundário
user_permissions:
  id: 88888888-8888-8888-8888-888888888888
  org_id: 11111111-1111-1111-1111-111111111111
  user_id: 33333333-3333-3333-3333-333333333333
  seller_slug: "lever-money"
  can_copy_from: true
  can_copy_to: true

user_permissions:
  id: 99999999-9999-9999-9999-999999999999
  org_id: 11111111-1111-1111-1111-111111111111
  user_id: 33333333-3333-3333-3333-333333333333
  seller_slug: "seller-secundario"
  can_copy_from: true
  can_copy_to: false
```

### Exemplo 2: Fluxo de Cópia com Logs

```
-- User joao submete POST /api/copy
-- - source: "lever-money"
-- - destinations: ["seller-secundario"]
-- - item_ids: ["MLBxxxxxxxxxxxxxx"]

-- copy_logs criado (inicial)
copy_logs:
  id: 1001
  org_id: 11111111-1111-1111-1111-111111111111
  user_id: 33333333-3333-3333-3333-333333333333
  source_seller: "lever-money"
  dest_sellers: ["seller-secundario"]
  source_item_id: "MLBxxxxxxxxxxxxxx"
  status: "in_progress"
  error_message: null
  created_at: 2026-03-05 14:35:00+00
  completed_at: null

-- api_debug_logs: Tentativa 1 de GET item
api_debug_logs:
  id: 5001
  org_id: 11111111-1111-1111-1111-111111111111
  user_id: 33333333-3333-3333-3333-333333333333
  copy_log_id: 1001
  created_at: 2026-03-05 14:35:01+00
  action: "get_item"
  source_seller: "lever-money"
  dest_seller: null
  source_item_id: "MLBxxxxxxxxxxxxxx"
  dest_item_id: null
  api_method: "GET"
  api_url: "https://api.mercadolibre.com/items/MLBxxxxxxxxxxxxxx"
  request_payload: null
  response_status: 200
  response_body: {"id": "MLBxxxxxxxxxxxxxx", "title": "...", ...}
  error_message: null
  attempt_number: 1
  adjustments: null
  resolved: true

-- api_debug_logs: Tentativa 1 de POST item (criar novo no destino)
api_debug_logs:
  id: 5002
  org_id: 11111111-1111-1111-1111-111111111111
  user_id: 33333333-3333-3333-3333-333333333333
  copy_log_id: 1001
  created_at: 2026-03-05 14:35:02+00
  action: "copy_item"
  source_seller: "lever-money"
  dest_seller: "seller-secundario"
  source_item_id: "MLBxxxxxxxxxxxxxx"
  dest_item_id: null
  api_method: "POST"
  api_url: "https://api.mercadolibre.com/items"
  request_payload: {"title": "...", "price": 100.00, ...}
  response_status: 400
  response_body: {
    "message": "Invalid request",
    "cause": [
      {"type": "error", "code": 102, "message": "[title] The field is required"}
    ]
  }
  error_message: "[title] The field is required"
  attempt_number: 1
  adjustments: null
  resolved: false

-- api_debug_logs: Tentativa 2 de POST item (sem title, usando family_name)
api_debug_logs:
  id: 5003
  org_id: 11111111-1111-1111-1111-111111111111
  user_id: 33333333-3333-3333-3333-333333333333
  copy_log_id: 1001
  created_at: 2026-03-05 14:35:03+00
  action: "copy_item"
  source_seller: "lever-money"
  dest_seller: "seller-secundario"
  source_item_id: "MLBxxxxxxxxxxxxxx"
  dest_item_id: null
  api_method: "POST"
  api_url: "https://api.mercadolibre.com/items"
  request_payload: {"family_name": "...", "price": 100.00, ...}
  response_status: 201
  response_body: {"id": "MLByyyyyyyyyyyy", "status": "active", ...}
  error_message: null
  attempt_number: 2
  adjustments: ["removed_title", "added_family_name"]
  resolved: true

-- copy_logs atualizado (sucesso)
copy_logs:
  id: 1001
  org_id: 11111111-1111-1111-1111-111111111111
  user_id: 33333333-3333-3333-3333-333333333333
  source_seller: "lever-money"
  dest_sellers: ["seller-secundario"]
  source_item_id: "MLBxxxxxxxxxxxxxx"
  status: "success"
  error_message: null
  created_at: 2026-03-05 14:35:00+00
  completed_at: 2026-03-05 14:35:04+00

-- trial_copies_used incrementado
orgs:
  id: 11111111-1111-1111-1111-111111111111
  ...
  trial_copies_used: 1
  ...
```

### Exemplo 3: Operação de Compatibilidade

```
-- User eryk submete POST /api/compat/copy
-- - source_item_id: "MLBxxxxxxxxxxxxxx"
-- - targets: {
--     "sellers": ["seller-secundario"],
--     "categories": ["MLC1234", "MLC5678"]
--   }

-- compat_logs criado
compat_logs:
  id: 2001
  org_id: 11111111-1111-1111-1111-111111111111
  user_id: 22222222-2222-2222-2222-222222222222
  source_item_id: "MLBxxxxxxxxxxxxxx"
  skus: ["SKU-001", "SKU-002"]
  targets: {
    "sellers": ["seller-secundario"],
    "categories": ["MLC1234", "MLC5678"]
  }
  total_targets: 4
  success_count: 3
  error_count: 1
  status: "partial"
  error_message: "Erro ao criar compatibilidade para MLC5678"
  created_at: 2026-03-05 15:00:00+00

-- api_debug_logs: Buscar compatibilidades do item
api_debug_logs:
  id: 5010
  org_id: 11111111-1111-1111-1111-111111111111
  user_id: 22222222-2222-2222-2222-222222222222
  copy_log_id: null
  created_at: 2026-03-05 15:00:01+00
  action: "get_compat"
  source_seller: "lever-money"
  dest_seller: null
  source_item_id: "MLBxxxxxxxxxxxxxx"
  dest_item_id: null
  api_method: "GET"
  api_url: "https://api.mercadolibre.com/items/MLBxxxxxxxxxxxxxx/compatibilities"
  request_payload: null
  response_status: 200
  response_body: {"products": [...]}
  error_message: null
  attempt_number: 1
  adjustments: null
  resolved: true
```

### Exemplo 4: Auditoria de Login

```
-- User joao tenta login com senha errada
auth_logs:
  id: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
  org_id: 11111111-1111-1111-1111-111111111111
  user_id: 33333333-3333-3333-3333-333333333333
  username: "joao"
  action: "login_failed"
  created_at: 2026-03-05 13:45:00+00

-- User joao faz login com sucesso
auth_logs:
  id: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
  org_id: 11111111-1111-1111-1111-111111111111
  user_id: 33333333-3333-3333-3333-333333333333
  username: "joao"
  action: "login"
  created_at: 2026-03-05 13:46:00+00

-- Eryk promove novo admin
auth_logs:
  id: cccccccc-cccc-cccc-cccc-cccccccccccc
  org_id: 11111111-1111-1111-1111-111111111111
  user_id: null
  username: "novo-admin"
  action: "admin_promote"
  created_at: 2026-03-05 14:00:00+00
```

---

## Notas Importantes

### Segurança

1. **Nunca retornar `password_hash`** ao cliente em qualquer endpoint
2. **Tokens são únicos** — validar via `user_sessions.token` (não reuse)
3. **Tokens expiram em 7 dias** — require_user() verifica `expires_at`
4. **Super admin é global** — verificar `is_super_admin`, não depender de `role`
5. **Service role key é crítica** — se vazar, alguém pode ler/escrever qualquer dado

### Performance

1. **Índices** — querys de lookup usam índices (email, org_id, created_at)
2. **JSONB** — request_payload/response_body podem ser grandes; considerar limpeza periódica
3. **Polling logs** — frontend faz polling a cada 5s; considerar usar WebSocket para operações longas
4. **org_id em WHERE clause** — todas as queries devem filtrar por org_id (exceto super admins)

### Manutenção

1. **Limpeza de sessões expiradas** — feita lazily (quando cliente tenta usar), considerar job background
2. **Backup de api_debug_logs** — pode crescer significativamente; plan archival strategy
3. **Password reset tokens** — expiram em ~1 hora; limpeza lazy é suficiente
4. **Stripe webhook idempotency** — sempre verificar se webhook já foi processado

### Próximas Migrações

- **Pagination de logs** — adicionar cursor-based pagination para grandes volumes
- **Soft deletes** — considerar deletar logicamente (flag `deleted_at`) em vez de hard delete
- **Audit trail completo** — rastrear quem mudou quê (adicionar `updated_by` em tabelas importantes)
- **RLS policies** — quando migrar para anon key, implementar RLS
- **Encryption** — encriptar tokens ML/Stripe em repouso
