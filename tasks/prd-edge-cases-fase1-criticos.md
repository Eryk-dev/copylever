# PRD: Edge Cases Fase 1 — Correções Críticas

## 1. Introdução

Auditoria completa de usabilidade e segurança identificou 22 edge cases de severidade CRÍTICA e ALTA no sistema Copy Anuncios ML. Esta Fase 1 cobre os **8 itens CRÍTICOS** que podem causar duplicação de anúncios no ML, bypass de permissões, ou comprometimento de contas.

**Restrição:** Nenhuma correção deve exigir re-autenticação dos sellers ML já conectados.

---

## 2. Objetivos

- Eliminar possibilidade de duplicação de anúncios por double-submit ou race condition
- Impor limites de input para prevenir DoS e abuso de API
- Corrigir bypass de permissões na cópia e compatibilidade
- Proteger fluxo OAuth contra CSRF
- Implementar rate limiting nos endpoints de autenticação
- Corrigir escalação de privilégios cross-tenant no admin-promote

---

## 3. User Stories

### US-001: Proteção contra double-submit no formulário de cópia

**Descrição:** Como operador, quero que o sistema impeça submissões duplicadas acidentais para que eu não crie anúncios duplicados no Mercado Livre.

**Contexto técnico:** Entre `setConfirming(false)` (CopyForm.tsx:138) e `setCopying(true)` (CopyPage.tsx:74) há uma janela onde `canCopy` volta a ser `true`, permitindo um segundo clique.

**Acceptance Criteria:**
- [ ] Adicionar `useRef` de guarda (`submittingRef`) em CopyForm.tsx para bloquear re-entrada em `handleSubmit`
- [ ] O botão "Copiar"/"Confirmar" fica visualmente desabilitado imediatamente ao primeiro clique de confirmação
- [ ] Clicar rapidamente duas vezes no botão de confirmação resulta em apenas 1 POST /api/copy
- [ ] O ref é resetado no `finally` do `onCopy`, mesmo em caso de erro
- [ ] Testar manualmente: colar IDs, selecionar destino, clicar "Copiar", clicar "Confirmar" duas vezes rápido → apenas 1 cópia

---

### US-002: Limites de input no backend (item_ids e destinations)

**Descrição:** Como admin da plataforma, quero que o sistema imponha limites no número de items e destinos por request para evitar DoS e esgotamento da API do ML.

**Contexto técnico:** `CopyRequest.item_ids` (copy.py:67) e `destinations` (copy.py:65) aceitam listas ilimitadas. Combinados, podem gerar milhares de chamadas à API do ML.

**Acceptance Criteria:**
- [ ] `CopyRequest.item_ids`: máximo 50 items por request (validação Pydantic + HTTPException 400)
- [ ] `CopyRequest.destinations`: máximo 20 destinos por request
- [ ] `CopyWithDimensionsRequest`: mesma validação de destinations
- [ ] `ResolveSellersRequest.item_ids`: máximo 50 items
- [ ] `SearchSkuRequest.skus` (compat.py): máximo 50 SKUs
- [ ] `CopyCompatRequest.targets` (compat.py): máximo 100 targets
- [ ] Backend retorna mensagem clara em português: "Máximo de X items por requisição"
- [ ] Frontend exibe aviso quando o usuário cola mais de 50 IDs no textarea

---

### US-003: Prevenção de duplicatas por race condition (cópias simultâneas)

**Descrição:** Como admin, quero que o sistema impeça que o mesmo anúncio seja copiado para o mesmo destino simultaneamente, para evitar duplicatas no Mercado Livre.

**Contexto técnico:** Sem mutex/lock. Dois usuários (ou duas abas) copiando o mesmo item para o mesmo destino geram duplicatas. Não há constraint UNIQUE no banco.

**Acceptance Criteria:**
- [ ] Criar migration: adicionar UNIQUE constraint parcial em `copy_logs(source_item_id, dest_sellers, org_id)` WHERE `status = 'in_progress'`
- [ ] Antes de inserir log `in_progress`, verificar se já existe um `in_progress` para o mesmo `(source_item_id, org_id)` com destinos sobrepostos
- [ ] Se já existe cópia in_progress, retornar erro 409 Conflict: "Este item já está sendo copiado"
- [ ] O frontend exibe a mensagem de conflito de forma clara
- [ ] Deduplicar `item_ids` no backend: aplicar `list(dict.fromkeys(clean_ids))` após limpeza (copy.py:112)
- [ ] Testar: abrir 2 abas, colar mesmo ID, copiar simultaneamente → apenas 1 cópia, outra recebe erro 409

---

### US-004: Manter permissão de escrita em copy_with_dimensions (decisão: sem mudança)

**Decisão:** O comportamento atual é aceitável — operadores com `can_copy_from` podem corrigir dimensões. Não será criada permissão extra.

**Contexto:** `copy_with_dimensions` (item_copier.py:1020-1032) faz `update_item` no item de origem. Embora `can_copy_from` seja tecnicamente "leitura", na prática quem pode copiar de um seller precisa poder corrigir dimensões para completar a cópia. Adicionar uma permissão separada criaria atrito desnecessário.

**Acceptance Criteria:**
- [ ] ~~Nenhuma mudança de permissão~~ — REMOVIDO do escopo
- [ ] Documentar no CLAUDE.md que `can_copy_from` implica permissão de leitura E escrita de dimensões no item de origem

---

### US-005: Proteção CSRF no fluxo OAuth do Mercado Livre

**Descrição:** Como admin da plataforma, quero que o fluxo OAuth use um token CSRF seguro em vez do org_id em texto plano, para impedir que terceiros vinculem contas ML maliciosas à minha organização.

**Contexto técnico:** O `state` parameter (auth_ml.py:30) é `org_{org_id}`. O callback é público (sem auth). Atacante com o UUID da org pode iniciar OAuth com `state=org_{uuid_vitima}`.

**Restrição:** Não invalidar conexões ML existentes.

**Acceptance Criteria:**
- [ ] Criar tabela `oauth_states` (migration): `id` (token_urlsafe(32)), `org_id`, `user_id`, `created_at`, `expires_at` (10 min TTL)
- [ ] `/api/ml/install`: gerar token CSRF, salvar em `oauth_states`, usar como `state` no redirect
- [ ] `/api/ml/callback`: validar `state` contra `oauth_states`, extrair `org_id` e `user_id`, deletar o token após uso
- [ ] Se `state` inválido ou expirado: retornar 400 "Link de autorização expirado, tente novamente"
- [ ] Cleanup: deletar tokens com mais de 10 minutos (pode ser lazy, no callback)
- [ ] Sellers já conectados continuam funcionando normalmente (não são afetados)

---

### US-006: Rate limiting nos endpoints de autenticação

**Descrição:** Como admin da plataforma, quero que endpoints de autenticação tenham rate limiting para impedir brute force de senhas e abuso de signup.

**Contexto técnico:** Login, signup, forgot-password, admin-promote: zero rate limiting. Brute force ilimitado.

**Acceptance Criteria:**
- [ ] Implementar rate limiting in-memory (dict com TTL, sem dependência externa)
- [ ] `/api/auth/login`: máximo 10 tentativas por IP por minuto. Após exceder: 429 "Muitas tentativas, aguarde 1 minuto"
- [ ] `/api/auth/signup`: máximo 3 por IP por hora
- [ ] `/api/auth/forgot-password`: máximo 3 por email por hora
- [ ] `/api/auth/admin-promote`: máximo 5 por IP por minuto
- [ ] `/api/auth/reset-password`: máximo 5 por IP por minuto
- [ ] Rate limiter como middleware ou dependency do FastAPI (reutilizável)
- [ ] Logs de rate limit em `auth_logs` com ação `rate_limited`
- [ ] Em produção com múltiplos workers: considerar que cada worker tem seu próprio counter (aceitável para MVP, Redis futuro)

---

### US-007: Correção do admin-promote cross-tenant

**Descrição:** Como super admin, quero que o endpoint admin-promote não permita promover ou criar usuários de outras organizações.

**Contexto técnico:** A query (auth.py:418) busca por username sem filtrar org_id. Com a master password, pode promover user de qualquer org. O novo usuário recebe org_id hardcoded.

**Acceptance Criteria:**
- [ ] Remover capacidade de criar novos usuários via admin-promote (apenas promover existentes)
- [ ] A busca de usuário existente deve incluir filtro por org: exigir `org_id` no request, ou restringir a uma org específica
- [ ] Se mantiver criação: usar org_id de uma org existente e ativa, não hardcoded
- [ ] Alternativa preferida: **deprecar o endpoint** — primeiro admin é criado via `/api/auth/signup`. O endpoint pode ser removido ou protegido com flag `ADMIN_PROMOTE_ENABLED=false` (default)
- [ ] Se mantido: adicionar rate limiting (já coberto por US-006)
- [ ] Documentar a decisão no CLAUDE.md

---

### US-008: Validação de permissão can_copy_to no endpoint de compatibilidade

**Descrição:** Como admin, quero que o endpoint `/api/compat/copy` valide se o operador tem permissão `can_copy_to` para cada seller de destino, para que operadores não possam copiar compatibilidades para sellers não autorizados.

**Contexto técnico:** O endpoint (compat.py:164-203) verifica apenas `can_run_compat`, mas NÃO valida `can_copy_to` por seller de destino nos targets.

**Acceptance Criteria:**
- [ ] Antes de criar o log in_progress, verificar `can_copy_to` para cada `target.seller_slug` usando `_check_seller_permission`
- [ ] Se operador não tem permissão para algum target: retornar 403 com lista dos sellers negados
- [ ] Admin bypassa a verificação (já é o comportamento padrão de `_check_seller_permission`)
- [ ] Mover a função `_check_seller_permission` de copy.py para um módulo compartilhado (ou importar de copy.py)
- [ ] Frontend: filtrar os resultados de search-sku para mostrar apenas sellers com `can_copy_to` (já faz parcialmente, validar)

---

## 4. Requisitos Funcionais

| ID | Requisito |
|----|-----------|
| FR-01 | O sistema deve impedir submissões duplicadas no formulário de cópia usando guard ref |
| FR-02 | O sistema deve limitar item_ids a 50 e destinations a 20 por request |
| FR-03 | O sistema deve limitar SKUs a 50 e targets a 100 no endpoint de compatibilidade |
| FR-04 | O sistema deve rejeitar cópias in_progress duplicadas para o mesmo (item, org) com destinos sobrepostos |
| FR-05 | O sistema deve deduplicar item_ids no backend antes de processar |
| FR-06 | O sistema deve exigir permissão de escrita para modificar dimensões do item de origem |
| FR-07 | O sistema deve usar token CSRF seguro no fluxo OAuth do ML (não org_id em texto plano) |
| FR-08 | O sistema deve impor rate limiting em todos os endpoints de autenticação |
| FR-09 | O sistema deve restringir admin-promote ao escopo de uma organização |
| FR-10 | O sistema deve validar can_copy_to para cada seller de destino na cópia de compatibilidades |

---

## 5. Não-Objetivos (Fora de Escopo)

- Migração de tokens de localStorage para cookies HttpOnly (Fase futura)
- Rate limiting via Redis (in-memory é suficiente para MVP)
- Revogação de tokens ML na API do Mercado Livre ao desconectar seller
- Re-autenticação de sellers ML já conectados
- Correções de UX (preview, polling, mensagens) — cobertas na Fase 2
- Cleanup automático de sessões expiradas
- Política de senha complexa

---

## 6. Considerações Técnicas

### Migrations necessárias:
1. **UNIQUE constraint parcial** em `copy_logs(source_item_id, org_id)` WHERE `status = 'in_progress'` (US-003)
2. **Tabela `oauth_states`** com id, org_id, user_id, created_at, expires_at (US-005)
3. **Coluna `can_edit_source`** em `user_permissions` (US-004, se optar pela solução completa)

### Dependências entre US:
- US-001 (frontend) e US-003 (backend) são complementares — ambas previnem duplicatas
- US-006 (rate limiting) deve ser implementada como módulo reutilizável antes de US-007
- US-008 depende de extrair `_check_seller_permission` para módulo compartilhado

### Ordem de implementação sugerida:
1. US-002 (limites de input) — mais simples, impacto imediato
2. US-001 (double-submit) — simples no frontend
3. US-003 (race condition) — requer migration
4. US-006 (rate limiting) — módulo reutilizável
5. US-007 (admin-promote) — depende de US-006
6. US-008 (compat permissões) — refactor de _check_seller_permission
7. US-005 (OAuth CSRF) — requer migration + mudança de fluxo
8. US-004 (permissão de escrita) — requer migration + UI

---

## 7. Métricas de Sucesso

- Zero duplicatas de anúncios causadas por double-submit ou race condition
- Zero bypass de permissão em cópia e compatibilidade
- Rate limiting ativo: tentativas de brute force bloqueadas após threshold
- Fluxo OAuth protegido contra CSRF: state tokens com TTL de 10 min
- Todos os endpoints de cópia e compat respeitam limites de input

---

## 8. Questões em Aberto

1. **US-004:** Criar nova permissão `can_edit_source` ou simplesmente restringir a admins?
2. **US-007:** Deprecar admin-promote completamente (signup já cria admin) ou manter para casos especiais?
3. **US-003:** A UNIQUE constraint parcial no Supabase/PostgreSQL suporta arrays (dest_sellers)? Pode ser necessário usar abordagem diferente (check no código antes do INSERT).
4. **US-006:** Aceitar que rate limiting in-memory é per-worker (Uvicorn com 1 worker em Docker resolve)?
