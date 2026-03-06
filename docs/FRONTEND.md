# Documentação Frontend - Copy Anúncios

Documentação completa da arquitetura, componentes e fluxos do frontend da plataforma Copy Anúncios.

**Data:** 2026-03-05
**Stack:** React 19 + TypeScript + Vite
**Versão Node:** 19.x ou superior

---

## Sumário

1. [Visão Geral da Arquitetura](#visão-geral-da-arquitetura)
2. [Estrutura de Pastas](#estrutura-de-pastas)
3. [Padrão de Roteamento](#padrão-de-roteamento)
4. [Páginas](#páginas)
5. [Componentes](#componentes)
6. [Hooks Customizados](#hooks-customizados)
7. [Design System](#design-system)
8. [Autenticação no Frontend](#autenticação-no-frontend)
9. [Tipos TypeScript](#tipos-typescript)
10. [Fluxos Principais](#fluxos-principais)

---

## Visão Geral da Arquitetura

### Stack Tecnológico

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Build | Vite | 6.x |
| Framework | React | 19.0.0 |
| Linguagem | TypeScript | 5.7.x |
| HTTP Client | Fetch API (nativa) | - |
| UI | CSS Custom Properties | - |
| State Management | Context API (Toast) | - |

### Características Principais

- **SPA (Single Page Application)** — Roteamento cliente-side sem refresh
- **TypeScript Strict Mode** — `noUnusedLocals`, `noUnusedParameters`, type checking severo
- **Design System** — CSS variables com suporte automático para light/dark theme
- **Sem bibliotecas externas desnecessárias** — React puro, sem Redux, Zustand, etc.
- **Polling para operações em background** — Logs são atualizados a cada 5s quando há operações em progresso
- **Multi-tenant** — Cada organização tem acesso isolado via headers de autenticação

### Princípios de Design

1. **Responsivo** — Mobile-first, funciona em telas pequenas
2. **Acessível** — Focus states visíveis, semântica HTML adequada
3. **Performante** — Roteamento cliente-side, sem carregamento de página inteira
4. **Dark Mode** — Suporte automático via `prefers-color-scheme`
5. **Progressiva** — Funciona sem JS, degrada gracefully

---

## Estrutura de Pastas

```
frontend/
├── src/
│   ├── main.tsx                 # Entrypoint React + ToastProvider
│   ├── index.css                # Design System global (CSS variables)
│   ├── vite-env.d.ts            # Tipos Vite
│   ├── App.tsx                  # Router principal + layout
│   ├── hooks/
│   │   └── useAuth.ts           # Hook de autenticação + gerenciamento de sellers
│   ├── lib/
│   │   └── api.ts               # Tipos e constantes de API
│   ├── pages/                   # Páginas (telas principais)
│   │   ├── LandingPage.tsx      # Página de marketing (não autenticada)
│   │   ├── Login.tsx            # Formulário de login
│   │   ├── Signup.tsx           # Formulário de cadastro
│   │   ├── ForgotPassword.tsx   # Recuperação de senha
│   │   ├── ResetPassword.tsx    # Redefinição de senha
│   │   ├── CopyPage.tsx         # Cópia de anúncios
│   │   ├── CompatPage.tsx       # Cópia de compatibilidades
│   │   ├── Admin.tsx            # Conexão de sellers
│   │   ├── UsersPage.tsx        # Gerenciamento de usuários
│   │   ├── BillingPage.tsx      # Status de assinatura
│   │   └── SuperAdminPage.tsx   # Dashboard de organizações
│   └── components/              # Componentes reutilizáveis
│       ├── CopyForm.tsx         # Formulário principal de cópia
│       ├── CopyProgress.tsx     # Resultado e dimensões
│       ├── DimensionForm.tsx    # Formulário de dimensões
│       ├── SellerSelect.tsx     # Dropdown de sellers
│       ├── Toast.tsx            # Context de notificações
│       └── (Card é inline em CopyPage.tsx)
├── index.html                   # HTML root
├── vite.config.ts               # Config Vite
├── tsconfig.json                # TypeScript config
└── package.json                 # Dependências
```

---

## Padrão de Roteamento

O aplicativo usa **roteamento gerenciado pelo estado (state-driven routing)** sem bibliotecas como React Router.

### Fluxo de Navegação

```
App.tsx (Router Principal)
├── Não autenticado
│   ├── LandingPage     (landing)
│   ├── Login           (login)
│   ├── Signup          (signup)
│   ├── ForgotPassword  (forgot)
│   └── ResetPassword   (reset) — triggered by URL param ?reset_token=xxx
│
└── Autenticado
    ├── Tabs Principais (visibilidade baseada em role/permissões)
    │   ├── Copy Tab      → CopyPage
    │   ├── Compat Tab    → CompatPage
    │   ├── Admin Tab     → Admin (painel com sub-abas)
    │   │   ├── Sellers   → Admin.tsx
    │   │   ├── Users     → UsersPage.tsx
    │   │   └── Billing   → BillingPage.tsx
    │   └── Plataforma Tab → SuperAdminPage (super_admin only)
    │
    └── Paywall
        └── Exibido quando: billing ativo + sem pagamento + trial exaurido
```

### State Variables (App.tsx)

| State | Tipo | Propósito |
|-------|------|----------|
| `view` | `'copy' \| 'admin' \| 'compat' \| 'super'` | Aba ativa |
| `adminSubView` | `'sellers' \| 'users' \| 'billing'` | Sub-aba do Admin |
| `authView` | `'landing' \| 'login' \| 'signup' \| 'forgot' \| 'reset'` | Tela de autenticação |
| `resetToken` | `string` | Token do reset link (da URL) |
| `paymentActive` | `boolean` | Status de pagamento da org |
| `trialActive` | `boolean` | Se está no período de trial |
| `trialExhausted` | `boolean` | Se as cópias de trial acabaram |
| `trialCopiesUsed` | `number` | Cópias de trial usadas |
| `trialCopiesLimit` | `number` | Limite de cópias de trial |
| `billingAvailable` | `boolean` | Se billing está configurado na plataforma |

---

## Páginas

### LandingPage

**Arquivo:** `src/pages/LandingPage.tsx`

**Propósito:** Página de marketing para usuários não autenticados.

**Props:**
```typescript
interface Props {
  onNavigateToLogin: () => void;
  onNavigateToSignup: () => void;
}
```

**Características:**
- Scroll reveal animations (Intersection Observer)
- Terminal com simulação de logs (hero section)
- Pricing card
- Social proof (testimonial)
- Dark mode only (CSS variables definidas em `css` interno)
- Responsive (mobile-friendly com media queries)

**Fluxos:**
1. Usuário clica "Começar" → chama `onNavigateToSignup()`
2. Usuário clica "Entrar" → chama `onNavigateToLogin()`

**Seções:**
1. **Nav** — Logo + botões de ação
2. **Hero** — Título, subtítulo, terminal animado
3. **Quote** — Depoimento de cliente
4. **O que é copiado** — Grid de features
5. **Pricing** — Plano único com CTA
6. **Footer** — Copyright + links

---

### Login

**Arquivo:** `src/pages/Login.tsx`

**Propósito:** Autenticação via email/senha.

**Props:**
```typescript
interface Props {
  onLogin: (email: string, password: string) => Promise<boolean>;
  onNavigateToSignup?: () => void;
  onNavigateToForgotPassword?: () => void;
}
```

**State:**
- `email` — Email do usuário
- `password` — Senha
- `masterPassword` — Senha para admin-promote (oculto)
- `showAdmin` — Toggle para exibir campo de master password
- `loading` — Carregando
- `error` — Mensagem de erro
- `shake` — Animação de erro

**Fluxos:**
1. **Login Normal** — Email + senha → `onLogin()` → token salvo em localStorage
2. **Admin Promote** — Email + senha + master_password → POST `/api/auth/admin-promote` → auto-login
3. **Forgot Password** — Link para `onNavigateToForgotPassword()`
4. **Signup** — Link para `onNavigateToSignup()`

**Validações:**
- Email e senha obrigatórios
- Mensagem de erro: "Email ou senha incorretos"

---

### Signup

**Arquivo:** `src/pages/Signup.tsx`

**Propósito:** Criação de conta (self-service onboarding).

**Props:**
```typescript
interface Props {
  onSignup: (email: string, password: string, companyName: string) => Promise<{success: boolean, error?: string}>;
  onNavigateToLogin: () => void;
}
```

**State:**
- `email`, `password`, `companyName` — Campos do formulário
- `loading`, `error`, `shake` — Estados de requisição

**Fluxos:**
1. Usuário preenche email, senha (min 6 chars), nome da empresa
2. POST `/api/auth/signup` com `{ email, password, company_name }`
3. Se sucesso → token retornado → salvo em localStorage → auto-login

**Validações:**
- Senha mínimo 6 caracteres
- Email válido (validação HTML5)
- Todos os campos obrigatórios

---

### ForgotPassword

**Arquivo:** `src/pages/ForgotPassword.tsx`

**Propósito:** Solicitar link de reset de senha.

**Props:**
```typescript
interface Props {
  onNavigateToLogin: () => void;
}
```

**State:**
- `email` — Email para reset
- `sent` — Se o email foi enviado
- `loading`, `error`

**Fluxos:**
1. Usuário digita email
2. POST `/api/auth/forgot-password` com `{ email }`
3. Exibe mensagem: "Se o email existir, enviaremos instruções"
4. Usuário clica "Voltar ao login"

---

### ResetPassword

**Arquivo:** `src/pages/ResetPassword.tsx`

**Propósito:** Redefinir senha via token do email.

**Props:**
```typescript
interface Props {
  token: string;                  // Do URL param ?reset_token=xxx
  onNavigateToLogin: () => void;
}
```

**State:**
- `password`, `confirmPassword` — Novas senhas
- `success` — Se o reset foi bem-sucedido
- `loading`, `error`, `shake`

**Fluxos:**
1. Usuário recebe email com link: `?reset_token=abc123`
2. App.tsx detecta param e renderiza ResetPassword
3. Usuário digita nova senha (confirmação obrigatória)
4. POST `/api/auth/reset-password` com `{ token, new_password }`
5. Se sucesso → redireciona para login

---

### CopyPage

**Arquivo:** `src/pages/CopyPage.tsx`

**Propósito:** Interface principal para cópia de anúncios.

**Props:**
```typescript
interface Props {
  sellers: Seller[];
  headers: () => Record<string, string>;
  user: AuthUser | null;
}
```

**State Principal:**
- `results` — Resultado da cópia (CopyResponse + source)
- `sourceMap` — Mapping de item_id → seller_slug
- `copying` — Operação em progresso
- `logs` — Histórico de cópias
- `logsLoaded` — Se histórico foi carregado
- `previewOpen`, `previews`, `previewLoading` — Estado do preview
- `statusFilter` — Filtro de logs (success/error/needs_dimensions)

**Fluxos Principais:**

#### 1. Cópia de Anúncios
```
CopyForm (input IDs)
  ↓
/api/copy/resolve-sellers (detecta sellers)
  ↓
Usuário seleciona destinos
  ↓
POST /api/copy { source, destinations, item_ids }
  ↓
CopyProgress (exibe resultado)
  ↓
Se needs_dimensions → DimensionForm
```

#### 2. Retry com Dimensões
```
LogRow (histórico)
  ↓
Clica "Corrigir" (se isDimensionError)
  ↓
DimensionForm renderiza inline
  ↓
POST /api/copy/retry-dimensions { log_id, dimensions }
```

#### 3. Polling de Logs
```
useEffect([hasInProgress])
  ↓
Se há operação em progresso
  ↓
setInterval(() => loadLogs(), 5000)
  ↓
Atualiza tabela em tempo real
```

**Componentes Filhos:**
- `CopyForm` — Formulário de entrada
- `CopyProgress` — Resultado e forms de dimensões
- `Card` — Container genérico

**Permissões:**
- `Tab visible if:` admin OR (can_copy_from AND can_copy_to)
- `Source sellers:` filtrado por can_copy_from
- `Dest sellers:` filtrado por can_copy_to

---

### CompatPage

**Arquivo:** `src/pages/CompatPage.tsx`

**Propósito:** Cópia de compatibilidades veiculares.

**Props:**
```typescript
interface Props {
  sellers: Seller[];
  headers: () => Record<string, string>;
}
```

**State Principal:**
- `sourceInput` — Item de origem
- `preview` — CompatPreview (thumbnail, SKUs, compatibilidades)
- `skuInput` — SKUs para buscar
- `searchResults` — Itens encontrados (CompatSearchResult[])
- `copyResult` — Resultado do envio (background job)
- `logs` — Histórico compat

**Fluxos Principais:**

#### 1. Preview de Item
```
Usuário digita item ID
  ↓
onBlur/Enter normaliza ID
  ↓
GET /api/compat/preview/{itemId}?seller={slug}
  ↓
Exibe thumbnail, título, SKUs, compat count
```

#### 2. Busca por SKU
```
Usuário digita SKUs (separados por vírgula/espaço)
  ↓
Clica "Buscar Anúncios"
  ↓
POST /api/compat/search-sku { skus: [...] }
  ↓
Agrupa resultados por SKU
  ↓
Exibe itens encontrados com seller_name
```

#### 3. Cópia de Compatibilidades
```
Clica "Copiar Compatibilidades"
  ↓
POST /api/compat/copy {
  source_item_id,
  targets: [{ seller_slug, item_id }],
  skus: [...]
}
  ↓
Backend enfileira job em background
  ↓
Frontend mostra "Copiando {total} destino(s) em segundo plano"
  ↓
Polling carrega histórico
```

**Validações:**
- Máximo 50 SKUs por busca
- Item deve ter compatibilidades
- SKUs devem ter resultados

**Tab Visibility:**
- `Tab visible if:` admin OR can_run_compat

---

### Admin

**Arquivo:** `src/pages/Admin.tsx`

**Propósito:** Gerenciamento de contas do Mercado Livre.

**Props:**
```typescript
interface Props {
  sellers: Seller[];
  loadSellers: () => Promise<void>;
  disconnectSeller: (slug: string) => Promise<void>;
  headers: () => Record<string, string>;
}
```

**State:**
- `installing` — OAuth em progresso
- `refreshing` — Atualizando lista
- `disconnecting` — Removendo seller
- `editingSlug` — Seller em edição de nome
- `editName` — Novo nome do seller

**Fluxos:**

#### 1. Conectar Nova Conta
```
Clica "Autorizar conta ML"
  ↓
GET /api/ml/install
  ↓
Redireciona para OAuth do ML
  ↓
Usuário autoriza em ml.mercadolibre.com
  ↓
Callback retorna para /api/ml/callback
  ↓
Token salvo em copy_sellers table
  ↓
Redireciona de volta para admin
```

#### 2. Renomear Seller
```
Clica ícone de edição (✏) no seller
  ↓
Campo de input aparece inline
  ↓
Digita novo nome
  ↓
PUT /api/sellers/{slug}/name { name }
  ↓
List recarrega via loadSellers()
```

#### 3. Desconectar Seller
```
Clica "Desconectar"
  ↓
Confirm dialog: "Desconectar seller?"
  ↓
DELETE /api/sellers/{slug}
  ↓
List recarrega
```

**Indicadores:**
- Green dot — Token válido
- Red dot — Token expirado/inválido
- Token expiry mostrado

---

### UsersPage

**Arquivo:** `src/pages/UsersPage.tsx`

**Propósito:** CRUD de usuários e permissões por seller.

**Props:**
```typescript
interface Props {
  headers: () => Record<string, string>;
  currentUserId: string;  // Para evitar auto-deletar
}
```

**State Principal:**
- `users` — Lista de UserRow[]
- `showCreate` — Form de novo usuário
- `editingId` — ID do usuário em edição
- `permissionsId` — ID do usuário com painel de perms aberto
- `permissions` — PermissionRow[] (can_copy_from, can_copy_to por seller)

**Fluxos:**

#### 1. Criar Usuário
```
Clica "Novo Usuário"
  ↓
Form aparece
  ↓
Preenche: username, password (min 4), role, can_run_compat
  ↓
POST /api/admin/users { username, password, role, can_run_compat }
  ↓
List recarrega
```

#### 2. Editar Usuário
```
Clica "Editar" na linha
  ↓
Inline form aparece abaixo
  ↓
Pode mudar: password (optional), role, can_run_compat, active
  ↓
PUT /api/admin/users/{id} { password?, role, can_run_compat, active }
```

#### 3. Gerenciar Permissões
```
Clica "Permissões"
  ↓
GET /api/admin/users/{id}/permissions
  ↓
Exibe grid: seller_name | can_copy_from ☑ | can_copy_to ☑
  ↓
Usuário marca/desmarca checkboxes
  ↓
PUT /api/admin/users/{id}/permissions { permissions: [...] }
  ↓
Note: Admins têm acesso total (sem controle por seller)
```

#### 4. Deletar Usuário
```
Clica "Deletar" (desabilitado para current user)
  ↓
Confirm: "Tem certeza que deseja deletar {username}?"
  ↓
DELETE /api/admin/users/{id}
```

**Indicadores:**
- Badge "Admin" vs "Operador" em cor diferente
- Badge "Compat" se `can_run_compat`
- Badge "Inativo" se `!active`
- Último login formatado em pt-BR

---

### BillingPage

**Arquivo:** `src/pages/BillingPage.tsx`

**Propósito:** Gerenciamento de assinatura Stripe.

**Props:**
```typescript
interface Props {
  headers: () => Record<string, string>;
}
```

**State:**
- `status` — BillingStatus (payment_active, stripe_subscription_id)
- `loading`, `actionLoading`, `error`
- `billingAvailable` — Se retornou 503 (billing desabilitado)

**Fluxos:**

#### 1. Checkout (sem assinatura)
```
Clica "Ativar assinatura"
  ↓
POST /api/billing/create-checkout
  ↓
Retorna { checkout_url }
  ↓
window.location.href = checkout_url (Stripe Checkout)
  ↓
Após pagamento bem-sucedido → redireciona com ?billing=success
  ↓
App.tsx detecta param e faz polling até payment_active=true
```

#### 2. Portal (com assinatura)
```
Clica "Gerenciar assinatura"
  ↓
POST /api/billing/create-portal
  ↓
Retorna { portal_url }
  ↓
window.location.href = portal_url (Stripe Customer Portal)
  ↓
Usuário pode: mudar cartão, pausar, cancelar
```

**Renderização Condicional:**
- Se `!billingAvailable` → null (oculto)
- Se `loading` → spinner
- Se `payment_active` → botão "Gerenciar assinatura"
- Se `!payment_active` → botão "Ativar assinatura"

---

### SuperAdminPage

**Arquivo:** `src/pages/SuperAdminPage.tsx`

**Propósito:** Dashboard de organizações (super_admin only).

**Props:**
```typescript
interface Props {
  headers: () => Record<string, string>;
}
```

**State:**
- `orgs` — OrgWithStats[] (id, name, email, active, payment_active, user_count, seller_count, copy_count, compat_count, created_at)
- `loading`, `toggling` — Estados

**Fluxos:**

#### 1. Listar Organizações
```
GET /api/super/orgs
  ↓
Exibe tabela com colunas:
  - Empresa
  - Email
  - Status (Ativo/Inativo badge)
  - Pagamento (Ativo/Inativo badge)
  - Usuários (count)
  - Sellers (count)
  - Cópias (count últimos 30d)
  - Compats (count últimos 30d)
  - Criado em
  - Ação (botão toggle)
```

#### 2. Toggle Org Status
```
Clica "Desativar" ou "Ativar"
  ↓
PUT /api/super/orgs/{org_id} { active: !currentActive }
  ↓
Tabela recarrega in-place
```

**Visibilidade:**
- Apenas para usuários com `is_super_admin = true`

---

## Componentes

### CopyForm

**Arquivo:** `src/components/CopyForm.tsx`

**Propósito:** Formulário de entrada para cópia de anúncios.

**Props:**
```typescript
interface Props {
  sourceSellers: Seller[];
  destSellers: Seller[];
  headers: () => Record<string, string>;
  onCopy: (groups: CopyGroup[], destinations: string[]) => Promise<void>;
  onPreview: (items: Array<[string, string]>) => Promise<void>;
  onResolvedChange?: (items: Array<[string, string]>) => void;
  copying: boolean;
}

export interface CopyGroup {
  source: string;        // seller slug
  itemIds: string[];
}
```

**State:**
- `itemIdsText` — Texto colado (pode ter quebras de linha, vírgulas)
- `resolvedSources` — Record<item_id, seller_slug> (detectado automaticamente)
- `unresolvedIds` — IDs que não foram encontrados
- `destinations` — Array de slugs de destino selecionados
- `confirming` — Se exibindo barra de confirmação
- `resolving`, `resolveError` — Estado da detecção

**Lógica Principal:**

#### Auto-detecção de Sellers
```typescript
// Quando usuário cola/edita IDs
normalizeItemId("1234567890") → "MLB1234567890"
normalizeItemId("MLB-1234567890") → "MLB1234567890"

// POST /api/copy/resolve-sellers { item_ids: [...] }
// Retorna: { results: [...], errors: [...] }
// Filtra por permissão: só inclui se sourceSellers tem o slug
```

#### Seleção de Destinos
```
validDests = destSellers filtrado por:
  1. token_valid = true
  2. slug NOT IN sourceSlugs (não copia para a mesma origem)

Usuário pode:
  - Clicar em cada chip de seller para toggle
  - Clique em "Selecionar todos" para toggle todos
```

#### Fluxo de Confirmação
```
Clica "Copiar"
  ↓ (primeira vez)
  showing confirmation bar
  ↓ (segunda vez, após "Confirmar")
  onCopy() é chamado
```

**Saídas Importantes:**
- Normalização de IDs (auto-formatação)
- Deduplicação de IDs
- Validação de permissões antes de enviar
- Agrupamento por source seller

---

### CopyProgress

**Arquivo:** `src/components/CopyProgress.tsx`

**Propósito:** Exibição de resultados de cópia e forms de dimensões.

**Props:**
```typescript
interface Props {
  results: CopyResponse;
  sourceMap?: Record<string, string>;  // item_id → seller_slug
  headers: () => Record<string, string>;
  onDimensionRetry?: (updated: CopyResponse) => void;
}
```

**Estrutura de Resultado:**
```typescript
CopyResponse {
  total: number;
  success: number;
  errors: number;
  needs_dimensions?: number;
  results: CopyResult[];  // Array de operações
}

CopyResult {
  source_item_id: string;
  dest_seller: string;
  status: 'success' | 'error' | 'needs_dimensions';
  dest_item_id: string | null;
  error: string | null;
  sku?: string | null;
}
```

**Fluxo:**

1. **Summary Stats** — Total/Sucesso/Erros em cards coloridos
2. **Dimension Groups** — Agrupa needs_dimensions por SKU
   - Para cada SKU, renderiza DimensionForm
   - Ao submeter, POST /api/copy/with-dimensions
3. **Result Rows** — Lista expandível/colapsável
   - Dot color: verde (success), vermelho (error), laranja (needs_dimensions)
   - Clicável se tem erro (expande mensagem de erro)

---

### DimensionForm

**Arquivo:** `src/components/DimensionForm.tsx`

**Propósito:** Form para entrada de dimensões (altura, largura, comprimento, peso).

**Props:**
```typescript
export interface Dimensions {
  height?: number;    // cm
  width?: number;     // cm
  length?: number;    // cm
  weight?: number;    // g
}

interface Props {
  sku?: string;
  itemIds: string[];
  destinations: string[];
  onSubmit: (dims: Dimensions) => void;
}
```

**Campos:**
- Altura (cm) — número, passo 0.1
- Largura (cm) — número, passo 0.1
- Comprimento (cm) — número, passo 0.1
- Peso (g) — número, passo 1

**Validações:**
- Botão desabilitado se todos os campos vazios
- Mínimo 0 em todos

**Visual:**
- Background laranja/warning (0.06 opacidade)
- Border laranja
- Título em vermelho: "Dimensões necessárias"
- Mostra qual(is) item(ns) e destinos

---

### SellerSelect

**Arquivo:** `src/components/SellerSelect.tsx`

**Propósito:** Dropdown de seleção de sellers (atualmente não está muito em uso).

**Props:**
```typescript
interface Props {
  sellers: Seller[];
  value: string;           // seller.slug
  onChange: (slug: string) => void;
  placeholder?: string;
}
```

**Renderização:**
- Select nativo com arrow SVG customizado
- Opções: seller.name (ou slug) + ML User ID
- Value vazio = placeholder exibido

---

### Toast (Context)

**Arquivo:** `src/components/Toast.tsx`

**Propósito:** Sistema global de notificações.

**Exports:**
```typescript
interface ToastContextValue {
  toast: (message: string, type?: 'success' | 'error') => void;
}

export const useToast = () => { /* ... */ }
export function ToastProvider({ children }: { children: React.ReactNode })
```

**Uso:**
```typescript
const { toast } = useToast();
toast('Operação concluída', 'success');
toast('Erro ao salvar', 'error');
```

**Comportamento:**
- Auto-dismiss após 2.2s
- Fade out animation 200ms antes de remover
- Stackable (múltiplos toasts)
- Fixado no rodapé centro (bottom: 24px, left: 50%)

**Estilos:**
- `toast-success` — Background preto, text branco
- `toast-error` — Background vermelho, text branco

---

### Card (Componente Auxiliar)

**Arquivo:** `src/pages/CopyPage.tsx` (inline)

**Propósito:** Container genérico com title opcional, collapsible.

**Props:**
```typescript
interface Props {
  title: string;
  action?: React.ReactNode;        // React node (geralmente button)
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}
```

**Renderização:**
- Background surface
- Border radius 8px
- Padding space-5 (20px)
- Title opcional com seta rotativa se collapsible
- Action opcional (botão/elemento à direita)

---

## Hooks Customizados

### useAuth

**Arquivo:** `src/hooks/useAuth.ts`

**Propósito:** Gerenciar autenticação, tokens, users e sellers.

**Return Type:**
```typescript
{
  isAuthenticated: boolean;
  token: string | null;
  user: AuthUser | null;
  sellers: Seller[];
  loadingSellers: boolean;

  login: (email, password) => Promise<boolean>;
  signup: (email, password, companyName) => Promise<{success, error?}>;
  logout: () => void;
  loadSellers: () => Promise<void>;
  disconnectSeller: (slug: string) => Promise<void>;
  headers: () => Record<string, string>;  // { 'X-Auth-Token': token, 'Content-Type': 'application/json' }
}
```

**Lógica de Autenticação:**

#### Login
```typescript
const login = async (email, password) => {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  // Retorna { token: '...' }
  // Salva em localStorage[TOKEN_KEY]
  // Chama fetchMe(token) para popular user
  return !!token;
}
```

#### Signup
```typescript
const signup = async (email, password, companyName) => {
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password, company_name: companyName })
  });
  // Mesmo fluxo do login
  return { success: true } ou { success: false, error: 'mensagem' }
}
```

#### Logout
```typescript
const logout = () => {
  // POST /api/auth/logout (fire-and-forget)
  clearAuth()  // Remove token, user, sellers
}
```

#### Fetch User
```typescript
const fetchMe = async (token) => {
  const res = await fetch('/api/auth/me', {
    headers: { 'X-Auth-Token': token }
  });
  // Retorna AuthUser
  // Se 401 → clearAuth()
}
```

#### Load Sellers
```typescript
const loadSellers = async () => {
  const res = await fetch('/api/sellers', { headers: headers() });
  // Retorna Seller[]
  // Chamado ao fazer login ou ao focar aba (visibility change)
}
```

**Token Management:**

```typescript
const TOKEN_KEY = 'copy-auth-token';

// Carregamento inicial (do localStorage)
const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));

// Salvar novo token
localStorage.setItem(TOKEN_KEY, newToken);

// Limpar token
localStorage.removeItem(TOKEN_KEY);
```

**Efeitos Colaterais:**

```typescript
// 1. Ao montar, se tem token mas sem user
useEffect(() => {
  if (token && !user) fetchMe(token);
}, []);

// 2. Quando user está disponível, carrega sellers
useEffect(() => {
  if (token && user) loadSellers();
}, [token, user, loadSellers]);

// 3. Refresh sellers ao focar aba (visibilitychange)
useEffect(() => {
  document.addEventListener('visibilitychange', () => {
    if (visible && token && user) loadSellers();
  });
}, [token, user, loadSellers]);
```

**Tipos Associados:**

```typescript
export interface UserPermission {
  seller_slug: string;
  can_copy_from: boolean;
  can_copy_to: boolean;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'operator';
  org_id: string;
  org_name: string;
  is_super_admin: boolean;
  can_run_compat: boolean;
  permissions: UserPermission[];
}
```

---

## Design System

### CSS Variables (src/index.css)

#### Primitives (Light Mode)
```css
--ink: #1a1a1a;              /* Texto principal */
--ink-muted: #6b6b6b;        /* Texto secundário */
--ink-faint: #9a9a9a;        /* Texto terciário */
--paper: #ffffff;            /* Background principal */
--paper-subtle: #fafafa;     /* Background hover */
--line: rgba(0, 0, 0, 0.06); /* Bordas */
```

#### Primitives (Dark Mode)
```css
@media (prefers-color-scheme: dark) {
  --ink: #f2f2f2;
  --ink-muted: #b3b3b3;
  --ink-faint: #8a8a8a;
  --paper: #0f0f0f;
  --paper-subtle: #141414;
  --line: rgba(255, 255, 255, 0.08);
  --surface: #161616;
}
```

#### Semantic Colors
```css
--positive: #23D8D3;         /* Ações positivas, links */
--positive-bg: rgba(..., 0.08);
--attention: #d97706;        /* Avisos */
--attention-bg: rgba(..., 0.08);
```

#### Status Colors
```css
--success: #10b981;          /* Verde — operação bem-sucedida */
--danger: #ef4444;           /* Vermelho — erro/perigo */
--warning: #f59e0b;          /* Laranja — atenção/aviso */
--surface: #f5f5f5;          /* Cards, boxes (mais claro que paper) */
```

#### Spacing (4px base)
```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
--space-12: 48px;
```

#### Typography
```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'SF Mono', 'Fira Code', monospace;

--text-xs: 11px;
--text-sm: 13px;
--text-base: 15px;
--text-lg: 17px;
--text-xl: 20px;
--text-2xl: 28px;

--leading-tight: 1.2;
--leading-normal: 1.5;
--tracking-tight: -0.02em;
```

### Button Classes

#### `.btn-primary`
- Background: `var(--ink)` (preto)
- Color: `var(--paper)` (branco)
- Hover: opacity 0.85 + box-shadow
- Active: scale 0.97
- Disabled: opacity 0.3

#### `.btn-ghost`
- Background: `var(--paper)`
- Color: `var(--ink-muted)`
- Border: 1px solid `var(--line)`
- Hover: border mais escuro, text mais escuro, bg mais escuro
- Active: scale 0.97

#### `.btn-danger-ghost`
- Background: transparent
- Color: `var(--danger)` (vermelho)
- Border: 1px solid `var(--danger)`
- Hover: background rgba(danger, 0.06)

### Input Classes

#### `.input-base`
- Padding: space-3/space-4
- Border: 1px solid `var(--line)`
- Border radius: 6px
- Hover: border mais escuro
- Focus: border mais escuro + box-shadow 3px rgba(ink, 0.06)

#### `.select-with-arrow`
- Arrow SVG customizado à direita
- Padding-right: 36px (espaço para arrow)

### Animations

```css
@keyframes spin          /* Spinner rotation */
@keyframes fadeIn        /* opacity + translateY (8px) */
@keyframes slideUp       /* opacity + translateY (12px) */
@keyframes toastIn       /* opacity + translateY (16px) + scale (0.95) */
@keyframes toastOut      /* inverso de toastIn */
@keyframes pulse-badge   /* opacity pulsing (1 → 0.6 → 1) */
@keyframes pulse-dot     /* scale pulsing (1 → 1.4 → 1) */

.animate-in              /* fadeIn 0.25s ease-out */
.animate-slide-up        /* slideUp 0.3s ease-out */
.spinner                 /* spin 0.6s linear infinite */
```

### Component Patterns

#### Card
```css
.card {
  background: var(--surface);
  border-radius: 8px;
  padding: var(--space-5);
  transition: box-shadow 0.2s;
}
.card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
```

#### Toast Container
```css
.toast-container {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
}

.toast {
  animation: toastIn 0.25s ease-out;
}
.toast.toast-out {
  animation: toastOut 0.2s ease-in forwards;
}
```

#### Collapsible
```css
.collapsible-trigger {
  cursor: pointer;
  user-select: none;
}

.collapsible-arrow {
  transition: transform 0.2s;
}
.collapsible-arrow.open {
  transform: rotate(90deg);
}
```

#### Confirmation Bar
```css
.confirm-bar {
  display: flex;
  padding: var(--space-3) var(--space-4);
  background: rgba(239, 68, 68, 0.04);
  border: 1px solid rgba(239, 68, 68, 0.15);
  border-radius: 8px;
}
```

### Responsive Design

#### Mobile-First Breakpoints

LandingPage tem media queries:
- `@media (max-width: 960px)` — Hero flex-direction: column
- `@media (max-width: 640px)` — Adjust font sizes, padding, grid

Todos os componentes usam:
- `flex-wrap: wrap` para layouts flexíveis
- `overflow-x: auto` para tabelas em mobile
- `minWidth: 0` em flex items para evitar overflow

### Dark Mode

Suportado automaticamente via:
```css
@media (prefers-color-scheme: dark) {
  :root { /* override colors */ }
}
```

Nenhuma lógica JS necessária — o navegador detecta preferência.

---

## Autenticação no Frontend

### Fluxo de Token

```
Login (/api/auth/login)
  ↓ Retorna { token: 'xxx...' }
  ↓
localStorage.setItem('copy-auth-token', token)
  ↓
Todas as requisições subsequentes incluem:
  header: 'X-Auth-Token': token
  ↓
Se 401 Unauthorized → clearAuth() → tela de login
```

### Headers Helper

```typescript
const headers = useCallback(() => {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['X-Auth-Token'] = token;
  return h;
}, [token]);

// Uso:
fetch(url, { headers: headers() })
```

### Session Storage

```typescript
localStorage['copy-auth-token']  // Persiste entre reloads

// Limpeza (logout)
localStorage.removeItem('copy-auth-token')
```

### Validação de Token

```
Token válido por 7 dias (servidor envia TTL)
Ao fazer login, novo token gerado
Não há refresh automático (token simples)
Se token expirar → 401 → re-login obrigatório
```

### Role-Based Access

```typescript
// App.tsx determina visibilidade de tabs baseado em user.role
const visibleTabs = useMemo(() => {
  if (!user) return [];
  const tabs = [];

  if (user.role === 'admin' ||
      (user.permissions.some(p => p.can_copy_from) &&
       user.permissions.some(p => p.can_copy_to))) {
    tabs.push('copy');
  }

  if (user.role === 'admin' || user.can_run_compat) {
    tabs.push('compat');
  }

  if (user.role === 'admin') {
    tabs.push('admin');
  }

  if (user.is_super_admin) {
    tabs.push('super');
  }

  return tabs;
}, [user]);
```

### Permission Checks

```typescript
// CopyPage filtra sellers por permissões
const sourceSellers = useMemo(() => {
  if (!user || isAdmin) return sellers;
  const allowed = new Set(
    user.permissions.filter(p => p.can_copy_from).map(p => p.seller_slug)
  );
  return sellers.filter(s => allowed.has(s.slug));
}, [sellers, user, isAdmin]);

const destSellers = useMemo(() => {
  if (!user || isAdmin) return sellers;
  const allowed = new Set(
    user.permissions.filter(p => p.can_copy_to).map(p => p.seller_slug)
  );
  return sellers.filter(s => allowed.has(s.slug));
}, [sellers, user, isAdmin]);
```

---

## Tipos TypeScript

### src/lib/api.ts

#### `API_BASE`
```typescript
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
// Normalmente vazio (proxy via vite.config.ts)
```

#### `Seller`
```typescript
interface Seller {
  slug: string;              // unique identifier
  name: string;              // display name (redifinível)
  ml_user_id: number;        // Mercado Livre user ID
  token_valid: boolean;      // Token OAuth ainda válido?
  token_expires_at: string | null;  // ISO date
  created_at: string;        // ISO date
}
```

#### `CopyResult`
```typescript
interface CopyResult {
  source_item_id: string;
  dest_seller: string;
  status: 'success' | 'error' | 'pending' | 'needs_dimensions';
  dest_item_id: string | null;
  error: string | null;
  sku?: string | null;
}
```

#### `CopyResponse`
```typescript
interface CopyResponse {
  total: number;
  success: number;
  errors: number;
  needs_dimensions?: number;
  results: CopyResult[];
}
```

#### `CopyLog`
```typescript
interface CopyLog {
  id: number;
  user_email: string | null;
  source_seller: string;
  dest_sellers: string[];
  source_item_id: string;
  dest_item_ids: Record<string, string>;  // { seller_slug: item_id }
  status: string;            // 'success' | 'error' | 'partial' | 'in_progress'
  error_details: Record<string, string> | null;  // { seller: error_msg }
  created_at: string;
}
```

#### `ItemPreview`
```typescript
interface ItemPreview {
  id: string;
  title: string;
  price: number;
  currency_id: string;      // 'BRL', etc
  available_quantity: number;
  sold_quantity: number;
  category_id: string;
  listing_type_id: string;
  condition: string;        // 'new', 'used'
  status: string;
  thumbnail: string;        // URL da imagem
  permalink: string;
  pictures_count: number;
  variations_count: number;
  attributes_count: number;
  has_compatibilities: boolean;
  description_length: number;
  channels: string[];
}
```

#### `CompatPreview`
```typescript
interface CompatPreview {
  id: string;
  title: string;
  thumbnail: string;
  has_compatibilities: boolean;
  compat_count: number;
  skus: string[];
}
```

#### `CompatSearchResult`
```typescript
interface CompatSearchResult {
  seller_slug: string;
  seller_name: string;
  item_id: string;
  sku: string;
  title: string;
}
```

#### `CompatCopyResult`
```typescript
interface CompatCopyResult {
  total: number;
  success: number;
  errors: number;
  results: {
    seller_slug: string;
    item_id: string;
    status: 'ok' | 'error';
    error: string | null;
  }[];
}
```

#### `Org`
```typescript
interface Org {
  id: string;
  name: string;
  email: string;
  active: boolean;
  payment_active: boolean;
  created_at: string;
}
```

#### `OrgWithStats` (extends Org)
```typescript
interface OrgWithStats extends Org {
  user_count: number;
  seller_count: number;
  copy_count: number;
  compat_count: number;
}
```

---

## Fluxos Principais

### 1. Onboarding (Novo Usuário)

```
LandingPage
  ↓ "Começar"
  ↓
Signup
  ↓ POST /api/auth/signup { email, password, company_name }
  ↓ (cria org + admin user)
  ↓ Token retornado
  ↓ Auto-login
  ↓
App (autenticado)
  ↓ useAuth carrega user + sellers
  ↓
Onboarding modal exibido (se !localStorage['onboarding-done'])
  ↓ "Entendi"
  ↓ setItem('onboarding-done', 'true')
  ↓
Redirect para Admin tab
```

### 2. Conectar Conta ML

```
Admin page
  ↓ "Autorizar conta ML"
  ↓
GET /api/ml/install
  ↓
Redireciona para: https://auth.mercadolibre.com/...?redirect_uri={BASE_URL}/api/ml/callback
  ↓
Usuário faz login no ML, autoriza app
  ↓
ML redireciona para: /api/ml/callback?code=xxxx
  ↓ (backend troca code por token, salva em copy_sellers)
  ↓
Redireciona de volta para: /admin (referrer)
  ↓
useAuth.loadSellers() recarrega lista
  ↓
Novo seller aparece com green dot (token_valid=true)
```

### 3. Copiar Anúncios

```
CopyPage
  ↓ Usuário cola IDs
  ↓
normalizeItemId() auto-formata
  ↓ onBlur/delay
  ↓
POST /api/copy/resolve-sellers { item_ids: [...] }
  ↓ (backend busca em ML, detecta seller origem)
  ↓
Retorna: { results: [{ item_id, seller_slug }], errors: [...] }
  ↓
Frontend filtra por sourceSellers permissões
  ↓
Exibe: "Origem: seller_x (3 anúncios)"
  ↓
Usuário seleciona destinos
  ↓
Confirma (double-click no botão)
  ↓
POST /api/copy {
  source: 'seller_x',
  destinations: ['seller_y', 'seller_z'],
  item_ids: ['MLB123', 'MLB456', 'MLB789']
}
  ↓
Retorna: CopyResponse com results
  ↓
CopyProgress renderiza
  ↓ Summary: Total/Sucesso/Erros
  ↓ Resultado rows (expandível se erro)
  ↓
Se needs_dimensions → DimensionForm inline
  ↓ Usuário preenche altura, largura, etc
  ↓
POST /api/copy/with-dimensions { ... }
  ↓
Resultado atualizado
  ↓
Simultaneamente, logs começam a carregar via polling
  ↓ setInterval(loadLogs, 5000) enquanto há in_progress
```

### 4. Copiar Compatibilidades

```
CompatPage
  ↓ Usuário digita item ID (origem)
  ↓
GET /api/compat/preview/{itemId}?seller={firstSeller}
  ↓
Exibe: thumbnail, SKUs (copyable), compat_count
  ↓
Usuário digita SKUs (50 máx)
  ↓
"Buscar Anúncios"
  ↓
POST /api/compat/search-sku { skus: [...] }
  ↓
Exibe resultados agrupados por SKU
  ↓
"Copiar Compatibilidades"
  ↓
POST /api/compat/copy {
  source_item_id: 'MLB123',
  targets: [{ seller_slug, item_id }],
  skus: [...]
}
  ↓
Retorna: { total_targets, ... }
  ↓
Backend enfileira job assíncrono
  ↓
Frontend mostra: "Copiando X destino(s) em segundo plano"
  ↓
Polling carrega histórico
  ↓
Linha com status in_progress vira success/error/partial
```

### 5. Gerenciar Usuários (Admin)

```
Admin > Users tab
  ↓
"Novo Usuário"
  ↓ Form aparece
  ↓ username, password (min 4), role, can_run_compat
  ↓
POST /api/admin/users { ... }
  ↓
Lista recarrega
  ↓
Nova linha com "Operador" badge
  ↓
Clica "Permissões"
  ↓
GET /api/admin/users/{id}/permissions
  ↓
Exibe: seller_name | [☑ Origem] [☐ Destino]
  ↓
Usuário marca checkboxes
  ↓
"Salvar"
  ↓
PUT /api/admin/users/{id}/permissions { permissions: [...] }
```

### 6. Assinatura Stripe

```
App.tsx
  ↓ (ao carregar, se autenticado)
  ↓
GET /api/billing/status
  ↓
Retorna: { payment_active, trial_active, trial_copies_used, ... }
  ↓
Se trial_active → exibe banner "X/20 cópias usadas"
  ↓ (com progress bar)
  ↓
Se trial_exhausted e !payment_active → paywall
  ↓
Usuário clica "Começar agora"
  ↓
POST /api/billing/create-checkout
  ↓
Retorna: { checkout_url }
  ↓
Redireciona para Stripe Checkout
  ↓
Paga (test card: 4242 4242 4242 4242, exp: 12/34, CVC: 123)
  ↓
Stripe redireciona com ?billing=success
  ↓
App detecta param
  ↓
Faz polling até payment_active=true (máx 10 tentativas, 2s interval)
  ↓
Paywall desaparece
  ↓
Usuário pode copiar de novo
```

---

## Desenvolvimento e Build

### Scripts

```bash
# Dev server (com Hot Module Reload)
npm run dev
# → Abre http://localhost:5173
# → Proxy /api para http://localhost:8000 (vite.config.ts)

# Build para produção
npm run build
# → Compila TypeScript
# → Bundle com Vite
# → Saída em dist/

# Preview da build
npm run preview
# → Serve dist/ localmente (testing final build)
```

### Environment Variables

Nenhuma variável de ambiente necessária no frontend. O `API_BASE` é vazio por padrão (proxy via Vite dev server).

```typescript
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
```

Em produção (Docker), o backend serve o SPA via FastAPI, então não há CORS.

### Build Output

```
dist/
├── index.html              # SPA root
├── assets/
│   ├── index-XXX.js       # Bundle JavaScript
│   └── index-XXX.css      # Bundle CSS
└── [logo files]           # Assets estáticos
```

Tamanho típico: ~50-60 KB gzipped (sem dependências externas).

---

## Checklist de Manutenção

- [ ] Verificar tipos TypeScript compilam (`tsc -b`)
- [ ] Testar login/signup flow
- [ ] Testar cópia de anúncios com múltiplos sellers
- [ ] Testar compatibilidades (preview + search + copy)
- [ ] Testar gerenciamento de usuários e permissões
- [ ] Testar Stripe checkout (test card)
- [ ] Verificar dark mode (manual ou sistema)
- [ ] Teste responsivo (mobile view)
- [ ] Testar polling de logs (operação em progresso)
- [ ] Validar acessibilidade (tab navigation, focus states)

---

## Referências

- **API Docs:** `/docs/API.md`
- **Backend:** `/app/` (FastAPI)
- **Database:** Supabase PostgreSQL
- **Deployment:** Docker (Easypanel)

---

**Última atualização:** 2026-03-05
**Responsável:** Equipe Frontend
