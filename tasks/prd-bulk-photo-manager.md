# PRD: Gerenciamento de Fotos em Massa

## 1. Introdução/Overview

Sistema para edição e replicação de fotos de anúncios do Mercado Livre em massa. O usuário informa um MLB, visualiza as fotos do anúncio, pode excluir, adicionar (upload ou URL) e reordenar. Depois, informa um SKU e o sistema aplica o conjunto final de fotos a todos os anúncios com o mesmo SKU nos sellers conectados da org — substituindo as fotos existentes (replace total).

Segue o mesmo padrão de fluxo do sistema de compatibilidade: preview → edição → busca por SKU → aplicação em massa.

## 2. Goals

- Permitir edição visual (excluir, adicionar, reordenar) das fotos de um anúncio MLB
- Replicar o conjunto editado de fotos para todos os anúncios com o mesmo SKU
- Reduzir o trabalho manual de atualizar fotos anúncio por anúncio
- Manter o padrão de permissões existente (RBAC por seller)

## 3. User Stories

### US-001: Preview de fotos do anúncio
**Description:** Como usuário, quero informar um MLB e ver todas as fotos do anúncio para saber o estado atual antes de editar.

**Acceptance Criteria:**
- [ ] Campo de input aceita MLB em formatos: `MLB1234567890`, `MLB-1234567890`, `1234567890`
- [ ] Ao submeter, exibe grid com todas as fotos do anúncio (thumbnails clicáveis)
- [ ] Exibe título do anúncio, SKUs detectados e seller de origem
- [ ] Se o seller não for informado, tenta todos os sellers conectados da org (como compat)
- [ ] Exibe mensagem de erro se o item não for encontrado

### US-002: Excluir fotos
**Description:** Como usuário, quero poder remover fotos do conjunto para que elas não sejam replicadas.

**Acceptance Criteria:**
- [ ] Cada foto tem um botão/ícone de excluir (X)
- [ ] Ao clicar, a foto é removida do conjunto visualmente (não chama API ainda)
- [ ] Não permite excluir todas as fotos (mínimo 1 foto obrigatória)
- [ ] Ação reversível antes de aplicar (botão "Restaurar foto" ou undo)

### US-003: Adicionar fotos por upload
**Description:** Como usuário, quero fazer upload de imagens do computador para adicionar ao conjunto de fotos.

**Acceptance Criteria:**
- [ ] Botão "Adicionar foto" abre file picker (aceita JPG, JPEG, PNG — sem WEBP, ML não suporta)
- [ ] Suporta múltiplos arquivos de uma vez
- [ ] Preview da imagem aparece no grid junto com as fotos existentes
- [ ] Limite de tamanho por arquivo (máx 10MB, conforme limite ML)

### US-004: Adicionar fotos por URL
**Description:** Como usuário, quero colar uma URL de imagem para adicionar ao conjunto.

**Acceptance Criteria:**
- [ ] Campo de input para colar URL de imagem
- [ ] Ao confirmar, exibe preview da imagem no grid
- [ ] Valida que a URL termina em extensão de imagem válida ou retorna content-type de imagem
- [ ] Exibe erro se a URL não for acessível ou não for imagem

### US-005: Reordenar fotos
**Description:** Como usuário, quero reordenar as fotos arrastando-as para definir a sequência final.

**Acceptance Criteria:**
- [ ] Fotos no grid são arrastáveis (drag & drop)
- [ ] A primeira foto na sequência será a foto principal do anúncio
- [ ] Indicação visual clara de qual é a foto principal (ex: badge "Principal")
- [ ] A ordem é preservada ao aplicar nos destinos

### US-006: Buscar anúncios por SKU
**Description:** Como usuário, quero informar um SKU e ver todos os anúncios com esse SKU nos sellers conectados para aplicar as fotos.

**Acceptance Criteria:**
- [ ] Campo de input para SKU (preenche automaticamente com SKUs detectados no preview)
- [ ] Busca em todos os sellers conectados da org (respeitando permissões can_copy_to)
- [ ] Exibe lista de resultados: item_id, título, seller, thumbnail atual
- [ ] Permite selecionar/desselecionar anúncios individuais antes de aplicar
- [ ] Exclui automaticamente o anúncio de origem dos resultados

### US-007: Aplicar fotos em massa
**Description:** Como usuário, quero aplicar o conjunto editado de fotos em todos os anúncios selecionados.

**Acceptance Criteria:**
- [ ] Botão "Aplicar fotos" inicia a operação
- [ ] Substituição total: as fotos dos destinos são completamente substituídas pelo conjunto editado
- [ ] Upload de imagens novas (arquivo/URL) é feito via API do ML antes de aplicar
- [ ] Progresso visível: barra ou contador de itens processados
- [ ] Resultado por anúncio: sucesso ou erro com mensagem
- [ ] Fotos novas (upload) são enviadas uma vez e reutilizadas nos destinos via URL

### US-008: Histórico de operações
**Description:** Como usuário, quero ver o histórico de operações de fotos em massa para acompanhar o que foi feito.

**Acceptance Criteria:**
- [ ] Lista de operações anteriores com: data, item de origem, SKU, quantidade de destinos, status
- [ ] Expandir para ver resultado por destino (sucesso/erro)
- [ ] Filtro por status (todos, sucesso, erro, em andamento)
- [ ] Paginação (20 por página)

## 4. Functional Requirements

**Backend:**

- **FR-1:** Endpoint `GET /api/photos/preview/{item_id}` — busca item via ML API, retorna título, fotos (url, secure_url, id, size), SKUs detectados e seller. Tenta múltiplos sellers se necessário (padrão compat).
- **FR-2:** Endpoint `POST /api/photos/apply` — recebe lista de fotos (URLs existentes + URLs novas + uploads), SKU, lista de item_ids destino. Executa como background task.
- **FR-3:** Endpoint `POST /api/photos/search-sku` — reutiliza `search_sku_all_sellers` existente para encontrar anúncios com o SKU nos sellers conectados.
- **FR-4:** Endpoint `GET /api/photos/logs` — histórico de operações, org-scoped, paginado.
- **FR-5:** Para fotos novas (upload), fazer upload para ML via `POST /pictures` (upload endpoint do ML) e obter a URL permanente antes de aplicar nos destinos.
- **FR-6:** Para aplicar fotos, usar `PUT /items/{id}` com campo `pictures` contendo a lista de `{source: url}` na ordem definida.
- **FR-7:** Registrar cada operação em tabela `photo_logs` com campos: user_id, org_id, source_item_id, sku, targets (JSONB), total_targets, success_count, error_count, status.
- **FR-8:** Respeitar permissões RBAC: `require_active_org` + filtrar sellers por `can_copy_to` (admins bypass).
- **FR-9:** Retry com backoff em erros 429 (rate limit) e 5xx (server errors).

**Frontend:**

- **FR-10:** Nova aba "Fotos" no layout principal (ao lado de Copy, Compat, etc.)
- **FR-11:** Fluxo em etapas: (1) Informar MLB → Preview fotos → (2) Editar fotos → (3) Informar SKU → Buscar destinos → (4) Aplicar
- **FR-12:** Grid de fotos com drag & drop para reordenar (usar HTML5 Drag and Drop ou biblioteca leve)
- **FR-13:** Upload de arquivos com preview local (FileReader/URL.createObjectURL)
- **FR-14:** Seção de histórico com polling a cada 5s enquanto há operações em andamento

## 5. Non-Goals (Out of Scope)

- **Edição de imagens** (crop, resize, filtros) — apenas gerenciamento (add/remove/reorder)
- **Shopee** — apenas Mercado Livre nesta versão
- **Variações** — aplica fotos no nível do item, não por variação
- **Agendamento** — operação é imediata, sem scheduling
- **Comparação visual** antes/depois entre origem e destinos
- **Desfazer** operação após aplicar (já foi enviado ao ML)

## 6. Technical Considerations

### ML API — Fotos (da documentação oficial)

**Upload de imagem:**
```
POST https://api.mercadolibre.com/pictures/items/upload
Authorization: Bearer $ACCESS_TOKEN
Content-Type: multipart/form-data
Body: file=@arquivo.jpg
```
Retorna picture_id + variações (F=1920px, O=500px, C=400px, etc.) com `url` e `secure_url`.

**Vincular imagem existente a um item (adicionar):**
```
POST https://api.mercadolibre.com/items/{ITEM_ID}/pictures
Body: {"id": "PICTURE_ID"}
```

**Substituir todas as fotos de um item:**
```
PUT https://api.mercadolibre.com/items/{ITEM_ID}
Body: {
  "pictures": [
    {"id": "PICTURE_ID_EXISTENTE"},     // manter foto existente
    {"source": "https://url-nova.jpg"}  // adicionar foto nova por URL
  ]
}
```
- Para manter fotos existentes: usar `{"id": "picture_id"}`
- Para adicionar novas: usar `{"source": "url"}`
- A ordem do array define a ordem de exibição (primeira = principal)
- Omitir uma foto = removê-la (replace total)

**Para itens com variações:** incluir também `variations[].picture_ids` com os IDs.

**Formatos aceitos:** JPG, JPEG, PNG (sem WEBP)
**Tamanho máximo:** 10MB por imagem
**Resolução:** recomendado 1200x1200px, máximo 1920x1920px, mínimo 500x500px
**Limite por anúncio:** varia por categoria — consultar `max_pictures_per_item` e `max_pictures_per_item_var` da categoria

**Erros comuns:**
- `cause_id: 508` — Picture com status ERROR (precisa reenviar)
- `cause_id: 509` — Imagem abaixo do tamanho mínimo (500px)
- `400 Bad Request` — Rate limit por RPM por app_id
- `301/redirect` — ML não segue redirecionamentos de URL

### Database

- Nova tabela `photo_logs` (similar a `compat_logs`)
- Nova migration `012_photo_logs.sql`

### Reuso de código

- Reutilizar `search_sku_all_sellers` do compat_copier
- Reutilizar `_resolve_item_seller` do compat router
- Reutilizar padrão de `require_active_org` + permissões
- Reutilizar componente `Card` e padrões de UI do CompatPage

### Upload de fotos novas

- Frontend faz upload para o backend (multipart/form-data)
- Backend faz upload para ML via `POST /pictures/items/upload` e obtém picture_id + secure_url
- Nos destinos, usar `{"id": "picture_id"}` para fotos já no ML, ou `{"source": "url"}` para URLs externas
- Upload é feito uma única vez; picture_id é reutilizado em todos os destinos

## 7. Success Metrics

- Usuário consegue editar e replicar fotos de um anúncio para N destinos em < 2 minutos (sem contar tempo de busca ML)
- Taxa de sucesso na aplicação de fotos > 95% (excluindo erros de permissão do ML)
- Zero uploads duplicados (foto nova é enviada ao ML uma única vez)

## 8. Open Questions

- [ ] Qual o limite exato de fotos por anúncio em cada categoria do ML? (Padrão é 12, mas pode variar)
- [ ] Devemos suportar vídeo (ML permite 1 vídeo por anúncio) ou apenas fotos nesta versão?
- [ ] Se um anúncio destino tem mais fotos que o conjunto editado, o replace total é aceitável em todos os cenários?
