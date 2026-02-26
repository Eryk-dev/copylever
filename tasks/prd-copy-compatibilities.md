# PRD: Copiar Compatibilidades entre Anuncios

## 1. Introduction/Overview

Atualmente, o sistema **Copy Anuncios** copia anúncios inteiros (título, fotos, descrição, compatibilidades, etc.) de um seller para outro. Porém, existe a necessidade frequente de copiar **apenas as compatibilidades de veículos** de um anúncio fonte para anúncios já existentes em múltiplas contas, identificados por SKU.

O problema: quando um anúncio possui a tabela de compatibilidades correta (lista completa de carros compatíveis), o operador precisa replicar essa mesma tabela para os anúncios equivalentes em todas as outras contas do Mercado Livre. Hoje isso é feito manualmente, um anúncio por vez.

Este recurso cria uma nova view dedicada onde o operador informa o item fonte, digita os SKUs desejados, e o sistema automaticamente localiza todos os anúncios correspondentes em todas as contas conectadas e aplica as compatibilidades.

## 2. Goals

- Permitir copiar compatibilidades de um anúncio fonte para múltiplos anúncios de destino em lote
- Buscar anúncios de destino por SKU automaticamente em todas as contas conectadas
- Substituir completamente as compatibilidades existentes nos anúncios de destino
- Exibir progresso e resultados da operação em tempo real
- Reduzir tempo operacional de minutos (manual) para segundos (automatizado)

## 3. User Stories

### US-001: Informar anúncio fonte
**Description:** Como operador, quero informar o link do ML ou item_id do anúncio que tem as compatibilidades corretas, para que o sistema saiba de onde extrair os dados.

**Acceptance Criteria:**
- [ ] Campo de input aceita URL completa do ML (ex: `https://www.mercadolivre.com.br/...MLB-12345...`)
- [ ] Campo aceita item_id direto (ex: `MLB1234567890`)
- [ ] Sistema extrai o item_id de URLs do ML automaticamente (parse do MLB-XXXXXXXXXX)
- [ ] Ao informar o item fonte, sistema busca e exibe preview (título, thumbnail, quantidade de compatibilidades)
- [ ] Se o item não tiver compatibilidades, exibe aviso e bloqueia a operação

### US-002: Informar SKUs de destino
**Description:** Como operador, quero digitar um ou mais SKUs para que o sistema encontre todos os anúncios correspondentes em todas as contas conectadas.

**Acceptance Criteria:**
- [ ] Campo de texto aceita um ou mais SKUs (separados por vírgula, espaço ou quebra de linha)
- [ ] Ao submeter, sistema busca os SKUs em todas as contas conectadas (sellers) via API do ML
- [ ] Exibe lista dos anúncios encontrados agrupados por conta/seller
- [ ] Mostra item_id, título e seller de cada anúncio encontrado
- [ ] Se nenhum anúncio for encontrado para um SKU, exibe aviso indicando o SKU não encontrado

### US-003: Executar cópia de compatibilidades
**Description:** Como operador, quero executar a cópia das compatibilidades do anúncio fonte para todos os anúncios encontrados, substituindo as compatibilidades existentes.

**Acceptance Criteria:**
- [ ] Botão "Copiar Compatibilidades" inicia a operação
- [ ] Sistema usa o endpoint nativo do ML (`POST /items/{id}/compatibilities` com `item_to_copy`) para cada anúncio destino
- [ ] Compatibilidades existentes nos anúncios de destino são substituídas completamente
- [ ] Exibe progresso em tempo real (X de Y concluídos)
- [ ] Ao finalizar, mostra resumo com sucessos e erros
- [ ] Erros individuais não interrompem o processamento dos demais

### US-004: Histórico de operações
**Description:** Como operador, quero ver o histórico das cópias de compatibilidades realizadas.

**Acceptance Criteria:**
- [ ] Operações são registradas na tabela `compat_logs` no Supabase
- [ ] Histórico exibe: data, item fonte, SKUs informados, quantidade de anúncios atualizados, status
- [ ] Histórico é exibido abaixo do formulário na mesma page

## 4. Functional Requirements

**Backend:**

- **FR-1:** O sistema deve expor endpoint `GET /api/compat/search-sku?sku=XXX` que busca anúncios por SKU em todas as contas conectadas usando a API do ML (`GET /users/{user_id}/items/search?seller_sku=XXX`)
- **FR-2:** O sistema deve expor endpoint `POST /api/compat/copy` que recebe `{ source_item_id, targets: [{ seller_slug, item_id }] }` e executa a cópia de compatibilidades para cada target
- **FR-3:** Para cada target, o sistema deve usar `POST /items/{target_item_id}/compatibilities` com `{ "item_to_copy": { "item_id": source_item_id, "extended_information": true } }` (reutilizar `copy_item_compatibilities` de `ml_api.py`)
- **FR-4:** O sistema deve expor endpoint `GET /api/compat/preview/{item_id}` para preview do item fonte (título, thumbnail, contagem de compatibilidades)
- **FR-5:** O sistema deve registrar cada operação no Supabase (tabela `compat_logs`)
- **FR-6:** O endpoint de busca por SKU deve buscar em TODAS as contas conectadas em paralelo (asyncio.gather)
- **FR-7:** O sistema deve expor endpoint `GET /api/compat/logs` para listar histórico de operações

**Frontend:**

- **FR-8:** Nova view "Compat" como terceira aba no header do app (ao lado de "Copiar" e "Sellers")
- **FR-9:** Formulário com campo para link/item_id do anúncio fonte com preview automático
- **FR-10:** Campo para SKUs (textarea) com suporte a múltiplos SKUs separados por vírgula/espaço/quebra de linha
- **FR-11:** Botão "Buscar" que dispara a busca por SKU em todas as contas e exibe os resultados encontrados
- **FR-12:** Botão "Copiar Compatibilidades" que executa a cópia para todos os anúncios encontrados
- **FR-13:** Indicador de progresso durante a cópia
- **FR-14:** Seção de histórico abaixo do formulário

## 5. Non-Goals (Out of Scope)

- **Não** copiar outros dados do anúncio (título, preço, fotos, descrição) — apenas compatibilidades
- **Não** permitir seleção/deseleção individual de contas — busca em TODAS as contas conectadas
- **Não** permitir edição manual das compatibilidades — apenas cópia do fonte para destinos
- **Não** mesclar compatibilidades — sempre substituir completamente
- **Não** criar anúncios novos — apenas atualizar anúncios já existentes
- **Não** lidar com rate limiting avançado da API do ML — tratamento básico de erros é suficiente

## 6. Technical Considerations

### APIs do Mercado Livre envolvidas:

1. **Buscar itens por SKU:** `GET /users/{user_id}/items/search?seller_sku={sku}` — retorna lista de item_ids
2. **Buscar dados do item:** `GET /items/{item_id}` — para preview/título
3. **Copiar compatibilidades:** `POST /items/{item_id}/compatibilities` com body `{ "item_to_copy": { "item_id": source_id, "extended_information": true } }`

### Código existente reutilizável:

- `app/services/ml_api.py`:
  - `copy_item_compatibilities()` — já implementa a cópia nativa do ML
  - `get_item()` — para buscar dados do item fonte
  - `get_item_compatibilities()` — para verificar se o item fonte tem compatibilidades
  - `_get_token()` — gerenciamento de tokens por seller

### Novo código necessário:

- **`app/services/ml_api.py`**: Adicionar função `search_items_by_sku(seller_slug, sku)` que faz `GET /users/{user_id}/items/search?seller_sku={sku}`
- **`app/routers/compat.py`**: Novo router com endpoints de compatibilidade
- **`app/services/compat_copier.py`**: Lógica de orquestração (busca em todas contas + cópia em lote)
- **`frontend/src/pages/CompatPage.tsx`**: Nova página
- **`frontend/src/components/CompatForm.tsx`**: Formulário
- **`frontend/src/components/CompatResults.tsx`**: Exibição de resultados

### Tabela Supabase (nova):

```sql
CREATE TABLE compat_logs (
  id BIGSERIAL PRIMARY KEY,
  source_item_id TEXT NOT NULL,
  skus TEXT[] NOT NULL,
  targets JSONB NOT NULL,        -- [{ seller_slug, item_id, status, error }]
  total_targets INT NOT NULL,
  success_count INT NOT NULL,
  error_count INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Parsing de URL do ML:

Extrair item_id de URLs como:
- `https://www.mercadolivre.com.br/produto-xyz-MLB-1234567890-_JM`
- `https://produto.mercadolivre.com.br/MLB-1234567890-...`

Regex: capturar `MLB\d+` (removendo o hífen: `MLB-1234567890` → `MLB1234567890`)

## 7. Success Metrics

- Operador consegue copiar compatibilidades de 1 fonte para 10+ anúncios em menos de 30 segundos
- Taxa de sucesso da cópia > 95% (erros apenas por problemas da API do ML)
- Zero intervenção manual necessária após clicar "Copiar"

## 8. Open Questions

1. **Rate limiting do ML:** A API do ML tem limite de requisições por minuto. Se houver muitas contas + muitos SKUs, pode ser necessário throttling. Implementar throttle básico ou deixar para v2?
2. **Busca por SKU:** O endpoint `GET /users/{user_id}/items/search?seller_sku={sku}` retorna exatamente o que precisamos? Validar comportamento com SKUs parciais vs exatos.
3. **Permissão do token:** O token de cada seller tem permissão para buscar items por SKU e atualizar compatibilidades? Verificar scopes necessários.
