# PRD: Refatorar Backend de Cópia de Compatibilidades

## 1. Introduction/Overview

O backend de cópia de compatibilidades entre anúncios do Mercado Livre está usando endpoints incorretos/desatualizados em relação à [documentação oficial](https://developers.mercadolivre.com.br/pt_br/compatibilidades-itens-e-produtos-de-autopecas#Copiar-e-colar-compatibilidades). Os três problemas principais são:

1. **Não distingue POST vs PUT** — quando o item destino já tem compatibilidades, deveria usar `PUT /items/{id}/compatibilities` com wrapper `create`, mas só usa POST (que pode falhar).
2. **Endpoint de User Products errado** — usa `POST /user-products/{id}/compatibilities` enviando produtos em batch manualmente, quando deveria usar `POST /user-products/{id}/compatibilities/copy-paste` que aceita uma referência ao source e o ML copia internamente.
3. **Detecção de User Product reativa** — tenta o endpoint de item, espera falhar, e só então tenta User Product. Deveria detectar previamente via campo `user_product_id` do item.

Esta refatoração corrige o backend para seguir a documentação oficial, sem alterar a arquitetura geral do sistema.

## 2. Goals

- Corrigir `copy_item_compatibilities()` para usar PUT quando o destino já tem compatibilidades
- Substituir o endpoint manual de User Products pelo endpoint `/copy-paste` da documentação
- Detectar previamente se o item destino é User Product antes de tentar copiar
- Adicionar opção no frontend para o usuário escolher entre "adicionar" ou "substituir" compatibilidades
- Manter compatibilidade com o fluxo existente (logs, permissões, background tasks)

## 3. User Stories

### US-001: Cópia correta para itens com compatibilidades existentes
**Description:** Como operador, quero que ao copiar compatibilidades para um item que já tem compats, o sistema adicione (merge) as novas sem remover as existentes, usando o endpoint correto do ML.

**Acceptance Criteria:**
- [ ] Sistema usa `PUT /items/{id}/compatibilities` com body `{"create": {"item_to_copy": {"item_id": "$SOURCE", "extended_information": true}}}` quando o destino já tem compatibilidades
- [ ] Sistema usa `POST /items/{id}/compatibilities` com body `{"item_to_copy": {"item_id": "$SOURCE", "extended_information": true}}` quando o destino NÃO tem compatibilidades
- [ ] Detecção é feita via GET das compatibilidades do destino antes de copiar
- [ ] Logs de debug registram qual método (POST ou PUT) foi usado

### US-002: Cópia correta para User Products
**Description:** Como operador, quero que itens do tipo User Product usem o endpoint `/copy-paste` da documentação ao invés de enviar produtos manualmente em batches.

**Acceptance Criteria:**
- [ ] Sistema detecta previamente se o item destino é User Product verificando o campo `user_product_id` no GET do item
- [ ] Para User Products, usa `POST /user-products/{user_product_id}/compatibilities/copy-paste` com body correto
- [ ] Body inclui `domain_id`, `category_id`, e `item_id` (source) ou `user_product_id` (source) conforme documentação
- [ ] Nunca envia ambos `item_id` e `user_product_id` simultaneamente no body
- [ ] Remove o código legado de batch manual (`_copy_user_product_compatibilities`)
- [ ] Remove a detecção reativa `_is_user_product_error()`

### US-003: Opção de adicionar ou substituir no frontend
**Description:** Como operador, quero poder escolher se quero adicionar as compatibilidades do fonte às existentes no destino, ou substituir completamente.

**Acceptance Criteria:**
- [ ] Frontend exibe toggle/select com opções "Adicionar" e "Substituir" antes de executar a cópia
- [ ] "Adicionar" (padrão) = merge via PUT com `create` wrapper (mantém existentes + adiciona novas)
- [ ] "Substituir" = usa `PUT /items/{id}/compatibilities` com `{"delete": {"product_ids": [...]}, "create": {"item_to_copy": ...}}` numa única request atômica (GET prévio para obter IDs existentes)
- [ ] Opção é enviada no payload do `POST /api/compat/copy` como campo `mode: "add" | "replace"`
- [ ] Backend respeita o mode escolhido ao decidir o método HTTP

## 4. Functional Requirements

### Backend (`app/services/ml_api.py`):

- **FR-1:** Criar função `get_item_has_compatibilities(seller_slug, item_id) -> bool` que verifica se um item já possui compatibilidades (GET /items/{id}/compatibilities, retorna True se 200 com produtos, False se 404 ou vazio)
- **FR-2:** Refatorar `copy_item_compatibilities()` para aceitar parâmetro `mode: str = "add"`:
  - Se `mode == "add"` e destino já tem compats: usar `PUT /items/{id}/compatibilities` com `{"create": {"item_to_copy": ...}}`
  - Se `mode == "add"` e destino NÃO tem compats: usar `POST /items/{id}/compatibilities` com `{"item_to_copy": ...}`
  - Se `mode == "replace"`: buscar IDs existentes via GET, depois usar `PUT /items/{id}/compatibilities` com `{"delete": {"product_ids": [...]}, "create": {"item_to_copy": ...}}` numa única request atômica
- **FR-3:** Antes de copiar, fazer `GET /items/{item_id}` no destino para verificar se tem `user_product_id`. Se tiver, usar o fluxo User Product direto (sem tentar o endpoint de item primeiro)
- **FR-4:** Para User Products, usar `POST /user-products/{user_product_id}/compatibilities/copy-paste` com body:
  ```json
  {
    "domain_id": "<domain do source>",
    "category_id": "<category do destino>",
    "item_id": "<source_item_id>",
    "extended_information": true
  }
  ```
- **FR-5:** Remover `_is_user_product_error()` e `_copy_user_product_compatibilities()` (código legado)
- **FR-6:** Manter retry com backoff exponencial para 429 (rate limiting)

### Backend (`app/services/compat_copier.py`):

- **FR-7:** `copy_compat_to_targets()` deve aceitar e repassar o parâmetro `mode` para `copy_item_compatibilities()`
- **FR-8:** Pré-buscar o `domain_id` do source uma vez (necessário para User Products copy-paste)

### Backend (`app/routers/compat.py`):

- **FR-9:** `CopyRequest` deve incluir campo `mode: str = "add"` (valores: `"add"` ou `"replace"`)
- **FR-10:** Repassar `mode` para `copy_compat_to_targets()`

### Frontend (`frontend/src/pages/CompatPage.tsx`):

- **FR-11:** Adicionar select/toggle com opções "Adicionar às existentes" (default) e "Substituir todas"
- **FR-12:** Enviar campo `mode` no POST para `/api/compat/copy`

## 5. Non-Goals (Out of Scope)

- **Não** implementar `compatibilities_summary` endpoint (otimização futura)
- **Não** usar `has_compatibilities=true` no search (otimização futura)
- **Não** alterar a lógica de busca por SKU (já funciona)
- **Não** alterar o sistema de logs/histórico (já funciona)
- **Não** alterar permissões (já funciona)
- **Não** refatorar o frontend além de adicionar o toggle add/replace

## 6. Technical Considerations

### Endpoints ML conforme documentação:

| Cenário | Método | Endpoint | Body |
|---------|--------|----------|------|
| Item SEM compats | POST | `/items/{id}/compatibilities` | `{"item_to_copy": {"item_id": "...", "extended_information": true}}` |
| Item COM compats (merge) | PUT | `/items/{id}/compatibilities` | `{"create": {"item_to_copy": {"item_id": "...", "extended_information": true}}}` |
| Deletar compats (replace) | DELETE | `/items/{id}/compatibilities` | `{"product_ids": ["MLB...", "MLB..."]}` |
| User Product (copy-paste) | POST | `/user-products/{id}/compatibilities/copy-paste` | `{"domain_id": "...", "category_id": "...", "item_id": "...", "extended_information": true}` |

### Detecção de User Product:
- `GET /items/{item_id}` → campo `user_product_id` presente = é User Product
- O item destino já é buscado em `_resolve_source_seller`, podemos cachear o resultado

### Arquivos a modificar:
1. `app/services/ml_api.py` — refatorar `copy_item_compatibilities`, remover funções legadas, adicionar novas
2. `app/services/compat_copier.py` — repassar `mode`, pré-buscar domain_id
3. `app/routers/compat.py` — adicionar `mode` ao request
4. `frontend/src/pages/CompatPage.tsx` — adicionar toggle add/replace

### Compatibilidade com item_copier:
- `app/services/item_copier.py` também chama `copy_item_compatibilities()` (linhas 635-795). A refatoração deve manter compatibilidade — o parâmetro `mode` com default `"add"` garante isso.

## 7. Success Metrics

- Cópia de compatibilidades funciona corretamente tanto para itens normais quanto User Products
- Zero requests desperdiçadas (sem "tenta e erra" na detecção de User Product)
- Modo "adicionar" faz merge correto sem duplicar compatibilidades
- Modo "substituir" substitui completamente as compatibilidades

## 8. Open Questions (Resolvidas)

1. **Delete de compatibilidades:** ~~Qual endpoint deleta?~~ **Resolvido:** Existe endpoint `DELETE /items/{id}/compatibilities` com body `{"product_ids": ["..."]}`. Também é possível deletar via PUT com chave `"delete": {"product_ids": ["..."]}`. Para o modo "substituir", usar DELETE com os IDs existentes e depois POST com `item_to_copy`.
2. **domain_id do source:** ~~De onde vem?~~ **Resolvido:** Vem dos `products` retornados pelo `GET /items/{id}/compatibilities` (cada product tem `domain_id`). Alternativamente, do dump de domínios (`GET /catalog/dumps/domains/{SITE_ID}/compatibilities`).
3. **category_id do destino:** ~~Confirmar origem.~~ **Resolvido:** Vem do campo `category_id` do `GET /items/{id}` do item destino.

## 9. Referência Completa da API

### Criar compatibilidades (POST)
```bash
POST /items/{ITEM_ID}/compatibilities
```
```json
{
  "products": [{"id": "$PRODUCT_ID", "creation_source": "DEFAULT", "note": "texto", "restrictions": [...]}],
  "products_families": [{"domain_id": "$DOMAIN_ID", "creation_source": "DEFAULT", "attributes": [...]}]
}
```
**Nota:** `creation_source` é **obrigatório** — valores: `ITEM_SUGGESTIONS`, `NEW_VEHICLES`, `DEFAULT`.

### Copy-paste para item SEM compats (POST)
```bash
POST /items/{ITEM_ID}/compatibilities
```
```json
{"item_to_copy": {"item_id": "$SOURCE_ITEM_ID", "extended_information": true}}
```

### Copy-paste para item COM compats — merge (PUT)
```bash
PUT /items/{ITEM_ID}/compatibilities
```
```json
{"create": {"item_to_copy": {"item_id": "$SOURCE_ITEM_ID", "extended_information": true}}}
```
O ML faz deduplicação automática — só copia veículos que não existem no destino.

### Atualizar compatibilidades — create + delete (PUT)
```bash
PUT /items/{ITEM_ID}/compatibilities
```
```json
{
  "create": {
    "products": [{"id": "...", "creation_source": "DEFAULT", "note": "...", "restrictions": [...]}],
    "products_families": [{"domain_id": "...", "creation_source": "DEFAULT", "attributes": [...]}]
  },
  "delete": {
    "product_ids": ["MLB22015074", "MLB7427549"]
  }
}
```

### Deletar compatibilidades (DELETE)
```bash
DELETE /items/{ITEM_ID}/compatibilities
```
```json
{"product_ids": ["MLB22015074", "MLB7427549"]}
```

### Copy-paste para User Products (POST)
```bash
POST /user-products/{USER_PRODUCT_ID}/compatibilities/copy-paste
```
```json
{
  "domain_id": "MLB-CARS_AND_VANS",
  "category_id": "MLB12344",
  "item_id": "$SOURCE_ITEM_ID",
  "extended_information": true
}
```
**Regra:** Nunca enviar `item_id` e `user_product_id` simultaneamente — apenas um dos dois.

### Limites da API
- Máximo **200 produtos** por request
- Acima de 200, processamento **assíncrono**
- Rate limit: **100 requests/minuto** por APP_ID
- Compatibilidades com **claims não são copiadas**
- Máximo **10 domínios** por request
- Nota máxima: **500 caracteres**
