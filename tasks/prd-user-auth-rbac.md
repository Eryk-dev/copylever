# PRD: Sistema de Login com Controle de Acesso por Usuário

## 1. Introdução / Overview

Atualmente o app COPY ANUNCIOS utiliza uma senha única compartilhada entre todos os operadores, sem distinção de quem está logado ou quais ações cada pessoa pode executar. Isso impede rastrear quem fez o quê e impede limitar o que cada operador pode fazer.

Esta feature substitui o sistema de senha única por um sistema de **login com usuário e senha** com **controle de acesso granular (RBAC)**, onde um admin define, por usuário:

- De quais sellers pode copiar (origem)
- Para quais sellers pode copiar (destino)
- Se pode ou não rodar compatibilidade

Inclui também um **painel admin** para gerenciar usuários e permissões de forma simples, e **auditoria** de todas as operações por usuário.

---

## 2. Goals

- Cada operador tem seu próprio login (username + senha)
- Admin controla permissões granulares por operador via UI simples (checkboxes/toggles)
- UI filtra automaticamente o que cada operador vê (sellers, abas) conforme suas permissões
- Todas as operações (copy, compat, login) ficam registradas com identificação do operador
- Setup inicial do primeiro admin via senha master no `.env`
- Zero fricção: o operador só vê o que pode usar, sem mensagens de "acesso negado" desnecessárias

---

## 3. User Stories

### US-001: Login com usuário e senha
**Descrição:** Como operador, quero fazer login com meu usuário e senha para acessar o sistema de forma individual.

**Acceptance Criteria:**
- [ ] Tela de login exibe campos "Usuário" e "Senha" + botão "Entrar"
- [ ] Login válido redireciona para a página principal
- [ ] Login inválido mostra erro inline (shake + mensagem) sem recarregar página
- [ ] Token de sessão armazenado no localStorage com TTL de 7 dias
- [ ] Sessão expirada redireciona para login automaticamente

---

### US-002: Criação do primeiro admin via senha master
**Descrição:** Como dono do sistema, quero usar uma senha master definida no `.env` para promover meu primeiro usuário a admin sem depender de scripts manuais.

**Acceptance Criteria:**
- [ ] Variável `ADMIN_MASTER_PASSWORD` no `.env`
- [ ] Na tela de login, botão/link discreto "Acesso Admin" que abre campo para senha master
- [ ] Ao informar a senha master correta, o sistema cria (ou promove) o usuário como admin
- [ ] Se já existe pelo menos um admin, a senha master ainda funciona como fallback de emergência
- [ ] Senha master nunca é exposta na UI ou em responses da API

---

### US-003: Painel admin — CRUD de usuários
**Descrição:** Como admin, quero criar, editar e deletar operadores em uma tela simples dentro do app.

**Acceptance Criteria:**
- [ ] Aba "Usuários" visível apenas para admins, dentro da seção Admin
- [ ] Lista de usuários mostrando: username, role (admin/operador), status (ativo/inativo), último login
- [ ] Botão "Novo Usuário" abre formulário inline ou modal com campos: username, senha, role
- [ ] Botão de editar por usuário permite alterar: senha, role, ativo/inativo
- [ ] Botão de deletar com confirmação ("Tem certeza?")
- [ ] Admin não pode deletar a si mesmo
- [ ] Validação: username único, senha mínimo 4 caracteres

---

### US-004: Painel admin — Permissões por usuário
**Descrição:** Como admin, quero definir para cada operador: de quais sellers pode copiar, para quais sellers pode copiar, e se pode rodar compatibilidade.

**Acceptance Criteria:**
- [ ] Ao clicar em "Permissões" de um usuário, abre painel com 3 seções:
  1. **Sellers de Origem** — lista de todos os sellers conectados com checkboxes (toggle on/off)
  2. **Sellers de Destino** — mesma lista com checkboxes independentes
  3. **Compatibilidade** — toggle único "Pode rodar compatibilidade" (sim/não)
- [ ] Alterações são salvas com botão "Salvar" e feedback visual (toast de sucesso)
- [ ] Admin tem todas as permissões por padrão (não editável)
- [ ] Novo seller conectado NÃO aparece automaticamente nas permissões de operadores existentes (precisa ser habilitado manualmente)

---

### US-005: UI filtra sellers conforme permissões do operador
**Descrição:** Como operador, quero ver apenas os sellers que tenho permissão de usar, sem poluição visual.

**Acceptance Criteria:**
- [ ] Na CopyPage, dropdown de seller de origem mostra apenas sellers com permissão de origem
- [ ] Na CopyPage, dropdown de seller de destino mostra apenas sellers com permissão de destino
- [ ] Na CompatPage, busca de SKU executa apenas nos sellers que o operador tem permissão de destino
- [ ] Se operador não tem permissão de compat, a aba "Compatibilidade" fica oculta na navegação
- [ ] Se operador não tem nenhum seller de origem OU destino, a aba "Copiar" fica oculta
- [ ] Backend valida permissões em cada request (não confiar apenas na UI)

---

### US-006: Aba Admin visível apenas para admins
**Descrição:** Como admin, quero que a aba Admin (sellers + usuários) seja visível apenas para mim.

**Acceptance Criteria:**
- [ ] Operadores comuns não veem a aba "Admin" na navegação
- [ ] Operadores comuns que tentarem acessar rotas admin via URL recebem 403
- [ ] Backend valida role admin em todas as rotas de gerenciamento

---

### US-007: Auditoria por usuário
**Descrição:** Como admin, quero saber quem executou cada operação para ter rastreabilidade.

**Acceptance Criteria:**
- [ ] Tabela `copy_logs` inclui campo `user_id` preenchido automaticamente
- [ ] Tabela `compat_logs` inclui campo `user_id` preenchido automaticamente
- [ ] Nova tabela `auth_logs` registra: user_id, action (login/logout/login_failed), ip (opcional), timestamp
- [ ] Na aba de logs (CopyPage e CompatPage), coluna "Operador" exibe o username
- [ ] Admin vê logs de todos os operadores; operador vê apenas seus próprios logs

---

### US-008: Logout
**Descrição:** Como operador, quero fazer logout para encerrar minha sessão.

**Acceptance Criteria:**
- [ ] Botão de logout visível no header/navbar
- [ ] Exibe o username do operador logado ao lado do botão de logout
- [ ] Ao clicar, limpa token do localStorage e redireciona para login
- [ ] Sessão é invalidada no backend

---

## 4. Functional Requirements

### Autenticação
- **FR-01:** O sistema deve suportar login com username (string única) e senha (hash bcrypt).
- **FR-02:** Sessões devem usar tokens opacos (UUID) armazenados no Supabase com TTL de 7 dias.
- **FR-03:** Toda request autenticada deve enviar o token via header `X-Auth-Token`.
- **FR-04:** O backend deve expor `GET /api/auth/me` retornando: user_id, username, role, permissões.

### Usuários
- **FR-05:** O sistema deve armazenar usuários em uma tabela `users` com campos: id, username, password_hash, role (admin/operator), active, created_at, last_login_at.
- **FR-06:** O sistema deve armazenar sessões em uma tabela `user_sessions` com campos: id, user_id, token, created_at, expires_at.
- **FR-07:** CRUD de usuários acessível apenas por admins via `POST/PUT/DELETE /api/admin/users`.

### Permissões
- **FR-08:** O sistema deve armazenar permissões em uma tabela `user_permissions` com campos: user_id, seller_slug, can_copy_from (bool), can_copy_to (bool).
- **FR-09:** O sistema deve armazenar permissão de compat em `users.can_run_compat` (bool, default false).
- **FR-10:** Endpoint `GET /api/auth/me` deve retornar as permissões completas do usuário para que o frontend filtre a UI.
- **FR-11:** Os endpoints `POST /api/copy`, `POST /api/compat/copy` e `POST /api/compat/search-sku` devem validar permissões server-side antes de executar.

### Admin Master
- **FR-12:** Variável de ambiente `ADMIN_MASTER_PASSWORD` permite promover qualquer usuário a admin.
- **FR-13:** Endpoint `POST /api/auth/admin-promote` aceita username, senha do usuário, e master_password. Se a master_password for válida, cria o usuário (se não existir) ou promove a admin.

### Auditoria
- **FR-14:** Toda operação de copy e compat deve registrar o `user_id` do operador.
- **FR-15:** Logins (sucesso e falha) e logouts devem ser registrados em `auth_logs`.

---

## 5. Non-Goals (Fora do Escopo)

- **Registro público / self-signup** — apenas admin cria usuários
- **Recuperação de senha / "esqueci minha senha"** — admin reseta manualmente
- **MFA / autenticação de dois fatores**
- **OAuth / login social** (Google, etc.)
- **Sistema de roles além de admin/operator** — apenas 2 níveis
- **Permissões por item ou por categoria** — escopo é por seller
- **Approval workflow** — operador executa direto, sem aprovação
- **Rate limiting por usuário**
- **API keys / acesso programático**

---

## 6. Technical Considerations

### Banco de Dados (Supabase)
Novas tabelas necessárias:
```sql
-- Tabela de usuários
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
    can_run_compat BOOLEAN NOT NULL DEFAULT false,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

-- Sessões de usuário
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Permissões por seller
CREATE TABLE user_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    seller_slug TEXT NOT NULL,
    can_copy_from BOOLEAN NOT NULL DEFAULT false,
    can_copy_to BOOLEAN NOT NULL DEFAULT false,
    UNIQUE(user_id, seller_slug)
);

-- Logs de autenticação
CREATE TABLE auth_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    username TEXT,
    action TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);
```

### Migração
- A tabela `admin_config` existente pode ser mantida ou removida após migração
- Migrar a senha atual do `admin_config` para o primeiro usuário admin, se desejado
- Adicionar coluna `user_id` nas tabelas `copy_logs` e `compat_logs`

### Backend
- Novo dependency `require_user()` que retorna o user completo com permissões
- Dependency `require_admin()` que checa `user.role == 'admin'`
- Helper `get_user_permissions(user_id)` para obter sellers permitidos
- Filtrar sellers nos endpoints de copy/compat baseado nas permissões

### Frontend
- Hook `useAuth` deve ser atualizado para armazenar user completo (id, username, role, permissions)
- `GET /api/auth/me` retorna tudo que o frontend precisa para filtrar a UI
- Nova aba "Usuários" na seção Admin
- Componente de permissões reutilizável (lista de sellers com checkboxes)

---

## 7. Success Metrics

- **100% das operações logadas com user_id** — nenhuma operação anônima após a migração
- **Admin consegue criar um novo operador e definir permissões em < 2 minutos**
- **Operador faz login e vê apenas o que pode usar, sem confusão**
- **Zero regressão** nas funcionalidades existentes de copy e compat
- **Backend rejeita 100% das tentativas de ações sem permissão** (validação server-side)

---

## 8. Open Questions

1. **Migração do admin atual:** Criar automaticamente um usuário admin com a senha existente do `admin_config`, ou exigir setup limpo?
2. **Sessões simultâneas:** Um usuário pode ter múltiplas sessões ativas (ex: PC + celular), ou apenas uma por vez?
3. **Expiração de inatividade:** Além do TTL de 7 dias, encerrar sessão após X horas de inatividade?
4. **Logs antigos:** Associar logs existentes (sem user_id) a algum usuário, ou manter como "legado"?
