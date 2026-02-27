# PRD: Melhorias de UX — Status em Tempo Real, SKU no Preview, Seleção de Seller

## 1. Introdução/Overview

O sistema Copy Anuncios possui lacunas de UX em três áreas:

1. **Histórico sem feedback em tempo real** — Quando o usuário dispara cópias (anúncios ou compatibilidades), não há indicação visual no histórico de que a operação está em andamento. O resultado só aparece após conclusão.
2. **SKU ausente no preview de compatibilidades** — No preview da CompatPage, o SKU do item de origem não é exibido, forçando o usuário a buscar essa informação externamente.
3. **Seleção de seller de origem com UX inconsistente** — Na CopyPage, o seller de origem usa um dropdown simples, enquanto os destinos usam checkboxes visuais. A experiência deveria ser uniforme.

---

## 2. Goals

- Dar visibilidade imediata ao usuário de que uma operação de cópia está em andamento no histórico
- Exibir o SKU no preview da CompatPage e permitir copiar para clipboard com um clique
- Unificar a UX de seleção de sellers na CopyPage, usando checkboxes tanto para origem quanto destino

---

## 3. User Stories

### US-001: Status "em andamento" no histórico de cópia de anúncios
**Description:** Como usuário, quero ver no histórico da CopyPage uma linha com status "em andamento" assim que disparo a cópia, para saber que a operação está sendo processada.

**Acceptance Criteria:**
- [ ] Ao clicar "Confirmar" na cópia, uma entrada aparece imediatamente no histórico com status visual distinto (ex: badge azul/amarelo "Copiando..." ou spinner)
- [ ] A linha mostra: origem, destinos, item IDs, e status "em andamento"
- [ ] Quando a operação conclui (sucesso, erro, parcial), a linha é atualizada automaticamente com o status final
- [ ] Se o usuário recarregar a página durante a operação, a linha "em andamento" persiste (via DB com status `pending`/`in_progress`)
- [ ] Typecheck/lint passa

### US-002: Status "em andamento" no histórico de compatibilidades
**Description:** Como usuário, quero ver no histórico da CompatPage uma linha com status "em andamento" assim que disparo a cópia de compatibilidades, para saber que a operação está sendo processada.

**Acceptance Criteria:**
- [ ] Ao clicar "Copiar Compatibilidades", uma entrada aparece imediatamente no histórico com status visual distinto (badge "Copiando..." ou spinner)
- [ ] A linha mostra: item de origem, SKUs, total de targets, e status "em andamento"
- [ ] Quando a operação conclui, a linha é atualizada automaticamente com o status final (sucesso/erro/parcial) e contagens
- [ ] Se o usuário recarregar a página durante a operação, a linha "em andamento" persiste (via DB com status `in_progress`)
- [ ] Typecheck/lint passa

### US-003: Exibir SKU no preview da CompatPage com botão de copiar
**Description:** Como usuário, quero ver o SKU do item de origem no preview da CompatPage e copiá-lo para o clipboard, para usá-lo diretamente no campo de busca por SKU da clonagem de compatibilidades.

**Acceptance Criteria:**
- [ ] O preview da CompatPage exibe o SKU do item (extraído de `seller_custom_field` ou atributo `SELLER_SKU` das variações)
- [ ] Se o item tiver múltiplas variações com SKUs diferentes, todos os SKUs são listados
- [ ] Há um botão/ícone de "copiar" ao lado do(s) SKU(s) que copia para o clipboard
- [ ] Ao copiar, feedback visual confirma a ação (ex: tooltip "Copiado!" ou ícone muda brevemente)
- [ ] Se o item não tiver SKU, exibir "Sem SKU" em texto cinza
- [ ] Typecheck/lint passa

### US-004: Seleção de seller de origem com checkboxes na CopyPage
**Description:** Como usuário, quero selecionar o seller de origem usando checkboxes (igual à seleção de destinos), mas com a restrição de selecionar apenas um, para ter uma experiência visual consistente.

**Acceptance Criteria:**
- [ ] A seleção de seller de origem na CopyPage usa checkboxes visuais (mesmo estilo dos destinos)
- [ ] Apenas um seller pode ser selecionado como origem por vez
- [ ] Ao selecionar um seller de origem, os demais ficam visualmente desabilitados (cinza, opacidade reduzida)
- [ ] Ao clicar no seller já selecionado, ele é desmarcado e todos voltam a ficar disponíveis
- [ ] O seller selecionado como origem é automaticamente excluído da lista de destinos (comportamento existente mantido)
- [ ] Typecheck/lint passa

---

## 4. Functional Requirements

**Status em tempo real (US-001 e US-002):**

- FR-1: O backend deve criar o registro de log no banco com status `in_progress` **antes** de iniciar a operação de cópia
- FR-2: O backend deve atualizar o registro de log para o status final (`success`, `error`, `partial`) **após** a conclusão da operação
- FR-3: O frontend deve inserir a linha "em andamento" no histórico imediatamente após o disparo (otimistic UI ou via polling)
- FR-4: O frontend deve atualizar automaticamente o status da linha quando a operação conclui (via polling periódico ou resposta da API)
- FR-5: Linhas com status `in_progress` devem ter um indicador visual distinto (spinner, badge colorido, animação)

**SKU no preview (US-003):**

- FR-6: O endpoint `GET /api/compat/preview/{item_id}` deve retornar o campo `skus` — array de SKUs extraídos do item (de `seller_custom_field` e/ou atributo `SELLER_SKU` de cada variação)
- FR-7: O frontend deve exibir os SKUs no card de preview com botão de copiar para clipboard
- FR-8: Se houver múltiplos SKUs (variações), exibir todos separados, cada um com seu botão de copiar

**Seleção de seller de origem (US-004):**

- FR-9: Substituir o dropdown de seleção de origem por checkboxes com o mesmo layout visual dos destinos
- FR-10: Implementar lógica de single-select: ao marcar um, os outros ficam desabilitados visualmente (cinza/opacity)
- FR-11: Ao desmarcar o selecionado, todos voltam ao estado normal (disponíveis)

---

## 5. Non-Goals (Out of Scope)

- Notificações push ou WebSocket para atualização em tempo real (polling é suficiente)
- Retry automático de operações falhadas
- Botão de retry manual para operações com erro
- Alterar a seleção de seller de origem na CompatPage (permanece como está)
- Paginação ou filtros avançados no histórico
- Reordenação de SKUs no preview

---

## 6. Technical Considerations

### Backend

- **copy_logs e compat_logs** precisam suportar status `in_progress` — verificar se o schema já suporta ou se precisa de migration
- O endpoint de cópia (`POST /api/copy`) atualmente só cria o log após a operação. Precisa criar **antes** (com `in_progress`) e atualizar **depois**
- Para compat, o `POST /api/compat/copy` já usa BackgroundTasks — o log `in_progress` deve ser criado antes de enfileirar a task
- O endpoint de preview da compat precisa buscar SKUs das variações do item (chamada adicional ou extrair do item já buscado)

### Frontend

- Polling no histórico: a cada ~5s enquanto houver linhas com `in_progress`, parar quando todas concluírem
- Clipboard API: usar `navigator.clipboard.writeText()` com fallback
- Checkboxes de origem: reutilizar componente existente de destinos com prop `singleSelect`

---

## 7. Success Metrics

- Usuário consegue ver imediatamente no histórico que uma operação está rodando, sem precisar esperar ou recarregar
- Usuário consegue copiar SKU do preview da compat com um clique e colar no campo de busca
- Seleção de seller de origem é visualmente consistente com a seleção de destinos

---

## 8. Open Questions

- Nenhuma questão em aberto no momento.
