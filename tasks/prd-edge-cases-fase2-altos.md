# PRD: Edge Cases Fase 2 — Correções de Severidade Alta

## 1. Introdução

Complemento da Fase 1 (Críticos), esta Fase 2 cobre os **14 itens de severidade ALTA** identificados na auditoria de usabilidade e segurança. Foco em correções de UX no frontend, hardening de auth, e robustez no backend.

**Pré-requisito:** Fase 1 completa (especialmente US-003 e US-006).
**Restrição:** Nenhuma correção deve exigir re-autenticação dos sellers ML já conectados.

---

## 2. Objetivos

- Corrigir bugs de estado no formulário de cópia (source errado, retry travado, race conditions)
- Melhorar feedback ao usuário (preview, destinos, erros)
- Hardening de autenticação (invalidar sessões pós-reset, login cross-tenant)
- Proteger contra token refresh concorrente que desconecta sellers
- Eliminar vazamento de informação no resolve-sellers
- Garantir auditoria completa (user_id em todos os logs)

---

## 3. User Stories

### US-101: DimensionForm com source correto para múltiplas origens

**Descrição:** Como operador, quero que o retry de dimensões use o seller de origem correto quando copiei itens de múltiplos sellers, para que a correção funcione.

**Contexto técnico:** `CopyProgress.tsx:27` usa `(results as any).source || ''` que vem de `groups[0]?.source` (CopyPage.tsx:114). Com múltiplas origens, itens do 2º grupo usam o seller errado.

**Acceptance Criteria:**
- [ ] `CopyPage` passa um mapa `sourceMap: Record<string, string>` (item_id → seller_slug) para `CopyProgress`
- [ ] `CopyProgress.handleDimensionSubmit` busca o source correto por item_id no mapa
- [ ] A request `POST /api/copy/with-dimensions` envia o source correto por item
- [ ] Testar: copiar IDs de SellerA + SellerB, ambos com erro de dimensão → retry de cada um usa seller correto

---

### US-102: Retry de resolução após falha de rede

**Descrição:** Como operador, quero poder re-colar os mesmos IDs após uma falha de rede, sem precisar limpar o textarea primeiro.

**Contexto técnico:** `lastResolvedKey` (CopyForm.tsx:55) é setado ANTES do request. Se falhar, re-colar mesmos IDs não dispara nova resolução pois a key já está registrada.

**Acceptance Criteria:**
- [ ] Mover `lastResolvedKey.current = key` para dentro do bloco de sucesso (após `setResolvedSources`)
- [ ] Em caso de erro, `lastResolvedKey.current` não é atualizado
- [ ] Adicionar botão "Tentar novamente" que aparece quando `resolveError` está setado
- [ ] O botão limpa `lastResolvedKey.current` e chama `resolveAll` novamente
- [ ] Testar: desconectar rede → colar IDs → erro → reconectar → colar mesmos IDs → resolve normalmente

---

### US-103: Eliminar race condition entre paste e blur

**Descrição:** Como operador, quero que colar IDs e pressionar Tab rapidamente não cause resolução duplicada.

**Contexto técnico:** `onPaste` seta `pendingResolve.current = true`, o `useEffect` chama `normalizeAndResolve`. Se o blur dispara antes do effect completar, duas chamadas a `resolveAll` são feitas simultaneamente.

**Acceptance Criteria:**
- [ ] Adicionar `useRef` de debounce em `resolveAll`: se já há uma resolução em andamento (`resolving === true`), ignorar a segunda chamada
- [ ] Alternativa: usar `AbortController` para cancelar a request anterior quando uma nova é disparada
- [ ] O resultado final reflete sempre a última chamada (não a primeira)
- [ ] Testar: colar IDs + Tab imediato → apenas 1 request ao backend

---

### US-104: Preview selecionável para múltiplos items

**Descrição:** Como operador, quero poder fazer preview de qualquer item da lista (não apenas o primeiro), para verificar antes de copiar.

**Contexto técnico:** `firstResolved = Object.entries(resolvedSources)[0]` (CopyForm.tsx:162). Apenas 1 item é previewável.

**Acceptance Criteria:**
- [ ] Substituir botão "Preview" único por um indicador clicável ao lado de cada ID no textarea (ou lista de IDs resolvidos)
- [ ] Alternativa mais simples: dropdown/select ao lado do botão Preview para escolher qual item
- [ ] O preview carrega o item selecionado usando o seller correto (do `resolvedSources`)
- [ ] Se apenas 1 item, comportamento atual é mantido (botão direto)

---

### US-105: "Selecionar todos" desabilitado durante resolução

**Descrição:** Como operador, quero que o botão "Selecionar todos" fique desabilitado enquanto a resolução de sellers está em andamento, para evitar selecionar destinos incorretos.

**Contexto técnico:** Durante `resolving`, `validDests` usa `resolvedSources` desatualizado. "Selecionar todos" pode incluir sellers que serão excluídos após resolução.

**Acceptance Criteria:**
- [ ] Botão "Selecionar todos" desabilitado quando `resolving === true`
- [ ] Chips de destino ficam em estado disabled (visualmente dimmed) durante resolução
- [ ] Após resolução, destinos são recalculados e seleções anteriores que conflitam são removidas
- [ ] Testar: colar IDs → clicar "Selecionar todos" durante spinner → botão não responde

---

### US-106: Deduplicação de IDs no frontend e backend

**Descrição:** Como operador, quero que IDs duplicados colados no textarea sejam automaticamente deduplicados, para evitar cópias e requests desnecessários.

**Contexto técnico:** IDs duplicados geram múltiplas chamadas paralelas ao ML durante resolução e potencialmente cópias duplicadas.

**Acceptance Criteria:**
- [ ] Frontend: `normalizeAndResolve` deduplicar IDs antes de chamar `resolveAll`
- [ ] Frontend: ao normalizar o textarea, remover linhas duplicadas e mostrar contador "X duplicata(s) removida(s)"
- [ ] Backend: `copy_anuncios` aplicar `clean_ids = list(dict.fromkeys(clean_ids))` (copy.py:112)
- [ ] Backend: `resolve_sellers_endpoint` deduplicar IDs antes de processar
- [ ] Testar: colar "MLB123\nMLB123\nMLB456" → textarea mostra 2 IDs, mensagem "1 duplicata removida"

---

### US-107: Lock de token refresh por seller

**Descrição:** Como admin, quero que o sistema use um lock por seller ao fazer token refresh, para evitar que múltiplas chamadas concorrentes invalidem o refresh_token e desconectem o seller.

**Contexto técnico:** `_get_token` (ml_api.py) pode ser chamado em paralelo. Dois refreshes simultâneos: o 2º usa refresh_token já invalidado → seller desconectado permanentemente.

**Restrição:** Não deve exigir re-autenticação de sellers.

**Acceptance Criteria:**
- [ ] Implementar `asyncio.Lock()` por seller_slug em um dict global (cache de locks)
- [ ] `_get_token` adquire o lock antes de verificar/refreshar o token
- [ ] Se o token já foi refreshed por outra coroutine (verificar `ml_token_expires_at` após adquirir o lock), usar o novo token diretamente
- [ ] Lock timeout de 30 segundos para evitar deadlocks
- [ ] Testar: disparar 10 requests paralelos para o mesmo seller com token expirado → apenas 1 refresh, todas usam o novo token

---

### US-108: Filtro de permissão no resolve-sellers

**Descrição:** Como admin, quero que o endpoint `resolve-sellers` só retorne sellers para os quais o operador tem `can_copy_from`, para evitar vazamento de informação sobre posse de anúncios.

**Contexto técnico:** `resolve-sellers` (copy.py:390-408) usa `require_active_org` mas não verifica `can_copy_from`. Operador sem permissão pode descobrir qual seller possui cada item.

**Acceptance Criteria:**
- [ ] Após resolver os sellers, filtrar resultados: só retornar sellers para os quais o usuário tem `can_copy_from`
- [ ] Itens cujo seller o operador não tem permissão vão para a lista de `errors` com "Sem permissão para este seller"
- [ ] Admin continua vendo todos os resultados
- [ ] Nota: o frontend já faz essa filtragem (CopyForm.tsx:81-86), mas o backend deve ser a source of truth

---

### US-109: Correção do retry-dimensions para super_admin

**Descrição:** Como super admin, quero que o retry de dimensões use o org_id do log original (não o meu), para que a operação funcione corretamente.

**Contexto técnico:** `retry-dimensions` (copy.py:241) chama `copy_with_dimensions` com `org_id` do super_admin. O token é buscado com org_id errado → falha. O update do log (copy.py:255) usa org_id errado → log não é atualizado.

**Acceptance Criteria:**
- [ ] Extrair `org_id` do log original: `log_org_id = log["org_id"]`
- [ ] Usar `log_org_id` (não `user["org_id"]`) em `copy_with_dimensions` e no update do log
- [ ] Validar que super_admin tem acesso ao log (já é feito pelo skip de org filter)
- [ ] Testar: super_admin faz retry em log de outra org → dimensões aplicadas, log atualizado

---

### US-110: Passar user_id em copy_with_dimensions

**Descrição:** Como admin, quero que todas as operações de cópia registrem quem as executou, para auditoria completa.

**Contexto técnico:** `copy_with_dimensions` (item_copier.py:1036-1038) não passa `user_id` para `copy_single_item`. Logs ficam sem identificação do executor.

**Acceptance Criteria:**
- [ ] Adicionar parâmetro `user_id` em `copy_with_dimensions` (item_copier.py)
- [ ] Propagar `user_id` para cada chamada de `copy_single_item` dentro de `copy_with_dimensions`
- [ ] Endpoints `/api/copy/with-dimensions` e `/api/copy/retry-dimensions` passam `user["id"]` para `copy_with_dimensions`
- [ ] Verificar que logs em `api_debug_logs` e `copy_logs` incluem `user_id`
- [ ] Testar: copiar com dimensões → log tem user_id preenchido

---

### US-111: Invalidar sessões após reset de password

**Descrição:** Como usuário, quero que todas as minhas sessões sejam invalidadas quando eu resetar minha senha, para que um atacante que tenha roubado meu token perca acesso.

**Contexto técnico:** Reset de password (auth.py:382-388) deleta apenas o token de reset. Sessões ativas permanecem válidas por até 7 dias.

**Acceptance Criteria:**
- [ ] Após atualizar a senha com sucesso, deletar TODAS as sessões do usuário: `db.table("user_sessions").delete().eq("user_id", user_id).execute()`
- [ ] O usuário precisa fazer login novamente após o reset
- [ ] Limpar também tokens de reset antigos do mesmo usuário (deletar todos, não só o usado)
- [ ] Testar: login em 2 dispositivos → reset de senha → ambas sessões invalidadas

---

### US-112: Correção de login cross-tenant por username

**Descrição:** Como admin da plataforma, quero que o login por username seja seguro contra colisões entre orgs, para que nenhum usuário acesse a org errada.

**Contexto técnico:** Login (auth.py:150-153) busca por email e depois por username sem filtrar org_id. Usernames iguais em orgs diferentes → login na org errada.

**Acceptance Criteria:**
- [ ] Query de login por username: adicionar `.eq("active", True)` para filtrar inativos
- [ ] Se busca por username retorna múltiplos resultados: rejeitar login com "Use seu email para fazer login"
- [ ] Alternativa: exigir formato email para login (remover fallback por username)
- [ ] Testar: criar user "joao" em org A e "joao" em org B → login como "joao" → erro "Use seu email"

---

### US-113: Proteção contra org sem admin

**Descrição:** Como admin, quero que o sistema impeça que a organização fique sem nenhum admin ativo, para que sempre haja alguém com controle.

**Contexto técnico:** Admin pode deletar/desativar outro admin sem verificação de "último admin". Org pode ficar sem admin.

**Acceptance Criteria:**
- [ ] Antes de deletar um admin: verificar se há pelo menos 1 outro admin ativo na org
- [ ] Antes de rebaixar admin para operator: mesma verificação
- [ ] Antes de desativar admin (`active: false`): mesma verificação
- [ ] Se seria o último admin: retornar 400 "Não é possível remover o último administrador da organização"
- [ ] Permitir self-delete/rebaixamento apenas se houver outro admin
- [ ] Testar: org com 1 admin → tentar deletar → erro. Org com 2 admins → deletar 1 → ok. Tentar deletar o último → erro

---

### US-114: Limite de SKUs na busca de compatibilidades

**Descrição:** Como admin, quero que a busca de SKUs no módulo de compatibilidades tenha um limite para evitar sobrecarga da API do ML.

**Contexto técnico:** `SearchSkuRequest.skus` (compat.py) aceita lista ilimitada. 1000 SKUs × 10 sellers = 10.000 tasks paralelas.

**Acceptance Criteria:**
- [ ] `SearchSkuRequest.skus`: máximo 50 SKUs por request (validação Pydantic)
- [ ] Retornar 400 "Máximo de 50 SKUs por busca" se exceder
- [ ] Frontend: exibir contador de SKUs e aviso quando próximo do limite
- [ ] Considerar limitar concorrência: `asyncio.Semaphore(10)` para controlar requests paralelas ao ML

---

## 4. Requisitos Funcionais

| ID | Requisito |
|----|-----------|
| FR-101 | DimensionForm deve usar sourceMap por item_id em vez de source único |
| FR-102 | resolveAll deve ser re-tentável após falha de rede (lastResolvedKey só atualiza em sucesso) |
| FR-103 | Apenas uma resolução ativa por vez (debounce ou AbortController) |
| FR-104 | Preview deve ser selecionável quando há múltiplos items |
| FR-105 | "Selecionar todos" desabilitado durante resolução |
| FR-106 | IDs duplicados deduplicados no frontend e backend |
| FR-107 | Token refresh com lock por seller (asyncio.Lock) |
| FR-108 | resolve-sellers filtra por can_copy_from para operators |
| FR-109 | retry-dimensions usa org_id do log original para super_admin |
| FR-110 | copy_with_dimensions propaga user_id para logs |
| FR-111 | Reset de password invalida todas as sessões do usuário |
| FR-112 | Login por username rejeitado quando há colisão cross-org |
| FR-113 | Deletar/rebaixar/desativar admin bloqueado se for o último da org |
| FR-114 | Busca de SKUs limitada a 50 por request |

---

## 5. Não-Objetivos (Fora de Escopo)

- Migração para cookies HttpOnly (escopo separado)
- Rate limiting via Redis (coberto na Fase 1 com in-memory)
- Cleanup automático de sessões expiradas (nice-to-have futuro)
- Política de senha complexa (nice-to-have futuro)
- Revogação de tokens ML na API ao desconectar seller
- Re-autenticação de sellers ML já conectados
- Correções de severidade MÉDIA ou BAIXA

---

## 6. Considerações Técnicas

### Dependências da Fase 1:
- US-106 (deduplicação backend) depende de US-003 (Fase 1) estar implementada
- US-108 (filtro resolve-sellers) reutiliza `_check_seller_permission` refatorada em US-008 (Fase 1)

### Mudanças de schema:
- Nenhuma migration nova obrigatória nesta fase
- `can_edit_source` foi coberta na Fase 1 US-004

### Impacto em infraestrutura:
- US-107 (lock de token): requer dict global no processo. Com Uvicorn + 1 worker (Docker), funciona. Com múltiplos workers, cada um tem seu lock (aceitável — o pior caso é 1 refresh extra por worker, não desconexão).

### Ordem de implementação sugerida:
1. US-110 (user_id) + US-109 (super_admin org_id) — fixes simples de parâmetros
2. US-106 (deduplicação) — simples no frontend e backend
3. US-102 (retry rede) + US-103 (race paste/blur) — fixes de estado no CopyForm
4. US-111 (invalidar sessões) + US-112 (login cross-tenant) + US-113 (último admin) — auth hardening
5. US-107 (lock de token) — requer cuidado com concorrência
6. US-108 (filtro resolve-sellers) — depende de Fase 1
7. US-101 (DimensionForm source) — requer refactor de props
8. US-104 (preview selecionável) + US-105 (selecionar todos disabled) — UX improvements
9. US-114 (limite SKUs) — simples

---

## 7. Métricas de Sucesso

- Zero operações com user_id nulo nos logs (US-110)
- Super admin consegue fazer retry em logs de qualquer org (US-109)
- Token refresh concorrente: zero sellers desconectados por race condition (US-107)
- Login cross-tenant: zero logins na org errada (US-112)
- Sessões invalidadas em 100% dos resets de password (US-111)
- Deduplicação: zero requests redundantes ao ML por IDs duplicados (US-106)

---

## 8. Questões em Aberto

1. **US-104:** Dropdown de preview ou indicador inline ao lado de cada ID? Qual UX preferida?
2. **US-107:** O lock global por seller sobrevive a hot-reload do Uvicorn em desenvolvimento? (Provavelmente sim, mas verificar)
3. **US-112:** Remover login por username completamente (exigir email) ou só bloquear colisões? Login por username é feature usada?
4. **US-113:** Admin pode se auto-deletar se for o último? Ou sempre bloquear?
