# Documentação Completa da API - Copy Anúncios ML

## Sumário
1. [Visão Geral](#visão-geral)
2. [Autenticação e Autorização](#autenticação-e-autorização)
3. [OAuth2 Mercado Livre](#oauth2-mercado-livre)
4. [Fluxo de Billing (Stripe)](#fluxo-de-billing-stripe)
5. [Rate Limiting e Retry](#rate-limiting-e-retry)
6. [Endpoints - Autenticação](#endpoints---autenticação)
7. [Endpoints - Sellers](#endpoints---sellers)
8. [Endpoints - Cópia de Anúncios](#endpoints---cópia-de-anúncios)
9. [Endpoints - Compatibilidade Veicular](#endpoints---compatibilidade-veicular)
10. [Endpoints - Administração de Usuários](#endpoints---administração-de-usuários)
11. [Endpoints - Super Admin](#endpoints---super-admin)
12. [Endpoints - Billing](#endpoints---billing)
13. [Endpoints - Sistema](#endpoints---sistema)
14. [Exemplos de Uso](#exemplos-de-uso)
15. [Códigos de Erro](#códigos-de-erro)

---

## Visão Geral

Copy Anúncios ML é uma plataforma SaaS multi-tenant para copiar anúncios e compatibilidades veiculares entre contas do Mercado Livre. A API é construída com **FastAPI** (Python 3.11), utiliza **Supabase** (PostgreSQL) para persistência de dados e implementa autenticação baseada em **tokens de sessão** com controle de acesso por papéis (**RBAC**).

### Informações Técnicas

- **Base URL**: `https://copy.levermoney.com.br` (produção) / `http://localhost:8000` (desenvolvimento)
- **Versão da API**: 1.0.0
- **Autenticação**: Token de sessão via header `X-Auth-Token`
- **Tecnologia Backend**: FastAPI com Uvicorn
- **Banco de Dados**: Supabase (PostgreSQL)
- **Integração Externa**: OAuth2 com Mercado Livre
- **Billing**: Stripe (webhooks, checkout, customer portal)

### Convenções

- **Todos os timestamps** estão em ISO 8601 com timezone UTC
- **Respostas de sucesso** retornam status `200-201`
- **Requisições são síncronas** com possíveis operações background
- **Emails e usernames** são case-insensitive internamente
- **IDs de itens do ML** seguem padrão `MLB` + números (ex: `MLB1234567890`)

---

## Autenticação e Autorização

### Fluxo de Autenticação

A autenticação utiliza **tokens de sessão** gerados após login bem-sucedido:

1. **Login**: POST `/api/auth/login` com email/username + senha
2. **Verificação**: bcrypt verifica password_hash
3. **Sessão**: Token gerado (32 bytes URL-safe) com TTL de **7 dias**
4. **Envio**: Cliente armazena token em `localStorage` ou cookie
5. **Requisições**: Token enviado via header `X-Auth-Token` em cada request protegido
6. **Validação**: Dependência `require_user()` valida token na rota protegida

### Papéis de Usuário (RBAC)

| Papel | Descrição | Permissões |
|-------|-----------|-----------|
| `admin` | Administrador da organização | Acesso total dentro da org, gerencia usuários, permissões e billing. Sem restrições de sellers. |
| `operator` | Operador da organização | Acesso filtrado por permissões granulares por seller (`can_copy_from`, `can_copy_to`, `can_run_compat`). |
| `super_admin` | Super administrador da plataforma | Gerencia organizações globalmente, vê todos os logs, acesso irrestrito. Bypass de verificações de org. |

### Permissões por Seller

Operadores recebem permissões granulares para cada seller conectado:

- **can_copy_from**: Pode usar este seller como **origem** em cópias de anúncios
- **can_copy_to**: Pode usar este seller como **destino** em cópias de anúncios
- **can_run_compat**: Flag global do usuário que permite executar cópias de compatibilidade

**Nota**: Admins bypass todas as verificações de seller e podem usar qualquer seller.

### Dependências de Autenticação

A API usa as seguintes dependências em rotas protegidas:

- **`require_user(x_auth_token)`**: Valida token, retorna dados básicos do usuário + permissões
  - Retorna 401 se token inválido ou expirado
  - Retorna 401 se usuário está inativo

- **`require_admin(x_auth_token)`**: Estende `require_user`, verifica `role == "admin"`
  - Retorna 403 se usuário não é admin

- **`require_super_admin(x_auth_token)`**: Estende `require_user`, verifica `is_super_admin == true`
  - Retorna 403 se usuário não é super_admin
  - Bypass verificações de org ativa

- **`require_active_org(x_auth_token)`**: Estende `require_user`, verifica se org está ativa
  - Retorna 403 se org está desativada
  - Retorna 402 se org em trial e copias gratuitas esgotadas
  - Super_admins bypass esta verificação

### Headers Obrigatórios

Todas as rotas protegidas exigem:

```
X-Auth-Token: <token_de_sessao_32_bytes>
```

### Cookies de Sessão

Opcionalmente, o cliente pode armazenar o token em um cookie seguro:

```
Set-Cookie: auth_token=<token>; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800
```

---

## OAuth2 Mercado Livre

### Fluxo de Autenticação ML

O fluxo OAuth2 conecta contas do Mercado Livre (vendedores) à plataforma:

#### 1. Iniciar Autorização

**Endpoint**: GET `/api/ml/install`
- Usuário autenticado solicita instalação da conta ML
- Retorna URL de redirecionamento para o Mercado Livre
- A URL contém `state=org_<ORG_ID>` para rastreabilidade

#### 2. Autorizar no ML

- Usuário é redirecionado para `https://auth.mercadolivre.com.br/authorization?...`
- Faz login em sua conta do Mercado Livre
- Autoriza a plataforma a acessar seus dados
- ML redireciona para nosso callback com `code` + `state`

#### 3. Callback (Token Exchange)

**Endpoint**: GET `/api/ml/callback?code=<CODE>&state=org_<ORG_ID>`

A plataforma:
- Valida `state` para extrair `org_id`
- Troca `code` por `access_token` + `refresh_token` com ML
- Armazena tokens em tabela `copy_sellers` (scoped por org)
- Se já existe seller, atualiza tokens
- Se é novo, cria novo seller record

**Resposta**: Página HTML de sucesso (redirecionável para frontend)

### Gerenciamento de Tokens ML

**Auto-refresh automático**:
- Tokens ML têm TTL (geralmente 6 horas)
- Antes de cada chamada à API do ML, função `_get_token()` em `ml_api.py` verifica expiração
- Se expirado, usa `refresh_token` para renovar automaticamente
- Tokens são armazenados e atualizados em `copy_sellers`

**Campos em copy_sellers**:
```sql
ml_user_id              -- ID do usuário do ML
ml_access_token         -- Token de acesso atual
ml_refresh_token        -- Token para renovação (pode ser NULL)
ml_token_expires_at     -- Timestamp de expiração ISO 8601
```

---

## Fluxo de Billing (Stripe)

### Modelos de Pagamento

A plataforma oferece dois modelos:

1. **Trial (Gratuito)**:
   - Limite padrão de 20 cópias de anúncios
   - Acesso a compatibilidade veicular
   - Duração: sem limite de tempo (até ativar pagamento)
   - Campo: `orgs.payment_active = false`

2. **Pago (Assinatura Stripe)**:
   - Cópias ilimitadas de anúncios
   - Compatibilidade veicular ilimitada
   - Billing: Stripe (checkout, portal, webhooks)
   - Campo: `orgs.payment_active = true`

### Fluxo de Checkout

1. **Criar Sessão de Checkout**:
   - Admin POST `/api/billing/create-checkout`
   - Cria (ou reutiliza) Stripe customer
   - Cria Stripe checkout session
   - Retorna `checkout_url` para redirecionamento

2. **Pagamento Stripe**:
   - Cliente completa pagamento na plataforma Stripe
   - Stripe notifica webhook de conclusão

3. **Ativação de Pagamento**:
   - Webhook `checkout.session.completed` atualiza `orgs.payment_active = true`
   - Subscrição ativa em `orgs.stripe_subscription_id`

### Gerenciamento de Assinatura

**Customer Portal**:
- Admin POST `/api/billing/create-portal`
- Retorna URL do Stripe Customer Portal
- Permite cancelar, atualizar método de pagamento, ver faturas

### Webhooks Stripe

A plataforma escuta os seguintes eventos:

| Evento | Ação |
|--------|------|
| `checkout.session.completed` | `payment_active = true`, armazena subscription_id |
| `customer.subscription.deleted` | `payment_active = false`, limpa subscription_id |
| `customer.subscription.updated` | `payment_active = true/false` conforme status |

**Validação de Webhook**:
- Header `stripe-signature` é validado com `STRIPE_WEBHOOK_SECRET`
- Retorna 400 se assinatura inválida
- Processa apenas eventos reconhecidos (ignora outros)

### Status de Billing

**Endpoint**: GET `/api/billing/status`

Retorna:
- `payment_active`: boolean (true se assinatura ativa)
- `stripe_subscription_id`: ID da subscrição (se houver)
- `trial_copies_used`: Quantas cópias gratuitas foram usadas
- `trial_copies_limit`: Limite de cópias gratuitas (default 20)
- `trial_active`: boolean (true se em trial e ainda há cópias)
- `trial_exhausted`: boolean (true se em trial e cópias esgotadas)

---

## Rate Limiting e Retry

### Rate Limiting da API

A plataforma **não implementa rate limiting explícito** nas requisições do cliente, mas:

- **Stripe**: Tem seus próprios limites (não diretamente visível)
- **Mercado Livre API**: Respeita limites do ML (429 Too Many Requests)

### Retry Automático (ML API)

Ao chamar APIs do Mercado Livre, a plataforma implementa **exponential backoff**:

- **Max retries**: 4 tentativas
- **Base delay**: 3 segundos
- **Crescimento**: Delay dobra a cada tentativa (3s, 6s, 12s, 24s)
- **Trigger**: HTTP 429 (Too Many Requests)

**Exemplo**:
```
Tentativa 1: Wait 3s, retry
Tentativa 2: Wait 6s, retry
Tentativa 3: Wait 12s, retry
Tentativa 4: Retorna erro
```

### Retry Lógico (Cópia de Anúncios)

Ao copiar anúncios, a plataforma implementa **retry automático com ajuste de payload**:

- **Max retries**: 4 tentativas
- **Gatilhos**: Erros específicos do ML com soluções conhecidas

**Exemplos de ajuste automático**:
1. Se `title` inválido → remove title, usa `family_name`
2. Se `family_name` inválido → inverte, usa `title`
3. Se `official_store_id` necessário → busca de item existente do seller
4. Se dimensões faltando → retorna status `needs_dimensions` para recolher do usuário

### Retry Manual (Cópia com Dimensões)

Se uma cópia falhar por dimensões faltando:
- POST `/api/copy/retry-dimensions` com log_id + dimensões novas
- Refaz cópia com dimensões fornecidas
- Atualiza log original com novo resultado

---

## Endpoints - Autenticação

### POST /api/auth/login

Autentica um usuário com email/username e senha. Retorna token de sessão.

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "email": "usuario@example.com",
  "password": "senha_secreta"
}
```

**Response (200 OK)**:
```json
{
  "token": "KnT_5l-ZX5g9mPq_2h-jX0fQ",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "usuario",
    "role": "admin",
    "can_run_compat": true
  }
}
```

**Possíveis Erros**:
- `401 Unauthorized`: Credenciais inválidas, usuário não encontrado ou inativo
  ```json
  {"detail": "Email ou senha incorretos"}
  ```
- `400 Bad Request`: Email ou senha ausentes

**Exemplo cURL**:
```bash
curl -X POST https://copy.levermoney.com.br/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "usuario@example.com",
    "password": "senha_secreta"
  }'
```

**Notas**:
- Email é case-insensitive internamente
- Senha mínima de 6 caracteres
- Token válido por 7 dias
- Registra tentativa de login em `auth_logs`

---

### POST /api/auth/signup

Cria nova organização e usuário admin (self-service). Usuário fica automaticamente como admin e pode_run_compat.

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "email": "empresa@example.com",
  "password": "senha_secreta",
  "company_name": "Minha Empresa LTDA"
}
```

**Response (200 OK)**:
```json
{
  "token": "KnT_5l-ZX5g9mPq_2h-jX0fQ",
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "empresa@example.com",
    "email": "empresa@example.com",
    "role": "admin",
    "can_run_compat": true
  },
  "org": {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Minha Empresa LTDA"
  }
}
```

**Possíveis Erros**:
- `409 Conflict`: Email já cadastrado
  ```json
  {"detail": "Email ja cadastrado"}
  ```
- `400 Bad Request`: Validação falhou
  ```json
  {"detail": "Senha deve ter pelo menos 6 caracteres"}
  ```

**Exemplo cURL**:
```bash
curl -X POST https://copy.levermoney.com.br/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "empresa@example.com",
    "password": "senha_secreta",
    "company_name": "Minha Empresa LTDA"
  }'
```

**Notas**:
- Cria `orgs` com `active=true`, `payment_active=false`
- Usuário criado como `role=admin` automaticamente
- Registra signup em `auth_logs`

---

### POST /api/auth/logout

Invalida o token de sessão do usuário atual.

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Request Body**: (vazio)

**Response (200 OK)**:
```json
{
  "status": "ok"
}
```

**Exemplo cURL**:
```bash
curl -X POST https://copy.levermoney.com.br/api/auth/logout \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Notas**:
- Se header `X-Auth-Token` não fornecido, ainda retorna 200 OK
- Registra logout em `auth_logs`
- Deleta session token da tabela `user_sessions`

---

### GET /api/auth/me

Retorna dados do usuário autenticado, incluindo permissões e contexto de organização.

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Response (200 OK)**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "username": "usuario",
  "email": "usuario@example.com",
  "role": "admin",
  "org_id": "550e8400-e29b-41d4-a716-446655440001",
  "is_super_admin": false,
  "can_run_compat": true,
  "org_name": "Minha Empresa LTDA",
  "permissions": [
    {
      "seller_slug": "seller-um",
      "can_copy_from": true,
      "can_copy_to": true
    },
    {
      "seller_slug": "seller-dois",
      "can_copy_from": true,
      "can_copy_to": false
    }
  ]
}
```

**Possíveis Erros**:
- `401 Unauthorized`: Token inválido ou expirado

**Exemplo cURL**:
```bash
curl -X GET https://copy.levermoney.com.br/api/auth/me \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Notas**:
- Retorna array `permissions` com permissões por seller
- Para admins, `permissions` pode estar vazio (admins têm acesso total)
- Inclui `org_name` resolvido do ID da org

---

### POST /api/auth/forgot-password

Gera token de reset de senha e envia email. **Sempre retorna 200** para evitar enumerate de emails.

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "email": "usuario@example.com"
}
```

**Response (200 OK)**:
```json
{
  "message": "Se o email existir, enviaremos instrucoes"
}
```

**Comportamento**:
- Se email **não existe**: Retorna 200, nada acontece (no email sent)
- Se email **existe**: Retorna 200, email de reset enviado, token criado com TTL 1 hora

**Exemplo cURL**:
```bash
curl -X POST https://copy.levermoney.com.br/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "usuario@example.com"}'
```

**Notas**:
- Implementa rate limiting implícito (throttling em SMTP)
- Tokens armazenados em `password_reset_tokens` com expiração 1 hora
- Email contém link com token para POST `/api/auth/reset-password`

---

### POST /api/auth/reset-password

Reseta senha usando token válido. Invalida todas as sessões do usuário.

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "token": "reset_token_recebido_por_email",
  "new_password": "nova_senha_secreta"
}
```

**Response (200 OK)**:
```json
{
  "message": "Senha alterada com sucesso"
}
```

**Possíveis Erros**:
- `400 Bad Request`: Token expirado/inválido
  ```json
  {"detail": "Link expirado ou invalido"}
  ```
- `400 Bad Request`: Senha < 6 caracteres
  ```json
  {"detail": "Senha deve ter pelo menos 6 caracteres"}
  ```

**Exemplo cURL**:
```bash
curl -X POST https://copy.levermoney.com.br/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{
    "token": "reset_token_recebido_por_email",
    "new_password": "nova_senha_secreta"
  }'
```

**Notas**:
- **Invalida TODAS as sessões** do usuário (force logout)
- **Deleta TODOS os tokens de reset** do usuário
- Registra ação em `auth_logs`

---

### POST /api/auth/admin-promote

Cria ou promove um usuário a admin usando a master password. **Endpoint único de setup inicial**.

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{
  "username": "novo_admin",
  "password": "senha_admin",
  "master_password": "SENHA_MASTER_DO_ADMIN_CONFIGURADA"
}
```

**Response (200 OK)**:
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "novo_admin",
    "role": "admin",
    "can_run_compat": true,
    "active": true,
    "created_at": "2026-01-15T10:30:00Z",
    "last_login_at": null
  }
}
```

**Possíveis Erros**:
- `403 Forbidden`: Master password inválida
  ```json
  {"detail": "Senha master inválida"}
  ```
- `403 Forbidden`: Master password não configurada
  ```json
  {"detail": "Master password not configured"}
  ```

**Exemplo cURL**:
```bash
curl -X POST https://copy.levermoney.com.br/api/auth/admin-promote \
  -H "Content-Type: application/json" \
  -d '{
    "username": "novo_admin",
    "password": "senha_admin",
    "master_password": "SENHA_MASTER_DO_ADMIN"
  }'
```

**Notas**:
- Se usuário **já existe**: Promove a admin, opcionalmente atualiza senha
- Se usuário **não existe**: Cria novo usuário como admin
- Registra ação em `auth_logs` como `admin_promote`
- Master password vem de env var `ADMIN_MASTER_PASSWORD`

---

## Endpoints - Sellers

### GET /api/ml/install

Retorna URL de redirecionamento para autorizar conta do Mercado Livre.

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Query Parameters**: (nenhum)

**Response (200 OK)**:
```json
{
  "redirect_url": "https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=...&state=org_550e8400-e29b-41d4-a716-446655440001"
}
```

**Autenticação**: `require_active_org`

**Exemplo cURL**:
```bash
curl -X GET "https://copy.levermoney.com.br/api/ml/install" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Notas**:
- Retorna URL OAuth2 com `state` contendo `org_id`
- Cliente redireciona usuário para essa URL
- Usuário autoriza, ML redireciona para `/api/ml/callback`

---

### GET /api/ml/callback

Callback do OAuth2 do Mercado Livre. Troca código por tokens e salva em `copy_sellers`.

**Query Parameters**:
- `code` (obrigatório): Código de autorização do ML
- `state` (obrigatório): Estado contendo `org_<ORG_ID>`

**Response (200 OK)**: Página HTML de sucesso

**Possíveis Erros**:
- `400 Bad Request`: State ou code ausente
  ```json
  {"detail": "Missing state"}
  ```
- `502 Bad Gateway`: Falha ao trocar código por tokens com ML
  ```json
  {"detail": "ML OAuth failed: ..."}
  ```

**Exemplo Completo**:
```bash
# 1. GET install para obter redirect_url
curl -X GET "https://copy.levermoney.com.br/api/ml/install" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"

# Retorna: https://auth.mercadolivre.com.br/authorization?...&state=org_123abc...

# 2. Cliente redireciona usuário para essa URL
# 3. Usuário autoriza no ML
# 4. ML redireciona para /api/ml/callback?code=AUTH_CODE&state=org_123abc

# Callback é automático (handled by browser)
```

**Notas**:
- **Não requer autenticação** (callback não tem token)
- Valida `state` para extrair `org_id`
- Se seller já existe (por ml_user_id ou slug), **atualiza tokens**
- Se é novo seller, **cria novo record** em `copy_sellers`
- Retorna página HTML com link para voltar ao dashboard

---

### GET /api/sellers

Lista todos os sellers conectados para a organização do usuário.

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Response (200 OK)**:
```json
[
  {
    "slug": "seller-um",
    "name": "Loja do João",
    "ml_user_id": "123456789",
    "token_valid": true,
    "token_expires_at": "2026-01-20T14:30:00Z",
    "created_at": "2026-01-15T10:30:00Z"
  },
  {
    "slug": "seller-dois",
    "name": "Loja da Maria",
    "ml_user_id": "987654321",
    "token_valid": false,
    "token_expires_at": "2026-01-19T10:00:00Z",
    "created_at": "2026-01-14T15:20:00Z"
  }
]
```

**Autenticação**: `require_active_org`

**Exemplo cURL**:
```bash
curl -X GET "https://copy.levermoney.com.br/api/sellers" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Notas**:
- Retorna apenas sellers `active=true`
- `token_valid` indica se token não expirou
- Ordenado por `created_at` ascendente (mais antigos primeiro)

---

### PUT /api/sellers/{slug}/name

Renomeia um seller conectado.

**Headers**:
```
X-Auth-Token: <token_de_sessao>
Content-Type: application/json
```

**Path Parameters**:
- `slug`: Slug do seller (ex: `seller-um`)

**Request Body**:
```json
{
  "name": "Novo Nome da Loja"
}
```

**Response (200 OK)**:
```json
{
  "status": "ok",
  "slug": "seller-um",
  "name": "Novo Nome da Loja"
}
```

**Possíveis Erros**:
- `404 Not Found`: Seller não encontrado
  ```json
  {"detail": "Seller 'seller-um' não encontrado"}
  ```
- `400 Bad Request`: Nome vazio ou muito longo
  ```json
  {"detail": "Nome não pode ser vazio"}
  ```

**Autenticação**: `require_active_org`

**Exemplo cURL**:
```bash
curl -X PUT "https://copy.levermoney.com.br/api/sellers/seller-um/name" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ" \
  -H "Content-Type: application/json" \
  -d '{"name": "Novo Nome da Loja"}'
```

**Notas**:
- Apenas atualiza campo `name` em `copy_sellers`
- Slug permanece inalterado
- Nome máximo 100 caracteres

---

### DELETE /api/sellers/{slug}

Desconecta um seller (invalida tokens, marca como inativo).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Path Parameters**:
- `slug`: Slug do seller (ex: `seller-um`)

**Response (200 OK)**:
```json
{
  "status": "ok",
  "seller": "seller-um"
}
```

**Possíveis Erros**:
- `404 Not Found`: Seller não encontrado
  ```json
  {"detail": "Seller 'seller-um' not found"}
  ```

**Autenticação**: `require_active_org`

**Exemplo cURL**:
```bash
curl -X DELETE "https://copy.levermoney.com.br/api/sellers/seller-um" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Notas**:
- Define `active=false` em vez de deletar
- Limpa tokens: `ml_access_token`, `ml_refresh_token`, `ml_token_expires_at`
- Mantém histórico em banco (soft delete)
- Seller não aparece mais em GET `/api/sellers`

---

## Endpoints - Cópia de Anúncios

### POST /api/copy

Copia anúncios de um seller (origem) para um ou mais sellers (destinos).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
Content-Type: application/json
```

**Request Body**:
```json
{
  "source": "seller-um",
  "destinations": ["seller-dois", "seller-tres"],
  "item_ids": ["MLB1234567890", "MLB9876543210"]
}
```

**Response (200 OK)**:
```json
{
  "total": 4,
  "success": 2,
  "errors": 1,
  "needs_dimensions": 1,
  "results": [
    {
      "source_item_id": "MLB1234567890",
      "dest_seller": "seller-dois",
      "status": "success",
      "dest_item_id": "MLB1111111111"
    },
    {
      "source_item_id": "MLB1234567890",
      "dest_seller": "seller-tres",
      "status": "needs_dimensions",
      "error": "Dimensões são obrigatórias para esta categoria"
    },
    {
      "source_item_id": "MLB9876543210",
      "dest_seller": "seller-dois",
      "status": "error",
      "error": "Falha ao criar anúncio: título inválido"
    },
    {
      "source_item_id": "MLB9876543210",
      "dest_seller": "seller-tres",
      "status": "success",
      "dest_item_id": "MLB2222222222"
    }
  ]
}
```

**Possíveis Erros**:
- `400 Bad Request`: Validação de entrada falhou
  ```json
  {"detail": "source is required"}
  ```
- `403 Forbidden`: Usuário não tem permissão para seller
  ```json
  {"detail": "Sem permissão de origem para o seller 'seller-um'"}
  ```
- `402 Payment Required`: Trial esgotado e org não tem pagamento ativo
  ```json
  {"detail": "Periodo de teste encerrado. Voce usou todas as 20 copias gratuitas. Assine para continuar."}
  ```

**Autenticação**: `require_active_org`

**Exemplo cURL**:
```bash
curl -X POST "https://copy.levermoney.com.br/api/copy" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "seller-um",
    "destinations": ["seller-dois", "seller-tres"],
    "item_ids": ["MLB1234567890", "MLB9876543210"]
  }'
```

**Validações**:
- `source` e `destinations` não podem ser vazio
- `source` não pode estar em `destinations`
- Pelo menos um `item_id` obrigatório
- Usuário deve ter `can_copy_from` para source e `can_copy_to` para cada destination
- Admins bypass verificações de permissão

**Processamento de item_ids**:
- Suporta formato: `MLB1234567890` ou `1234567890` (auto-adiciona `MLB`)
- Suporta separadores: vírgula ou quebra de linha
- Deduplica automaticamente

**Status de Cópia**:
| Status | Significado |
|--------|-------------|
| `success` | Anúncio copiado com sucesso. `dest_item_id` fornecido |
| `error` | Falha ao copiar. `error` contém mensagem. Requer investigação |
| `needs_dimensions` | Dimensões obrigatórias faltando. Use `/api/copy/with-dimensions` para fornecer |

**Incremento de Trial**:
- Apenas cópias com `status=success` incrementam contador `trial_copies_used`
- Erros e necessidade de dimensões **não incrementam**

**Logging**:
- Cada cópia gera entrada em `copy_logs` com detalhes

---

### POST /api/copy/with-dimensions

Copia anúncio fornecendo dimensões (altura, largura, comprimento, peso).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
Content-Type: application/json
```

**Request Body**:
```json
{
  "source": "seller-um",
  "destinations": ["seller-dois", "seller-tres"],
  "item_id": "MLB1234567890",
  "dimensions": {
    "height": 10.5,
    "width": 20.0,
    "length": 30.0,
    "weight": 2.5
  }
}
```

**Response (200 OK)**:
```json
{
  "total": 2,
  "success": 2,
  "errors": 0,
  "results": [
    {
      "source_item_id": "MLB1234567890",
      "dest_seller": "seller-dois",
      "status": "success",
      "dest_item_id": "MLB1111111111"
    },
    {
      "source_item_id": "MLB1234567890",
      "dest_seller": "seller-tres",
      "status": "success",
      "dest_item_id": "MLB2222222222"
    }
  ]
}
```

**Possíveis Erros**:
- `400 Bad Request`: Nenhuma dimensão fornecida
  ```json
  {"detail": "At least one dimension is required"}
  ```
- Erros mesmos de POST `/api/copy`

**Autenticação**: `require_active_org`

**Exemplo cURL**:
```bash
curl -X POST "https://copy.levermoney.com.br/api/copy/with-dimensions" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "seller-um",
    "destinations": ["seller-dois", "seller-tres"],
    "item_id": "MLB1234567890",
    "dimensions": {
      "height": 10.5,
      "width": 20.0,
      "length": 30.0,
      "weight": 2.5
    }
  }'
```

**Campos de Dimensão** (todos opcionais):
- `height`: altura em cm (número)
- `width`: largura em cm (número)
- `length`: comprimento em cm (número)
- `weight`: peso em kg (número)

**Processamento**:
1. Busca anúncio original do source
2. Aplica dimensões ao payload
3. Copia para cada destination
4. Atualiza logs originais (se tiverem status `needs_dimensions`)

---

### POST /api/copy/retry-dimensions

Refaz cópia de anúncio que falhou por falta de dimensões, fornecendo dimensões novas.

**Headers**:
```
X-Auth-Token: <token_de_sessao>
Content-Type: application/json
```

**Request Body**:
```json
{
  "log_id": 123,
  "dimensions": {
    "height": 15.0,
    "width": 25.0,
    "length": 35.0,
    "weight": 3.0
  }
}
```

**Response (200 OK)**:
```json
{
  "log_id": 123,
  "total": 2,
  "success": 2,
  "errors": 0,
  "results": [
    {
      "source_item_id": "MLB1234567890",
      "dest_seller": "seller-dois",
      "status": "success",
      "dest_item_id": "MLB1111111111"
    }
  ]
}
```

**Possíveis Erros**:
- `404 Not Found`: Log não encontrado
  ```json
  {"detail": "Log nao encontrado"}
  ```
- `400 Bad Request`: Log não é um erro de dimensões
  ```json
  {"detail": "Este log nao e um erro de dimensoes"}
  ```

**Autenticação**: `require_active_org`

**Exemplo cURL**:
```bash
curl -X POST "https://copy.levermoney.com.br/api/copy/retry-dimensions" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ" \
  -H "Content-Type: application/json" \
  -d '{
    "log_id": 123,
    "dimensions": {
      "height": 15.0,
      "width": 25.0,
      "length": 35.0,
      "weight": 3.0
    }
  }'
```

**Notas**:
- Log original é atualizado com novo status
- Super_admin pode retentar logs de qualquer org
- Operators podem retentar apenas logs próprios
- Admins podem retentar logs de qualquer usuário na org

---

### GET /api/copy/logs

Retorna histórico de cópias de anúncios.

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Query Parameters**:
- `limit` (padrão: 50, máx: 200): Quantidade de registros
- `offset` (padrão: 0): Deslocamento para paginação
- `status` (opcional): Filtrar por status (`success`, `error`, `partial`, `needs_dimensions`, `in_progress`)

**Response (200 OK)**:
```json
[
  {
    "id": 1,
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "usuario",
    "org_id": "550e8400-e29b-41d4-a716-446655440001",
    "source_item_id": "MLB1234567890",
    "source_seller": "seller-um",
    "dest_sellers": ["seller-dois", "seller-tres"],
    "dest_item_ids": {
      "seller-dois": "MLB1111111111",
      "seller-tres": "MLB2222222222"
    },
    "status": "success",
    "error_details": null,
    "created_at": "2026-01-15T10:30:00Z"
  },
  {
    "id": 2,
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "usuario",
    "org_id": "550e8400-e29b-41d4-a716-446655440001",
    "source_item_id": "MLB9876543210",
    "source_seller": "seller-um",
    "dest_sellers": ["seller-dois"],
    "dest_item_ids": null,
    "status": "needs_dimensions",
    "error_details": {
      "seller-dois": "Dimensões são obrigatórias para esta categoria"
    },
    "created_at": "2026-01-15T11:00:00Z"
  }
]
```

**Autenticação**: `require_active_org`

**Visibilidade**:
- **Super_admin**: Vê todos os logs
- **Admin**: Vê logs da org
- **Operator**: Vê apenas logs próprios

**Exemplo cURL**:
```bash
curl -X GET "https://copy.levermoney.com.br/api/copy/logs?limit=10&offset=0&status=success" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

---

### GET /api/copy/preview/{item_id}

Visualiza detalhes de um anúncio antes de copiar.

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Path Parameters**:
- `item_id`: ID do anúncio (ex: `MLB1234567890`)

**Query Parameters**:
- `seller` (obrigatório): Slug do seller que possui o anúncio

**Response (200 OK)**:
```json
{
  "id": "MLB1234567890",
  "title": "Produto Exemplo",
  "price": 99.90,
  "currency_id": "BRL",
  "available_quantity": 5,
  "sold_quantity": 123,
  "category_id": "MLB5672",
  "listing_type_id": "gold_special",
  "condition": "new",
  "status": "active",
  "thumbnail": "https://...",
  "permalink": "https://mercadolivre.com.br/...",
  "pictures_count": 3,
  "variations_count": 2,
  "attributes_count": 15,
  "has_compatibilities": true,
  "description_length": 1024,
  "channels": ["mshops"],
  "seller": "seller-um"
}
```

**Possíveis Erros**:
- `404 Not Found`: Anúncio não encontrado
  ```json
  {"detail": "Item not found: ..."}
  ```

**Autenticação**: `require_active_org`

**Exemplo cURL**:
```bash
curl -X GET "https://copy.levermoney.com.br/api/copy/preview/MLB1234567890?seller=seller-um" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Behavior**:
- Se seller falha em buscar anúncio (403), tenta automaticamente outros sellers
- Busca descrição e compatibilidades (indicador `has_compatibilities`)
- Retorna informações úteis para validação antes de cópia

---

### POST /api/copy/resolve-sellers

Identifica qual seller é proprietário de cada anúncio (bulk).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
Content-Type: application/json
```

**Request Body**:
```json
{
  "item_ids": ["MLB1234567890", "MLB9876543210", "1111111111"]
}
```

**Response (200 OK)**:
```json
{
  "results": [
    {
      "item_id": "MLB1234567890",
      "seller_slug": "seller-um"
    },
    {
      "item_id": "MLB9876543210",
      "seller_slug": "seller-dois"
    }
  ],
  "errors": [
    {
      "item_id": "MLB1111111111",
      "error": "Item nao encontrado em nenhum seller conectado"
    }
  ]
}
```

**Autenticação**: `require_active_org`

**Exemplo cURL**:
```bash
curl -X POST "https://copy.levermoney.com.br/api/copy/resolve-sellers" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ" \
  -H "Content-Type: application/json" \
  -d '{
    "item_ids": ["MLB1234567890", "MLB9876543210"]
  }'
```

**Notas**:
- Busca em paralelo em todos os sellers conectados
- Retorna primeiro seller que conseguir fetchar o item
- Operadores: apenas items de sellers com permissão `can_copy_from` são retornados
- Admins: retornam todos os items encontrados

---

## Endpoints - Compatibilidade Veicular

### GET /api/compat/preview/{item_id}

Visualiza informações de compatibilidade veicular de um anúncio.

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Path Parameters**:
- `item_id`: ID do anúncio (ex: `MLB1234567890`)

**Query Parameters**:
- `seller` (opcional): Slug do seller. Se omitido, usa primeiro seller conectado

**Response (200 OK)**:
```json
{
  "id": "MLB1234567890",
  "title": "Peça de Carro Compatível",
  "thumbnail": "https://...",
  "has_compatibilities": true,
  "compat_count": 47,
  "skus": ["SKU001", "SKU002", "SKU003"],
  "seller": "seller-um"
}
```

**Possíveis Erros**:
- `403 Forbidden`: Usuário não tem permissão para rodar compatibilidade
  ```json
  {"detail": "Sem permissão para rodar compatibilidade"}
  ```
- `404 Not Found`: Anúncio não encontrado
  ```json
  {"detail": "Item not found: ..."}
  ```

**Autenticação**: `require_active_org`

**Exemplo cURL**:
```bash
curl -X GET "https://copy.levermoney.com.br/api/compat/preview/MLB1234567890?seller=seller-um" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Notas**:
- Requer `can_run_compat=true` (admins bypass)
- Extrai SKUs de múltiplas fontes: `seller_custom_field`, atributo `SELLER_SKU`, variações

---

### POST /api/compat/search-sku

Busca anúncios por SKU em todos os sellers conectados.

**Headers**:
```
X-Auth-Token: <token_de_sessao>
Content-Type: application/json
```

**Request Body**:
```json
{
  "skus": ["SKU001", "SKU002", "SKU003"]
}
```

**Response (200 OK)**:
```json
{
  "sku001": [
    {
      "item_id": "MLB1111111111",
      "seller_slug": "seller-um",
      "title": "Peça 001 - Seller Um",
      "price": 49.90
    },
    {
      "item_id": "MLB2222222222",
      "seller_slug": "seller-dois",
      "title": "Peça 001 - Seller Dois",
      "price": 59.90
    }
  ],
  "sku002": [
    {
      "item_id": "MLB3333333333",
      "seller_slug": "seller-um",
      "title": "Peça 002",
      "price": 99.90
    }
  ],
  "sku003": []
}
```

**Possíveis Erros**:
- `400 Bad Request`: Nenhuma SKU fornecida
  ```json
  {"detail": "At least one SKU is required"}
  ```
- `422 Unprocessable Entity`: Mais de 50 SKUs
  ```json
  {"detail": "Maximo de 50 SKUs por busca"}
  ```

**Autenticação**: `require_active_org`

**Exemplo cURL**:
```bash
curl -X POST "https://copy.levermoney.com.br/api/compat/search-sku" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ" \
  -H "Content-Type: application/json" \
  -d '{
    "skus": ["SKU001", "SKU002"]
  }'
```

**Notas**:
- Busca em paralelo
- Operadores: filtrados por permissão `can_copy_to`
- Admins: retornam de todos os sellers
- SKUs case-insensitive

---

### POST /api/compat/copy

Copia compatibilidades veiculares para anúncios alvo (operação background).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
Content-Type: application/json
```

**Request Body**:
```json
{
  "source_item_id": "MLB1234567890",
  "targets": [
    {
      "seller_slug": "seller-dois",
      "item_id": "MLB2222222222"
    },
    {
      "seller_slug": "seller-tres",
      "item_id": "MLB3333333333"
    }
  ],
  "skus": ["SKU001", "SKU002"]
}
```

**Response (200 OK)**:
```json
{
  "status": "queued",
  "total_targets": 2,
  "log_id": 456
}
```

**Possíveis Erros**:
- `403 Forbidden`: Usuário não tem permissão para rodar compatibilidade
  ```json
  {"detail": "Sem permissão para rodar compatibilidade"}
  ```
- `400 Bad Request`: Nenhum target fornecido
  ```json
  {"detail": "At least one target is required"}
  ```

**Autenticação**: `require_active_org`

**Exemplo cURL**:
```bash
curl -X POST "https://copy.levermoney.com.br/api/compat/copy" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ" \
  -H "Content-Type: application/json" \
  -d '{
    "source_item_id": "MLB1234567890",
    "targets": [
      {"seller_slug": "seller-dois", "item_id": "MLB2222222222"}
    ],
    "skus": ["SKU001"]
  }'
```

**Processamento**:
1. Retorna imediatamente com `log_id`
2. Cria entrada em `compat_logs` com status `in_progress`
3. Inicia task background para processar compatibilidades
4. Cliente polling em GET `/api/compat/logs?log_id=456` para status

**Notas**:
- Operação **não é síncrona** (retorna imediatamente)
- Cliente deve fazer polling em logs para ver progresso
- SKUs são opcionais (se omitidos, usa SKUs do item fonte)

---

### GET /api/compat/logs

Retorna histórico de cópias de compatibilidades.

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Query Parameters**:
- `limit` (padrão: 50, máx: 200): Quantidade de registros
- `offset` (padrão: 0): Deslocamento
- `status` (opcional): Filtrar por status (`in_progress`, `success`, `partial`, `error`)

**Response (200 OK)**:
```json
[
  {
    "id": 456,
    "user_id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "usuario",
    "org_id": "550e8400-e29b-41d4-a716-446655440001",
    "source_item_id": "MLB1234567890",
    "skus": ["SKU001", "SKU002"],
    "targets": [
      {
        "seller_slug": "seller-dois",
        "item_id": "MLB2222222222",
        "status": "success",
        "error": null
      },
      {
        "seller_slug": "seller-tres",
        "item_id": "MLB3333333333",
        "status": "error",
        "error": "Falha ao atualizar compatibilidades"
      }
    ],
    "total_targets": 2,
    "success_count": 1,
    "error_count": 1,
    "status": "partial",
    "created_at": "2026-01-15T10:30:00Z"
  }
]
```

**Autenticação**: `require_active_org`

**Visibilidade**:
- **Super_admin**: Vê todos os logs
- **Admin**: Vê logs da org
- **Operator**: Vê apenas logs próprios

**Exemplo cURL**:
```bash
curl -X GET "https://copy.levermoney.com.br/api/compat/logs?limit=10&status=success" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

---

## Endpoints - Administração de Usuários

### GET /api/admin/users

Lista todos os usuários da organização (admin only).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Response (200 OK)**:
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "username": "admin_user",
    "email": "admin@example.com",
    "role": "admin",
    "org_id": "550e8400-e29b-41d4-a716-446655440001",
    "can_run_compat": true,
    "active": true,
    "created_at": "2026-01-15T10:30:00Z",
    "last_login_at": "2026-01-20T14:30:00Z"
  },
  {
    "id": "550e8400-e29b-41d4-a716-446655440002",
    "username": "operator_user",
    "email": "operator@example.com",
    "role": "operator",
    "org_id": "550e8400-e29b-41d4-a716-446655440001",
    "can_run_compat": false,
    "active": true,
    "created_at": "2026-01-16T10:30:00Z",
    "last_login_at": null
  }
]
```

**Autenticação**: `require_admin`

**Exemplo cURL**:
```bash
curl -X GET "https://copy.levermoney.com.br/api/admin/users" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Notas**:
- Nunca retorna `password_hash`
- Apenas admins podem listar

---

### POST /api/admin/users

Cria novo usuário (admin only).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
Content-Type: application/json
```

**Request Body**:
```json
{
  "username": "novo_operador",
  "password": "senha_secreta",
  "role": "operator",
  "can_run_compat": false
}
```

**Response (200 OK)**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "username": "novo_operador",
  "role": "operator",
  "can_run_compat": false,
  "active": true,
  "created_at": "2026-01-16T10:30:00Z",
  "last_login_at": null
}
```

**Possíveis Erros**:
- `409 Conflict`: Username já existe na org
  ```json
  {"detail": "Usuário já existe"}
  ```

**Autenticação**: `require_admin`

**Exemplo cURL**:
```bash
curl -X POST "https://copy.levermoney.com.br/api/admin/users" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "novo_operador",
    "password": "senha_secreta",
    "role": "operator",
    "can_run_compat": false
  }'
```

**Campos**:
- `username` (obrigatório): Nome de usuário único na org
- `password` (obrigatório): Mínimo 6 caracteres (será hash com bcrypt)
- `role` (padrão: "operator"): "admin" ou "operator"
- `can_run_compat` (padrão: false): Permite rodar compatibilidades

---

### PUT /api/admin/users/{user_id}

Atualiza usuário existente (admin only).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
Content-Type: application/json
```

**Path Parameters**:
- `user_id`: UUID do usuário

**Request Body**:
```json
{
  "password": "nova_senha",
  "role": "admin",
  "can_run_compat": true,
  "active": true
}
```

**Response (200 OK)**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "username": "novo_operador",
  "role": "admin",
  "can_run_compat": true,
  "active": true,
  "created_at": "2026-01-16T10:30:00Z",
  "last_login_at": null
}
```

**Possíveis Erros**:
- `404 Not Found`: Usuário não encontrado
  ```json
  {"detail": "Usuário não encontrado"}
  ```
- `400 Bad Request`: Nenhum campo para atualizar
  ```json
  {"detail": "Nenhum campo para atualizar"}
  ```
- `400 Bad Request`: Tentando remover último admin
  ```json
  {"detail": "Não é possível remover o último administrador da organização"}
  ```

**Autenticação**: `require_admin`

**Exemplo cURL**:
```bash
curl -X PUT "https://copy.levermoney.com.br/api/admin/users/550e8400-e29b-41d4-a716-446655440002" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "admin",
    "can_run_compat": true
  }'
```

**Validações**:
- Todos os campos são opcionais (upsert seletivo)
- Impede remover/desativar último admin da org
- Senha mínimo 6 caracteres

---

### DELETE /api/admin/users/{user_id}

Deleta usuário (admin only).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Path Parameters**:
- `user_id`: UUID do usuário

**Response (200 OK)**:
```json
{
  "status": "ok"
}
```

**Possíveis Erros**:
- `404 Not Found`: Usuário não encontrado
- `400 Bad Request`: Tentando deletar último admin

**Autenticação**: `require_admin`

**Exemplo cURL**:
```bash
curl -X DELETE "https://copy.levermoney.com.br/api/admin/users/550e8400-e29b-41d4-a716-446655440002" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

---

### GET /api/admin/users/{user_id}/permissions

Retorna permissões por seller de um usuário.

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Path Parameters**:
- `user_id`: UUID do usuário

**Response (200 OK)**:
```json
[
  {
    "seller_slug": "seller-um",
    "seller_name": "Loja do João",
    "can_copy_from": true,
    "can_copy_to": true
  },
  {
    "seller_slug": "seller-dois",
    "seller_name": "Loja da Maria",
    "can_copy_from": false,
    "can_copy_to": true
  },
  {
    "seller_slug": "seller-tres",
    "seller_name": "Loja do Pedro",
    "can_copy_from": false,
    "can_copy_to": false
  }
]
```

**Autenticação**: `require_admin`

**Exemplo cURL**:
```bash
curl -X GET "https://copy.levermoney.com.br/api/admin/users/550e8400-e29b-41d4-a716-446655440002/permissions" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Notas**:
- Retorna **todos os sellers conectados** da org
- Se usuário não tem permissão explícita, assume `false` para ambos
- Inclui nome do seller para UI

---

### PUT /api/admin/users/{user_id}/permissions

Atualiza permissões por seller de um usuário (upsert).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
Content-Type: application/json
```

**Path Parameters**:
- `user_id`: UUID do usuário

**Request Body**:
```json
{
  "permissions": [
    {
      "seller_slug": "seller-um",
      "can_copy_from": true,
      "can_copy_to": true
    },
    {
      "seller_slug": "seller-dois",
      "can_copy_from": false,
      "can_copy_to": true
    },
    {
      "seller_slug": "seller-tres",
      "can_copy_from": true,
      "can_copy_to": false
    }
  ]
}
```

**Response (200 OK)**:
```json
{
  "status": "ok"
}
```

**Possível Erro**:
- `404 Not Found`: Usuário não encontrado

**Autenticação**: `require_admin`

**Exemplo cURL**:
```bash
curl -X PUT "https://copy.levermoney.com.br/api/admin/users/550e8400-e29b-41d4-a716-446655440002/permissions" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ" \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": [
      {
        "seller_slug": "seller-um",
        "can_copy_from": true,
        "can_copy_to": true
      },
      {
        "seller_slug": "seller-dois",
        "can_copy_from": false,
        "can_copy_to": true
      }
    ]
  }'
```

**Notas**:
- Usa `upsert` (cria ou atualiza)
- Pode enviar permissões parciais (apenas sellers que quer alterar)
- Não deleta permissões não mencionadas

---

## Endpoints - Super Admin

### GET /api/super/orgs

Lista todas as organizações com estatísticas de uso (super_admin only).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Response (200 OK)**:
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440001",
    "name": "Minha Empresa LTDA",
    "email": "empresa@example.com",
    "active": true,
    "payment_active": true,
    "stripe_customer_id": "cus_123abc",
    "stripe_subscription_id": "sub_456def",
    "trial_copies_used": 0,
    "trial_copies_limit": 20,
    "created_at": "2026-01-15T10:30:00Z",
    "updated_at": "2026-01-20T14:30:00Z",
    "user_count": 3,
    "seller_count": 2,
    "copy_count": 47,
    "compat_count": 12
  },
  {
    "id": "550e8400-e29b-41d4-a716-446655440002",
    "name": "Outra Empresa",
    "email": "outra@example.com",
    "active": true,
    "payment_active": false,
    "stripe_customer_id": null,
    "stripe_subscription_id": null,
    "trial_copies_used": 15,
    "trial_copies_limit": 20,
    "created_at": "2026-01-16T10:30:00Z",
    "updated_at": "2026-01-16T10:30:00Z",
    "user_count": 1,
    "seller_count": 1,
    "copy_count": 8,
    "compat_count": 0
  }
]
```

**Autenticação**: `require_super_admin`

**Exemplo cURL**:
```bash
curl -X GET "https://copy.levermoney.com.br/api/super/orgs" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Estatísticas** (últimos 30 dias):
- `user_count`: Número de usuários ativos
- `seller_count`: Número de sellers conectados ativos
- `copy_count`: Número de cópias de anúncios
- `compat_count`: Número de cópias de compatibilidades

---

### PUT /api/super/orgs/{org_id}

Atualiza status de uma organização (super_admin only).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
Content-Type: application/json
```

**Path Parameters**:
- `org_id`: UUID da organização

**Request Body**:
```json
{
  "active": true,
  "payment_active": false
}
```

**Response (200 OK)**:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "name": "Minha Empresa LTDA",
  "active": true,
  "payment_active": false,
  "updated_at": "2026-01-20T15:00:00Z"
}
```

**Possível Erro**:
- `404 Not Found`: Organização não encontrada
  ```json
  {"detail": "Organizacao nao encontrada"}
  ```
- `400 Bad Request`: Nenhum campo para atualizar
  ```json
  {"detail": "Nenhum campo para atualizar"}
  ```

**Autenticação**: `require_super_admin`

**Exemplo cURL**:
```bash
curl -X PUT "https://copy.levermoney.com.br/api/super/orgs/550e8400-e29b-41d4-a716-446655440001" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ" \
  -H "Content-Type: application/json" \
  -d '{
    "active": false
  }'
```

**Efeitos**:
- Se `active=false`: Org fica indisponível, `require_active_org` rejeita requests
- Se `payment_active=false`: Org volta ao trial (se ainda tiver cópias)

---

## Endpoints - Billing

### POST /api/billing/create-checkout

Cria sessão de checkout Stripe para iniciante assinatura (admin only).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
Content-Type: application/json
```

**Request Body**: (vazio)

**Response (200 OK)**:
```json
{
  "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_abcdef123456"
}
```

**Possíveis Erros**:
- `403 Forbidden`: Usuário não é admin
  ```json
  {"detail": "Acesso restrito a administradores"}
  ```
- `404 Not Found`: Organização não encontrada
- `503 Service Unavailable`: Stripe não configurado
  ```json
  {"detail": "Billing not configured"}
  ```

**Autenticação**: `require_user` + admin check

**Exemplo cURL**:
```bash
curl -X POST "https://copy.levermoney.com.br/api/billing/create-checkout" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Fluxo**:
1. Cria Stripe customer se não existe
2. Cria checkout session com price_id
3. Retorna URL para redirecionamento
4. Cliente redireciona usuário (frontend deve fazer)
5. Webhook `checkout.session.completed` atualiza org

---

### POST /api/billing/create-portal

Cria sessão do Stripe Customer Portal (admin only).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
Content-Type: application/json
```

**Request Body**: (vazio)

**Response (200 OK)**:
```json
{
  "portal_url": "https://billing.stripe.com/p/session/acct_123/test_session_key"
}
```

**Possíveis Erros**:
- `403 Forbidden`: Usuário não é admin
- `404 Not Found`: Organização não encontrada
- `400 Bad Request`: Nenhuma assinatura encontrada
  ```json
  {"detail": "Nenhuma assinatura encontrada"}
  ```
- `503 Service Unavailable`: Stripe não configurado

**Autenticação**: `require_user` + admin check

**Exemplo cURL**:
```bash
curl -X POST "https://copy.levermoney.com.br/api/billing/create-portal" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Funcionalidades do Portal**:
- Ver fatura e histórico de pagamentos
- Atualizar método de pagamento
- Cancelar assinatura
- Baixar NF

---

### POST /api/billing/webhook

Recebe webhooks do Stripe (públic, sem autenticação).

**Headers**:
```
Content-Type: application/json
stripe-signature: <assinatura_stripe>
```

**Request Body**: (payload do webhook Stripe)

**Response (200 OK)**:
```json
{
  "received": true
}
```

**Possíveis Erros**:
- `400 Bad Request`: Assinatura inválida
  ```json
  {"detail": "Invalid signature"}
  ```
- `503 Service Unavailable`: Stripe não configurado

**Autenticação**: Nenhuma (webhook público, validado por signature)

**Eventos Processados**:

| Evento | Ação |
|--------|------|
| `checkout.session.completed` | `payment_active = true`, armazena subscription_id |
| `customer.subscription.deleted` | `payment_active = false`, limpa subscription_id |
| `customer.subscription.updated` | `payment_active = true/false` conforme status |

**Exemplo de Evento**:
```json
{
  "type": "checkout.session.completed",
  "data": {
    "object": {
      "client_reference_id": "550e8400-e29b-41d4-a716-446655440001",
      "subscription": "sub_456def",
      "customer": "cus_123abc"
    }
  }
}
```

**Notas**:
- Valida assinatura com `STRIPE_WEBHOOK_SECRET`
- Retorna 200 OK mesmo se evento não processado (idempotent)
- Integra com tabela `orgs` para ativar/desativar pagamento

---

### GET /api/billing/status

Retorna status de billing da organização do usuário.

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Response (200 OK)**:
```json
{
  "payment_active": true,
  "stripe_subscription_id": "sub_456def",
  "trial_copies_used": 0,
  "trial_copies_limit": 20,
  "trial_active": false,
  "trial_exhausted": false
}
```

**Autenticação**: `require_user`

**Exemplo cURL**:
```bash
curl -X GET "https://copy.levermoney.com.br/api/billing/status" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Campos**:
- `payment_active`: boolean (assinatura ativa?)
- `stripe_subscription_id`: ID da subscrição (se houver)
- `trial_copies_used`: Quantas cópias gratuitas foram usadas
- `trial_copies_limit`: Limite de cópias gratuitas
- `trial_active`: true se em trial e ainda há cópias
- `trial_exhausted`: true se em trial e cópias esgotadas

---

## Endpoints - Sistema

### GET /api/health

Health check simples (públic).

**Response (200 OK)**:
```json
{
  "status": "ok"
}
```

**Exemplo cURL**:
```bash
curl -X GET "https://copy.levermoney.com.br/api/health"
```

**Notas**:
- Sem autenticação
- Disponível em `/health` e `/api/health`

---

### GET /api/debug/env

Retorna status de configuração de variáveis de ambiente (super_admin only, valores mascarados).

**Headers**:
```
X-Auth-Token: <token_de_sessao>
```

**Response (200 OK)**:
```json
{
  "ml_app_id": "...abc123",
  "ml_secret_key": "...xyz789",
  "ml_redirect_uri": "https://copy.levermoney.com.br/api/ml/callback",
  "supabase_url": "https://project.supabase.co",
  "supabase_service_role_key": "SET",
  "supabase_key": "SET",
  "base_url": "https://copy.levermoney.com.br",
  "cors_origins": "https://copy.levermoney.com.br,https://frontend.example.com"
}
```

**Autenticação**: `require_super_admin`

**Exemplo cURL**:
```bash
curl -X GET "https://copy.levermoney.com.br/api/debug/env" \
  -H "X-Auth-Token: KnT_5l-ZX5g9mPq_2h-jX0fQ"
```

**Notas**:
- Retorna apenas sufixo das chaves (últimos 4 caracteres)
- Booleanas como "SET" ou "MISSING"
- Útil para diagnosticar configuração

---

## Exemplos de Uso

### Exemplo Completo: Signup → Conectar Seller → Copiar Anúncio

```bash
# 1. Signup
curl -X POST https://copy.levermoney.com.br/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "empresa@example.com",
    "password": "senha_secreta",
    "company_name": "Minha Empresa"
  }'

# Resposta:
# {
#   "token": "KnT_5l...",
#   "user": {...},
#   "org": {...}
# }

TOKEN="KnT_5l..."

# 2. Instalar conta ML
curl -X GET https://copy.levermoney.com.br/api/ml/install \
  -H "X-Auth-Token: $TOKEN"

# Retorna: {"redirect_url": "https://auth.mercadolivre.com.br/..."}
# Usuário clica, autoriza, volta em callback

# 3. Listar sellers
curl -X GET https://copy.levermoney.com.br/api/sellers \
  -H "X-Auth-Token: $TOKEN"

# Resposta: [{slug: "seller-um", ...}]

# 4. Copiar anúncio
curl -X POST https://copy.levermoney.com.br/api/copy \
  -H "X-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "seller-um",
    "destinations": ["seller-dois"],
    "item_ids": ["MLB1234567890"]
  }'

# Resposta: {total: 1, success: 1, ...}
```

### Exemplo: Criar Operador com Permissões

```bash
TOKEN="..." # Token de admin

# 1. Criar operador
curl -X POST https://copy.levermoney.com.br/api/admin/users \
  -H "X-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "operador1",
    "password": "senha_op",
    "role": "operator",
    "can_run_compat": true
  }'

# Resposta: {id: "550e...", ...}
USER_ID="550e..."

# 2. Obter permissões atuais
curl -X GET https://copy.levermoney.com.br/api/admin/users/$USER_ID/permissions \
  -H "X-Auth-Token: $TOKEN"

# 3. Atualizar permissões
curl -X PUT https://copy.levermoney.com.br/api/admin/users/$USER_ID/permissions \
  -H "X-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": [
      {"seller_slug": "seller-um", "can_copy_from": true, "can_copy_to": true},
      {"seller_slug": "seller-dois", "can_copy_from": true, "can_copy_to": false}
    ]
  }'
```

### Exemplo: Copiar com Dimensões (Retry)

```bash
TOKEN="..." # Token autenticado

# 1. Tentar copiar (pode gerar needs_dimensions)
curl -X POST https://copy.levermoney.com.br/api/copy \
  -H "X-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "seller-um",
    "destinations": ["seller-dois"],
    "item_ids": ["MLB1234567890"]
  }'

# Resposta pode ter: {status: "needs_dimensions", ...}

# 2. Verificar logs
curl -X GET "https://copy.levermoney.com.br/api/copy/logs?status=needs_dimensions" \
  -H "X-Auth-Token: $TOKEN"

# Resposta: [{id: 123, status: "needs_dimensions", ...}]

# 3. Fornecer dimensões e retentar
curl -X POST https://copy.levermoney.com.br/api/copy/retry-dimensions \
  -H "X-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "log_id": 123,
    "dimensions": {
      "height": 10.5,
      "width": 20.0,
      "length": 30.0,
      "weight": 2.5
    }
  }'

# Resposta: {total: 1, success: 1, ...}
```

### Exemplo: Copiar Compatibilidades (Background)

```bash
TOKEN="..." # Token com can_run_compat

# 1. Buscar SKU
curl -X POST https://copy.levermoney.com.br/api/compat/search-sku \
  -H "X-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"skus": ["SKU001"]}'

# Resposta: {sku001: [{item_id: "MLB...", seller_slug: "seller-um", ...}]}

# 2. Iniciar cópia de compatibilidade (retorna imediatamente)
curl -X POST https://copy.levermoney.com.br/api/compat/copy \
  -H "X-Auth-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source_item_id": "MLB1234567890",
    "targets": [
      {"seller_slug": "seller-dois", "item_id": "MLB2222222222"}
    ],
    "skus": ["SKU001"]
  }'

# Resposta: {status: "queued", log_id: 456}

# 3. Polling de status
for i in {1..10}; do
  curl -X GET "https://copy.levermoney.com.br/api/compat/logs?limit=1" \
    -H "X-Auth-Token: $TOKEN"
  sleep 2
done
```

---

## Códigos de Erro

### Erros de Autenticação

| Código | Mensagem | Causa |
|--------|----------|-------|
| 401 | `Token inválido ou expirado` | Header `X-Auth-Token` ausente, inválido ou expirado |
| 401 | `Email ou senha incorretos` | Credenciais inválidas no login |
| 401 | `Token inválido ou expirado` | Usuário inativo |
| 403 | `Acesso restrito a administradores` | Usuário não é admin em rota admin-only |
| 403 | `Acesso restrito ao super-admin` | Usuário não é super_admin |
| 403 | `Organizacao desativada` | Org está desativada |
| 403 | `Sem permissão de origem para o seller...` | Usuário não tem `can_copy_from` |
| 403 | `Sem permissão de destino para o(s) seller(s)...` | Usuário não tem `can_copy_to` |
| 403 | `Sem permissão para rodar compatibilidade` | Usuário não tem `can_run_compat` |

### Erros de Validação

| Código | Mensagem | Causa |
|--------|----------|-------|
| 400 | `source is required` | Campos obrigatórios ausentes em POST |
| 400 | `Email ja cadastrado` | Email duplicado no signup |
| 400 | `Senha deve ter pelo menos 6 caracteres` | Senha curta |
| 400 | `Nenhum campo para atualizar` | PUT sem campos modificados |
| 400 | `At least one dimension is required` | Nenhuma dimensão em with-dimensions |
| 400 | `Link expirado ou invalido` | Token de reset expirado |
| 409 | `Usuário já existe` | Username duplicado na org |

### Erros de Recurso

| Código | Mensagem | Causa |
|--------|----------|-------|
| 404 | `Seller 'slug' não encontrado` | Seller não existe |
| 404 | `Item not found` | Anúncio não encontrado em nenhum seller |
| 404 | `Log nao encontrado` | Log de cópia não existe |
| 404 | `Usuário não encontrado` | User ID inválido |
| 404 | `Organizacao nao encontrada` | Org ID inválido |

### Erros de Billing

| Código | Mensagem | Causa |
|--------|----------|-------|
| 402 | `Periodo de teste encerrado...` | Trial esgotado, org não tem pagamento |
| 503 | `Billing not configured` | `STRIPE_SECRET_KEY` não configurado |

### Erros de Integração

| Código | Mensagem | Causa |
|--------|----------|-------|
| 502 | `ML OAuth failed...` | Falha ao trocar código por token com ML |
| 502 | `Failed to fetch ML user info` | Falha ao buscar dados do usuário ML |

---

## Estrutura de Dados

### Orgs

```json
{
  "id": "uuid",
  "name": "string",
  "email": "string",
  "active": "boolean",
  "payment_active": "boolean",
  "stripe_customer_id": "string|null",
  "stripe_subscription_id": "string|null",
  "trial_copies_used": "integer",
  "trial_copies_limit": "integer",
  "created_at": "ISO 8601",
  "updated_at": "ISO 8601"
}
```

### Users

```json
{
  "id": "uuid",
  "username": "string",
  "email": "string",
  "password_hash": "string (bcrypt)",
  "role": "admin | operator",
  "org_id": "uuid",
  "is_super_admin": "boolean",
  "can_run_compat": "boolean",
  "active": "boolean",
  "created_at": "ISO 8601",
  "last_login_at": "ISO 8601|null"
}
```

### Copy Sellers

```json
{
  "slug": "string",
  "name": "string",
  "ml_user_id": "string",
  "ml_access_token": "string",
  "ml_refresh_token": "string|null",
  "ml_token_expires_at": "ISO 8601|null",
  "org_id": "uuid",
  "active": "boolean",
  "created_at": "ISO 8601"
}
```

### Copy Logs

```json
{
  "id": "integer",
  "user_id": "uuid",
  "org_id": "uuid",
  "source_item_id": "string",
  "source_seller": "string",
  "dest_sellers": "array[string]",
  "dest_item_ids": "object|null",
  "status": "success | error | partial | needs_dimensions | in_progress",
  "error_details": "object|null",
  "created_at": "ISO 8601"
}
```

### Compat Logs

```json
{
  "id": "integer",
  "user_id": "uuid",
  "org_id": "uuid",
  "source_item_id": "string",
  "skus": "array[string]",
  "targets": "array[object]",
  "total_targets": "integer",
  "success_count": "integer",
  "error_count": "integer",
  "status": "in_progress | success | partial | error",
  "created_at": "ISO 8601"
}
```

---

## Versioning e Changelog

**Versão Atual**: 1.0.0

Esta documentação cobre todos os endpoints atuais da API.

**Histórico de Versões**:
- **1.0.0** (2026-01): Lançamento inicial com suporte a cópia de anúncios, compatibilidades, billing e administração
