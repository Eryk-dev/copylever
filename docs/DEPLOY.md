# Guia Completo de Deploy e Infraestrutura

**Última atualização:** 2026-03-05

## Índice

1. [Arquitetura de Deploy](#arquitetura-de-deploy)
2. [Dockerfile — Análise Detalhada](#dockerfile--análise-detalhada)
3. [Variáveis de Ambiente](#variáveis-de-ambiente)
4. [Setup Local](#setup-local)
5. [Setup Supabase](#setup-supabase)
6. [Scripts e Automação](#scripts-e-automação)
7. [Configuração CORS](#configuração-cors)
8. [SSL e Domínio](#ssl-e-domínio)
9. [Monitoramento e Debug](#monitoramento-e-debug)
10. [Troubleshooting](#troubleshooting)

---

## Arquitetura de Deploy

### Visão Geral

Copy Anuncios ML é uma aplicação **full-stack monolítica** desplegada como um contêiner Docker único que serve:
- **Frontend:** SPA React 19 (TypeScript) compilado com Vite
- **Backend:** FastAPI Python 3.11 com Uvicorn

### Fluxo de Build Multi-Stage

O projeto usa **Docker multi-stage build** para otimizar o tamanho final da imagem:

```
┌─────────────────────────────────────────────────────────────┐
│ Stage 1: Node.js 20 Alpine                                  │
│ - Instala dependências npm (package-lock.json)              │
│ - Compila React com TypeScript (tsc -b)                     │
│ - Cria bundle otimizado com Vite                            │
│ - Output: /app/frontend/dist (assets + index.html)          │
└─────────────────────────────────────────────────────────────┘
                            ↓
        (apenas frontend/dist é copiado)
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 2: Python 3.11 Slim                                   │
│ - Imagem base leve (slim)                                   │
│ - Instala dependências Python (pip install)                 │
│ - Copia código backend (app/)                               │
│ - Copia frontend compilado (frontend/dist)                  │
│ - Expõe porta 8000                                          │
│ - CMD: uvicorn app.main:app --host 0.0.0.0 --port 8000     │
└─────────────────────────────────────────────────────────────┘
```

### Como o Frontend é Servido

1. **Compilação:** React build gera arquivos estáticos em `frontend/dist/`
2. **Embedding:** Docker copia `frontend/dist` para a imagem Python
3. **Mounting:** FastAPI monta `/assets` como `StaticFiles` (CSS/JS/imagens)
4. **SPA Fallback:** Rota catch-all `/{path:path}` retorna `index.html` para qualquer URL não-API
   - Permite react-router funcionar (client-side routing)
   - Evita erros 404 ao recarregar páginas do SPA

### Deployment no Easypanel

**Ambiente:** Easypanel é um painel de controle Docker que:
- Constrói a imagem automaticamente a cada push para `main`
- Executa o contêiner com variáveis de ambiente via UI
- Configura reverse proxy (nginx) para HTTPS
- Fornece certificados SSL automáticos (Let's Encrypt)

**Configuração no Easypanel:**
- **App name:** copy-anuncios
- **Repository:** GitHub (branch: main)
- **Port:** 8000 (exposto internamente)
- **Domain:** copy.levermoney.com.br
- **SSL:** Automático (Let's Encrypt)

---

## Dockerfile — Análise Detalhada

```dockerfile
# --- Build frontend ---
FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build
```

### Stage 1: Build Frontend (Node.js 20 Alpine)

| Linha | Comando | Explicação |
|-------|---------|-----------|
| `FROM node:20-alpine AS frontend` | Usa Node.js 20 em Alpine (imagem leve ~150MB) | Alpine é imagem Linux mínima, reduz tamanho |
| `WORKDIR /app/frontend` | Define diretório de trabalho | Caminhos relativos começam aqui |
| `COPY frontend/package.json frontend/package-lock.json ./` | Copia definição de dependências | Lock file garante versões exatas |
| `RUN npm ci` | **Clean Install** — instala exatamente o lock file | `npm ci` vs `npm install` = produção (determinístico) |
| `COPY frontend/ .` | Copia código-fonte TypeScript/JSX | Copia tudo: src/, public/, tsconfig.json, vite.config.ts |
| `RUN npm run build` | Executa Vite build | Gera `dist/` com assets otimizados e minificados |

**Resultado:** Diretório `dist/` contém:
- `index.html` — template SPA
- `assets/` — JS/CSS/imagens bundled e hashados
- `dist/` é ~200KB minificado (vs ~5MB node_modules)

---

```dockerfile
# --- Python app ---
FROM python:3.11-slim
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ app/

# Copy built frontend
COPY --from=frontend /app/frontend/dist frontend/dist

# Env vars come from runtime (Easypanel env), not build args
ENV PORT=8000

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Stage 2: Runtime (Python 3.11 Slim)

| Linha | Comando | Explicação |
|-------|---------|-----------|
| `FROM python:3.11-slim` | Imagem Python 3.11 minimalista | Slim = sem docs, dev tools (apenas runtime) |
| `WORKDIR /app` | Raiz do projeto no contêiner | App roda em `/app` |
| `COPY requirements.txt .` | Copia lista de dependências Python | Especifica versão exata de cada pacote |
| `RUN pip install --no-cache-dir -r requirements.txt` | Instala pacotes | `--no-cache-dir` = reduz tamanho (não cacheia downloads) |
| `COPY app/ app/` | Copia código backend | Contém main.py, routers/, services/, db/ |
| `COPY --from=frontend /app/frontend/dist frontend/dist` | Copia frontend compilado do Stage 1 | `--from=frontend` = referencia outro stage |
| `ENV PORT=8000` | Define variável de ambiente padrão | Hardcoded na imagem (pode ser sobrescrito em runtime) |
| `EXPOSE 8000` | Documenta porta (não abre automaticamente) | Informativo; Easypanel configura port mapping |
| `CMD [...]` | Comando que executa ao iniciar contêiner | Uvicorn ASGI server em modo produção |

### Health Check

A imagem não declara `HEALTHCHECK` explicitamente. Easypanel verifica saúde via:
- Requisição HTTP periodicamente ao endpoint `/health`
- Resposta: `{"status": "ok"}` (HTTP 200)

---

## Variáveis de Ambiente

Todas as variáveis são carregadas do arquivo `.env` via `BaseSettings` (Pydantic).

### Mercado Livre (OAuth2)

| Variável | Obrigatória | Descrição | Exemplo |
|----------|:-:|-----------|---------|
| `ML_APP_ID` | ✓ | ID da aplicação OAuth no Mercado Livre Dev Center | `123456789` |
| `ML_SECRET_KEY` | ✓ | Chave secreta OAuth (não expor!) | `abc123xyz...` |
| `ML_REDIRECT_URI` | ✓ | URI de callback OAuth (deve estar registrada no ML) | `https://copy.levermoney.com.br/api/ml/callback` |

**Como obter:**
1. Acessar [Mercado Livre Dev Center](https://developers.mercadolibre.com.br)
2. Criar aplicação para Copy Anuncios
3. Configurar Redirect URI exatamente igual a `ML_REDIRECT_URI`
4. Copiar ID e Secret para `.env`

**Observação:** Valores diferentes para desenvolvimento e produção são comuns (app ML separate por ambiente).

---

### Supabase (Database)

| Variável | Obrigatória | Descrição | Exemplo |
|----------|:-:|-----------|---------|
| `SUPABASE_URL` | ✓ | URL base do projeto Supabase | `https://wrbrbhuhsaaupqsimkqz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ | Chave de serviço (bypassa RLS, apenas backend) | `eyJhbGciOi...` (longo token) |
| `SUPABASE_KEY` | ✗ | Chave anon (alternativa, respeta RLS) | Não usado; service_role_key é obrigatória |

**Service Role Key vs Anon Key:**
- **Service Role:** Acesso total ao banco; usada apenas no backend (servidor)
- **Anon:** Respeita Row Level Security (RLS); usada no frontend (cliente)

Projeto usa `SUPABASE_SERVICE_ROLE_KEY` porque precisa de acesso irrestrito para:
- Criar/gerenciar orgs
- Gerenciar usuários de outras orgs (super_admin)
- Atualizar tokens de refresh

**Encontrar valores:**
1. [Supabase Dashboard](https://supabase.com)
2. Projeto: `parts-catalogs` (ID: `wrbrbhuhsaaupqsimkqz`)
3. Settings → API → URL + Keys

---

### Autenticação

| Variável | Obrigatória | Descrição | Padrão |
|----------|:-:|-----------|--------|
| `ADMIN_MASTER_PASSWORD` | ✓ | Senha one-time para promover primeiro admin | `changeme123` |

**Uso:**
- POST `/api/auth/admin-promote` com esta senha cria primeiro admin
- Deve ser alterada após setup inicial
- Armazenada em `.env`, nunca em código

---

### Stripe (Pagamentos)

| Variável | Obrigatória | Descrição | Exemplo |
|----------|:-:|-----------|---------|
| `STRIPE_SECRET_KEY` | ✓ | Chave API secreta Stripe | `sk_live_...` ou `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | ✓ | Assinatura de webhook | `whsec_...` |
| `STRIPE_PRICE_ID` | ✓ | ID do produto/preço para assinatura | `price_...` |

**Diferença producao/teste:**
- **Teste:** Começam com `sk_test_`, `whsec_test_`
- **Produção:** Começam com `sk_live_`, `whsec_live_`

**Configuração:**
1. [Stripe Dashboard](https://dashboard.stripe.com)
2. Developers → API Keys → Copiar Secret Key
3. Webhooks → Criar endpoint `https://copy.levermoney.com.br/api/billing/webhook`
4. Selecionar eventos: `customer.subscription.*`, `charge.*`
5. Copiar Signing Secret

---

### Email (SMTP)

| Variável | Obrigatória | Descrição | Padrão |
|----------|:-:|-----------|--------|
| `SMTP_HOST` | ✗ | Host do servidor SMTP | (não há padrão) |
| `SMTP_PORT` | ✗ | Porta SMTP | `587` |
| `SMTP_USER` | ✗ | Usuário de autenticação | (não há padrão) |
| `SMTP_PASSWORD` | ✗ | Senha SMTP | (não há padrão) |
| `SMTP_FROM` | ✗ | Endereço "From" de emails | `SMTP_USER` se vazio |

**Uso:** Enviar emails de reset de senha. Se vazio, feature é desabilitada (sem erro).

**Exemplo Gmail:**
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu-email@gmail.com
SMTP_PASSWORD=sua-senha-app-específica
SMTP_FROM=no-reply@levermoney.com.br
```

---

### Servidor

| Variável | Obrigatória | Descrição | Padrão |
|----------|:-:|-----------|--------|
| `BASE_URL` | ✗ | URL base pública (para oauth redirects) | `http://localhost:8000` |
| `CORS_ORIGINS` | ✗ | Origens permitidas (comma-separated) | `http://localhost:5173,http://localhost:3000` |
| `PORT` | ✗ | Porta do Uvicorn (em Docker, fixado a 8000) | `8000` |

**BASE_URL Importante:**
- ML OAuth redireciona para `{BASE_URL}/api/ml/callback`
- Deve ser a URL pública acessível
- Em produção: `https://copy.levermoney.com.br`
- Em local: `http://localhost:8000`

**CORS_ORIGINS Importante:**
- Limita de quais domínios o frontend pode acessar a API
- Desenvolvimento: `http://localhost:5173` (Vite dev server) + `http://localhost:3000` (alternativa)
- Produção: `https://copy.levermoney.com.br`

---

### Arquivo .env Exemplo Completo

```bash
# === Mercado Livre App ===
ML_APP_ID=123456789
ML_SECRET_KEY=abc123xyz789...
ML_REDIRECT_URI=https://copy.levermoney.com.br/api/ml/callback

# === Supabase ===
SUPABASE_URL=https://wrbrbhuhsaaupqsimkqz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# === Auth ===
ADMIN_MASTER_PASSWORD=super-senha-segura-123

# === Stripe ===
STRIPE_SECRET_KEY=sk_live_YOUR_KEY_HERE
STRIPE_WEBHOOK_SECRET=whsec_YOUR_SECRET_HERE
STRIPE_PRICE_ID=price_YOUR_PRICE_ID_HERE

# === SMTP (opcional) ===
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=noreply@levermoney.com.br
SMTP_PASSWORD=senha-app-específica-123
SMTP_FROM=no-reply@levermoney.com.br

# === Servidor ===
BASE_URL=https://copy.levermoney.com.br
CORS_ORIGINS=https://copy.levermoney.com.br,http://localhost:5173
```

---

## Setup Local

### Pré-requisitos

- **Python 3.11+** (verificar com `python3 --version`)
- **Node.js 20+** (verificar com `node --version`)
- **npm 10+** (vem com Node.js; verificar com `npm --version`)
- **Git**
- **Um editor de código** (VS Code recomendado)

### Passo 1: Clonar Repositório

```bash
git clone https://github.com/levermoney/copy-anuncios.git
cd copy-anuncios
```

### Passo 2: Criar Arquivo .env Local

Copiar `.env.example` e preencher valores reais:

```bash
cp .env.example .env
```

Editar `.env` (abrir em editor):

```bash
# Adicionar valores reais de:
# - ML_APP_ID, ML_SECRET_KEY, ML_REDIRECT_URI
# - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
# - ADMIN_MASTER_PASSWORD
# - STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_ID
# - BASE_URL (pode manter http://localhost:8000)
# - CORS_ORIGINS (pode manter http://localhost:5173,http://localhost:3000)
```

### Passo 3: Setup Backend

```bash
# Criar virtual environment (isolado)
python3 -m venv venv

# Ativar virtual environment
source venv/bin/activate  # Linux/Mac
# ou em Windows:
# venv\Scripts\activate

# Instalar dependências
pip install -r requirements.txt

# Verificar instalação
python3 -c "import fastapi; print('FastAPI:', fastapi.__version__)"
```

### Passo 4: Setup Frontend

```bash
cd frontend

# Instalar dependências
npm install

# Verificar instalação
npm list react react-dom typescript vite
```

### Passo 5: Iniciar Servidor Backend

Em um terminal separado:

```bash
# Na raiz do projeto
source venv/bin/activate  # Se ainda não ativou
uvicorn app.main:app --reload
```

Esperado:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete
```

Testar:
```bash
curl http://localhost:8000/api/health
# Resposta: {"status":"ok"}
```

### Passo 6: Iniciar Servidor Frontend

Em outro terminal:

```bash
cd frontend
npm run dev
```

Esperado:
```
  VITE v6.0.0  ready in 250 ms

  ➜  Local:   http://localhost:5173/
  ➜  press h + enter to show help
```

Acessar: http://localhost:5173

### Fluxo de Desenvolvimento

**Terminal 1 - Backend:**
```bash
source venv/bin/activate
uvicorn app.main:app --reload
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

**Terminal 3 - Git (conforme necessário):**
```bash
git status
git add .
git commit -m "feat: ..."
git push origin main
```

### Rebuild Manualmente

Se fizer mudanças no código e não vir refletidas:

**Frontend:**
```bash
cd frontend
npm run build  # Gera dist/ otimizado
npm run dev    # Retorna a dev mode
```

**Backend:**
- Com `--reload`, deve reiniciar automaticamente ao salvar arquivos
- Se não, pressione `Ctrl+C` e execute `uvicorn ...` novamente

---

## Setup Supabase

### Projeto

- **Nome:** parts-catalogs
- **ID:** wrbrbhuhsaaupqsimkqz
- **Região:** sa-east-1 (São Paulo)
- **URL:** https://wrbrbhuhsaaupqsimkqz.supabase.co

### Obter Chaves

1. Acessar [Supabase Dashboard](https://app.supabase.com)
2. Selecionar projeto `parts-catalogs`
3. Settings → API
4. Copiar:
   - **URL:** para `SUPABASE_URL`
   - **Service Role Secret:** para `SUPABASE_SERVICE_ROLE_KEY`

### Rodar Migrations

As migrations SQL criaram o esquema inicial. Se precisar recriar ou verificar:

```bash
# Acesso local via Supabase CLI (opcional)
supabase db pull  # Puxa schema atual

# Ou via SQL Editor no Dashboard:
# 1. Acessar SQL Editor
# 2. Verificar tabelas criadas:
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public';
```

### Tabelas Criadas

As migrations criadas (app/db/migrations/001-010_*.sql) estruturam:

**Autenticação:**
- `orgs` — organizações (tenants)
- `users` — usuários com role (admin/operator)
- `user_sessions` — tokens de sessão (7 dias TTL)
- `user_permissions` — permissões por seller (can_copy_from, can_copy_to)
- `auth_logs` — auditoria de login/logout

**Operações:**
- `copy_sellers` — contas ML conectadas (armazena tokens OAuth)
- `copy_logs` — histórico de cópias
- `compat_logs` — histórico de compatibilidades

**Debug:**
- `api_debug_logs` — logs de chamadas falhas à API ML

**Exemplo de consulta:**
```sql
-- Verificar usuários
SELECT id, email, role, is_super_admin, org_id FROM users LIMIT 10;

-- Verificar orgs
SELECT id, name, active, payment_active FROM orgs;

-- Verificar sellers conectados
SELECT slug, org_id, active, ml_token_expires_at FROM copy_sellers;
```

### Service Role Key

**Por que é obrigatória:**
- Permite bypass de Row Level Security (RLS)
- Necessária para operações cross-org (super_admin)
- Gerenciamento de tokens de refresh
- Criação/atualização de usuários por admin

**Segurança:**
- Nunca exponha esta chave no frontend
- Nunca commite em repositório (usar `.env`)
- Restringir acesso apenas ao backend
- Rotate periodicamente

---

## Scripts e Automação

### ralph.sh — Agent de Desenvolvimento Autônomo

**Localização:** `scripts/ralph/ralph.sh`

**Propósito:** Loop de agent autônomo que executa histórias de PRD automaticamente.

**Uso:**
```bash
./scripts/ralph/ralph.sh [--tool amp|claude] [max_iterations]

# Exemplos:
./scripts/ralph/ralph.sh                    # Usa amp, 10 iterações
./scripts/ralph/ralph.sh --tool claude 5    # Usa claude, 5 iterações
./scripts/ralph/ralph.sh --tool=amp 20      # Usa amp, 20 iterações
```

**Fluxo:**
1. Lê PRD em `scripts/ralph/prd.json`
2. Verifica branch current vs último branch
3. Se branch mudou, arquiva run anterior em `scripts/ralph/archive/`
4. Executa iterações:
   - Encontra story com `passes: false`
   - Implementa uma story
   - Commit automático se passar
   - Atualiza PRD e progress.txt
5. Para quando todas as stories têm `passes: true`

**Arquivos:**
- `prd.json` — Product Requirements Document (stories)
- `progress.txt` — Log de progresso (append-only)
- `archive/` — Runs antigos (organizados por data + branch)
- `.last-branch` — Último branch processado

**Padrões Consolidados em progress.txt:**

A seção `## Codebase Patterns` no topo do `progress.txt` documenta learnings reutilizáveis:
```
## Codebase Patterns
- Use SQL <number> template tags para agregações
- Sempre use IF NOT EXISTS em migrations
- Export types from actions.ts para componentes UI
```

---

## Configuração CORS

### O que é CORS

**Cross-Origin Resource Sharing** — mecanismo que permite ou bloqueia requisições HTTP entre domínios diferentes.

**Por que importa:**
- Frontend em `http://localhost:5173` (dev)
- Backend em `http://localhost:8000`
- Navegador bloqueia por padrão (segurança)
- CORS desbloqueia se configurado

### Configuração em app/main.py

```python
origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

**O que cada setting faz:**
- `allow_origins` — Lista de domínios permitidos (de `CORS_ORIGINS`)
- `allow_credentials=True` — Permite cookies/headers de autenticação
- `allow_methods=["*"]` — Permite GET, POST, PUT, DELETE, etc.
- `allow_headers=["*"]` — Permite qualquer header (inclui X-Auth-Token)

### Valores por Ambiente

**Desenvolvimento:**
```
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
```
- `http://localhost:5173` — Dev server Vite
- `http://localhost:3000` — Alternativa (ex: Next.js)

**Produção:**
```
CORS_ORIGINS=https://copy.levermoney.com.br
```
- Apenas domínio de produção
- HTTPS obrigatório

**Staging (se aplicável):**
```
CORS_ORIGINS=https://staging.copy.levermoney.com.br,https://copy.levermoney.com.br
```

### Troubleshooting CORS

**Erro no navegador:**
```
Access to XMLHttpRequest at 'http://localhost:8000/api/copy'
from origin 'http://localhost:5173' has been blocked by CORS policy
```

**Verificar:**
1. Frontend está em qual origem? (URL bar do navegador)
2. `.env` tem essa origem em `CORS_ORIGINS`?
3. Reiniciou backend após editar `.env`?

**Teste:**
```bash
curl -H "Origin: http://localhost:5173" \
     -H "Access-Control-Request-Method: POST" \
     http://localhost:8000/api/health -v
```

Procurar por `Access-Control-Allow-Origin` na resposta.

---

## SSL e Domínio

### Domínio Produção

**Domínio:** copy.levermoney.com.br

**Configuração:**
- DNS aponta para IP do servidor Easypanel
- Easypanel configura nginx como reverse proxy
- Certificado SSL via Let's Encrypt (automático)

### Certificado SSL

**Automático via Easypanel:**
- Let's Encrypt renova automaticamente (90 dias)
- Sem ação manual necessária
- HTTPS é obrigatório em produção

**Verificar certificado:**
```bash
openssl s_client -connect copy.levermoney.com.br:443 -showcerts
```

### Redirecionar HTTP → HTTPS

Easypanel configura automaticamente. Todos os acessos a `http://copy.levermoney.com.br` redirecionam para `https://`.

### OAuth Redirect URI

**Mercado Livre exige HTTPS:**
```
ML_REDIRECT_URI=https://copy.levermoney.com.br/api/ml/callback
```

Se usar HTTP em desenvolvimento, registrar app ML separada com:
```
ML_REDIRECT_URI=http://localhost:8000/api/ml/callback
```

---

## Monitoramento e Debug

### Health Check

**Endpoint:**
```
GET /health
GET /api/health
```

**Resposta:**
```json
{"status": "ok"}
```

**Uso:** Easypanel verifica periodicamente para detectar crashes.

### Debug Endpoint

**Endpoint (Super Admin Only):**
```
GET /api/debug/env
```

**Resposta (valores mascarados por segurança):**
```json
{
  "ml_app_id": "...6789",
  "ml_secret_key": "...xyza",
  "ml_redirect_uri": "https://copy.levermoney.com.br/api/ml/callback",
  "supabase_url": "https://wrbrbhuhsaaupqsimkqz.supabase.co",
  "supabase_service_role_key": "SET",
  "supabase_key": "SET",
  "base_url": "https://copy.levermoney.com.br",
  "cors_origins": "https://copy.levermoney.com.br,http://localhost:5173"
}
```

**Como usar:**
```bash
curl -H "X-Auth-Token: seu-token-super-admin" \
     http://localhost:8000/api/debug/env
```

### Logs do Uvicorn

**Output padrão (sempre ativo):**
```
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete
INFO:     127.0.0.1:8000 - "GET /api/health HTTP/1.1" 200 OK
WARNING: httpx:0.28.1 [some warning]
ERROR:   app.services.ml_api: Failed to call ML API (attempt 2/4)
```

**Aumentar verbosidade (debug):**
```bash
uvicorn app.main:app --reload --log-level debug
```

### Logs no Supabase

**API Debug Logs — Chamadas Falhas:**
```sql
SELECT id, source_item_id, dest_seller, attempt_number,
       error_message, created_at
FROM api_debug_logs
WHERE resolved = false
ORDER BY created_at DESC
LIMIT 20;
```

**Auth Logs — Auditoria:**
```sql
SELECT user_id, username, action, created_at
FROM auth_logs
WHERE org_id = 'org-uuid'
ORDER BY created_at DESC
LIMIT 50;
```

**Copy Logs — Histórico de Operações:**
```sql
SELECT id, user_id, org_id, source_seller, status, created_at
FROM copy_logs
WHERE org_id = 'org-uuid'
ORDER BY created_at DESC;
```

### Monitoramento em Produção

**Recomendações:**
1. **Uptime Monitoring:** UptimeRobot / Pingdom (monitorar `/api/health`)
2. **Log Aggregation:** Datadog / New Relic / Sentry (centralizar logs)
3. **Error Tracking:** Sentry / Rollbar (alertas de exceções)
4. **Metrics:** Prometheus / Grafana (performance, latência)

**Alertas essenciais:**
- `/health` retorna erro (app down)
- Taxa de erro de API > 5%
- Latência p95 > 5s
- Taxa de falha de conexão Supabase > 1%

---

## Troubleshooting

### Backend não inicia

**Erro:** `ModuleNotFoundError: No module named 'fastapi'`

**Solução:**
```bash
source venv/bin/activate
pip install -r requirements.txt
```

---

**Erro:** `uvicorn: command not found`

**Solução:**
```bash
source venv/bin/activate
pip install uvicorn
```

---

### Frontend build falha

**Erro:** `error TS2307: Cannot find module 'react'`

**Solução:**
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run build
```

---

### CORS bloqueando requisições

**Erro no console:** `Access to XMLHttpRequest blocked by CORS`

**Checklist:**
1. Frontend URL = origem atual no navegador?
2. URL está em `CORS_ORIGINS` no `.env`?
3. Backend foi reiniciado após editar `.env`?

**Debug:**
```bash
curl -i -H "Origin: http://localhost:5173" \
     http://localhost:8000/api/auth/me
```

Procurar por header `Access-Control-Allow-Origin` na resposta.

---

### Supabase: Erro de conexão

**Erro:** `Connection refused to wrbrbhuhsaaupqsimkqz.supabase.co`

**Checklist:**
1. Internetconectada?
2. `SUPABASE_URL` está correto?
3. `SUPABASE_SERVICE_ROLE_KEY` está correto?

**Teste:**
```bash
curl https://wrbrbhuhsaaupqsimkqz.supabase.co/rest/v1/
```

Se retornar JSON, Supabase está accessible.

---

### Uvicorn: Address already in use

**Erro:** `OSError: [Errno 48] Address already in use`

**Solução — Mudar porta:**
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

**Ou matar processo anterior:**
```bash
# Listar processos em porta 8000
lsof -i :8000

# Matar processo
kill -9 <PID>
```

---

### Docker: Build muito lento

**Causa:** Baixando node_modules e pip packages pela primeira vez

**Solução — Cache:**
```bash
# Docker cacheia cada layer
# Mude código (não dependências), rebuild é rápido

# Se mudou package.json ou requirements.txt:
docker build --no-cache -t copy-anuncios .
```

---

### Supabase: Service role key rejeitado

**Erro:** `Invalid API Key`

**Solução:**
1. Copiar token completo (pode ser muito longo)
2. Verificar se copiou do campo correto (Settings → API → Service Role Secret)
3. Não está espaços no início/fim

---

### Frontend SPA retorna 404

**Sintoma:** Recarregar página `/admin` → erro 404

**Causa:** SPA fallback não configurado

**Verificação:** Em `app/main.py`, existe rota catch-all?
```python
@app.get("/{path:path}")
async def serve_frontend(request: Request, path: str):
    ...
    return FileResponse(FRONTEND_DIR / "index.html")
```

Se falta, adicionar essa rota (vide app/main.py atual).

---

## Checklist de Deploy para Produção

- [ ] Todas as variáveis `.env` estão configuradas (incluindo Stripe, Supabase, ML)
- [ ] `BASE_URL` é domínio público (https)
- [ ] `CORS_ORIGINS` contém apenas domínios de produção
- [ ] Certificado SSL ativo (Let's Encrypt)
- [ ] Banco de dados Supabase criado e migrado
- [ ] Webhook Stripe configurado
- [ ] OAuth app Mercado Livre registrado
- [ ] Frontend compilado com `npm run build`
- [ ] Docker build bem-sucedido (`docker build -t copy-anuncios .`)
- [ ] Health check retorna 200 (`curl /health`)
- [ ] Primeiro admin criado via `/api/auth/admin-promote`
- [ ] Logs sendo coletados (Sentry/Datadog)
- [ ] Backups do Supabase habilitados
- [ ] Monitoramento de uptime ativo

---

## Referências

- [Dockerfile Reference](https://docs.docker.com/engine/reference/builder/)
- [Pydantic Settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/)
- [FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/)
- [Supabase Documentation](https://supabase.com/docs)
- [Mercado Livre API Docs](https://developers.mercadolibre.com.br/)
- [Stripe API Reference](https://stripe.com/docs/api)

---

**Última atualização:** 2026-03-05
**Mantido por:** Documentação de Deploy
