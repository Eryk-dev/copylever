# Índice Completo de Documentação

Guia de navegação para toda a documentação técnica do projeto Copy Anuncios.

---

## Estrutura de Documentos

### API e Endpoints

**[API.md](./API.md)** — Documentação de endpoints REST
- Lista completa de rotas (auth, copy, compat, admin, billing)
- Requests/responses com exemplos JSON
- Códigos HTTP e tratamento de erro
- Fluxos de OAuth2 e webhooks Stripe

### Serviços Backend

**[SERVICES.md](./SERVICES.md)** — Documentação detalhada de serviços — **LEIA PRIMEIRO PARA ENTENDER A LÓGICA**
- **ml_api.py** — Cliente API ML com token management, retry e rate limiting
- **item_copier.py** — Núcleo de cópia com payload building, retry inteligente e safe mode
- **compat_copier.py** — Orquestração de compatibilidades veiculares
- **email.py** — Serviço SMTP para password reset
- **config.py** — Variáveis de ambiente documentadas
- **Padrões de Erro ML** — Tabela de erros comuns e tratamento

### Exemplos e Troubleshooting

**[SERVICES-EXAMPLES.md](./SERVICES-EXAMPLES.md)** — Guia prático
- 6 exemplos de uso (copy simples, retry automático, múltiplos sellers, compatibilidades)
- Guia de troubleshooting para 10 problemas comuns
- Análise de `api_debug_logs` para debugging
- Checklist de performance e deployment

### Referência Rápida

**[SERVICES-REFERENCE.md](./SERVICES-REFERENCE.md)** — Cheat sheet para desenvolvedores
- Assinaturas de funções principais (ml_api.py, item_copier.py, compat_copier.py)
- Constantes importantes (excluded fields, rate limits, timeouts)
- Estrutura de tabelas DB (copy_logs, compat_logs, api_debug_logs)
- Padrões comuns de código
- Queries SQL úteis para debugging
- Checklist de environment variables

---

## Por Função/Rol

### Desenvolvedor Backend (Nova Feature)

1. **Entender a lógica atual:**
   - Ler [SERVICES.md — item_copier.py](#itemcopierpy--núcleo-de-cópia-de-anúncios) — fluxo completo de copy
   - Ler [SERVICES-EXAMPLES.md — Exemplos 1-3](#exemplos-de-uso) — casos de uso reais

2. **Implementar a feature:**
   - Consultar [SERVICES-REFERENCE.md](#servicesreferenceemd--referência-rápida) para assinaturas exatas
   - Usar [SERVICES-EXAMPLES.md — Troubleshooting](#troubleshooting-guia) para padrões comuns

3. **Testar:**
   - Usar queries SQL em [SERVICES-REFERENCE.md — Database Tables](#database-tables-supabase)
   - Verificar logs em `api_debug_logs`

### QA / Tester

1. **Entender os fluxos:**
   - [SERVICES-EXAMPLES.md — 6 exemplos de uso](#exemplos-de-uso)
   - [SERVICES.md — Diagrama de Fluxos](#diagrama-de-fluxos-principais)

2. **Testar casos edge:**
   - [SERVICES-EXAMPLES.md — Troubleshooting](#troubleshooting-guia)
   - [SERVICES.md — Padrões de Erro](#padrões-de-erro-ml-e-tratamento)

3. **Reproduzir bugs:**
   - [SERVICES-EXAMPLES.md — Análise de api_debug_logs](#análise-de-api_debug_logs)

### DevOps / Infra

1. **Configurar ambiente:**
   - [SERVICES-REFERENCE.md — Environment Checklist](#environment-checklist)
   - [SERVICES-REFERENCE.md — Debugging Commands](#debugging-commands)

2. **Monitorar:**
   - Queries em [SERVICES-REFERENCE.md](#debugging-commands)
   - Alertas em `api_debug_logs.resolved = false`

### Product Manager / Owner

1. **Entender capacidades:**
   - [API.md](./API.md) — O que o sistema pode fazer
   - [SERVICES.md — Item_copier flow](#copy-simples-de-item) — casos de uso suportados

2. **Discussões de feature:**
   - [SERVICES.md — Limitações conhecidas](#notas-de-implementação-importantes)
   - [SERVICES.md — Rate limiting e performance](#4-picture-urls-não-ids)

---

## Tópicos Principais

### Como Funciona a Copy de Item?

**Leitura rápida (5 min):**
- [SERVICES-EXAMPLES.md — Exemplo 1: Copy Simples](#1-copy-simples-de-item)

**Leitura completa (30 min):**
- [SERVICES.md — item_copier.py — Loop de Retry](#loop-de-retry)
- [SERVICES.md — Diagrama de Fluxos — Copy de Item](#copy-de-item-happy-path)

### Como Funciona a Compatibilidade?

**Leitura rápida (5 min):**
- [SERVICES-EXAMPLES.md — Exemplo 5: Copy de Compatibilidades](#5-copy-de-compatibilidades-veiculares)

**Leitura completa (20 min):**
- [SERVICES.md — compat_copier.py](#compat_copierpy--cópia-de-compatibilidades-veiculares)
- [SERVICES.md — ml_api.py — Compatibilidades](#compatibilidades-veiculares)

### Autenticação OAuth2

**Leitura rápida:**
- [API.md — MercadoLivre OAuth](./API.md#mercadolivre-oauth)

**Leitura detalhada:**
- [SERVICES.md — Token Management](#token-management--autenticação-oauth2)

### Tratamento de Erros

**Erros comuns e soluções:**
- [SERVICES.md — Padrões de Erro ML](#padrões-de-erro-ml-e-tratamento)
- [SERVICES-EXAMPLES.md — Troubleshooting](#troubleshooting-guia)

**Debugging profundo:**
- [SERVICES-EXAMPLES.md — Análise de api_debug_logs](#análise-de-api_debug_logs)

### Safe Mode e Retry Inteligente

**Conceito:**
- [SERVICES.md — Build Item Payload — Safe Mode](#safe-mode)
- [SERVICES.md — Ajuste de Payload para Erros](#ajuste-de-payload-para-erros)

**Implementação:**
- [SERVICES.md — Loop de Retry](#loop-de-retry)

### Brand Accounts (Official Stores)

**Diferenças:**
- [SERVICES.md — Diferenças com Brand Accounts](#diferenças-entre-contas-normais-e-brand-accounts-official-stores)

**Problema: Official Store ID:**
- [SERVICES-EXAMPLES.md — Troubleshooting: official_store_id](#problema-copy-falha-com-required_fields-official_store_id)

### User Products

**O que são:**
- [SERVICES.md — Detecta User Product](#é-user-product-item)

**Como funciona compatibilidade:**
- [SERVICES.md — _copy_user_product_compatibilities](#async-_copy_user_product_compatibilitiesclinet-httpxasyncclient-token-str-item_id-str-source_products-listdict--none--dict)

### Dimensões de Envio

**Problema comum:**
- [SERVICES-EXAMPLES.md — Problema: Copy Bloqueado por Dimensões](#problema-copy-bloqueado-por-dimensões-faltantes)

**Solução:**
- [SERVICES.md — copy_with_dimensions](#cópia-com-dimensões-workflow-para-items-sem-shipping-dimensions)

### Rate Limiting (429)

**Tratamento automático:**
- [SERVICES.md — _post_with_retry](#rate-limiting-e-retry)

**Em produção:**
- [SERVICES-EXAMPLES.md — Problema: Rate Limit](#problema-rate-limit-429-too-many-requests)

---

## Tarefas Comuns

### Debugar um Copy que Falhou

1. **Encontrar o erro no banco:**
   ```sql
   SELECT * FROM api_debug_logs
   WHERE source_item_id = 'MLBxxxx'
   ORDER BY created_at DESC LIMIT 10;
   ```

2. **Analisar resposta do ML:**
   - Examinar `response_body.cause[]` — quais campos são problema?
   - Comparar com `request_payload` — qual campo foi enviado incorretamente?

3. **Consultar documentação:**
   - [SERVICES.md — Padrões de Erro ML](#padrões-de-erro-ml-e-tratamento) — tabela de erros
   - [SERVICES-EXAMPLES.md — Troubleshooting](#troubleshooting-guia) — soluções específicas

### Adicionar Novo Endpoint de Copy

1. **Estudar copy existente:**
   - [SERVICES.md — copy_single_item](#loop-de-retry)
   - [API.md — POST /api/copy](./API.md)

2. **Criar router endpoint:**
   - Examinar `app/routers/copy.py` como referência
   - Usar `require_user()` ou `require_admin()` dependency
   - Chamar `copy_single_item()` ou `copy_items()`
   - Log resultado em `copy_logs`

3. **Testar:**
   - Usar [SERVICES-EXAMPLES.md — Exemplos](#exemplos-de-uso) como base
   - Verificar `api_debug_logs` para erros

### Adicionar Novo Tipo de Retry

1. **Identificar o erro:**
   - Examinar `api_debug_logs` para padrão
   - Criar função de detecção (ex: `_is_xxx_error()`)

2. **Implementar ajuste:**
   - Adicionar lógica em `_adjust_payload_for_ml_error()`
   - Retornar ação em `adjustments[]`

3. **Documentar:**
   - Adicionar tabela em [SERVICES.md — Erros de Validação](#erros-de-validação-de-campo)
   - Adicionar exemplo em `error-history.yaml`

### Monitorar Performance

1. **Queries úteis:**
   - [SERVICES-REFERENCE.md — Debugging Commands](#debugging-commands)

2. **Métricas chave:**
   - Success rate: `SELECT status, COUNT(*) FROM copy_logs GROUP BY status`
   - Retry rate: Items com `attempt_number > 1` em `api_debug_logs`
   - Tempo médio: `SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) FROM copy_logs`

### Resolver Problema de Production

1. **Checklist:**
   - [SERVICES-REFERENCE.md — Environment Checklist](#environment-checklist) — variáveis corretas?
   - [SERVICES-EXAMPLES.md — Troubleshooting](#troubleshooting-guia) — problema conhecido?

2. **Escalar:**
   - Examinar `api_debug_logs` para padrão
   - Comparar com [SERVICES.md — Padrões de Erro](#padrões-de-erro-ml-e-tratamento)
   - Se novo padrão: documentar para future reference

---

## Glossário

### Termos Técnicos

- **Brand Account / Official Store:** Conta do Mercado Livre de loja oficial — requer `official_store_id` nos items
- **User Product:** Tipo de item usado por brand accounts — usa `/user-products/` endpoints em vez de `/items/`
- **Safe Mode:** Modo de retry com payload minimalista — ativado após 3 tentativas falharem
- **SKU:** Seller custom field — identificador único do seller para o item (não é obrigatório)
- **Logistics Type:** `me2` (Standard ML) vs `me1` (Full ML) — determines quem faz envio
- **Compatibilidades:** Mapping de produto a veículos (ex: peça é compatível com Honda Civic 2010)
- **Rate Limit:** Limite de requests à API ML — retorna 429, system retenta com backoff
- **Token Refresh:** Renovação de access_token via refresh_token — automático em `_get_token()`

### Campos Importantes

- **seller_custom_field:** SKU do seller no item
- **SELLER_SKU attribute:** Atributo de SKU no item (pode estar em variations)
- **family_name:** Nome da família/marca — usado em brand accounts em vez de title
- **official_store_id:** ID da loja oficial — requerido para brand accounts
- **user_product_id:** ID do user product — usado na compatibilidades API fallback

---

## Leitura Recomendada por Nível

### Nível 1: Iniciante

**Tempo:** 1-2 horas

1. [SERVICES-EXAMPLES.md — Exemplos 1, 2, 3](./SERVICES-EXAMPLES.md#exemplos-de-uso)
2. [SERVICES.md — item_copier.py overview](./SERVICES.md#item_copierpy--núcleo-de-cópia-de-anúncios)
3. [SERVICES.md — Diagrama de Fluxos](./SERVICES.md#diagrama-de-fluxos-principais)

### Nível 2: Intermediário

**Tempo:** 3-4 horas

1. [SERVICES.md — Todos os serviços](./SERVICES.md)
2. [SERVICES-EXAMPLES.md — Troubleshooting](./SERVICES-EXAMPLES.md#troubleshooting-guia)
3. [API.md](./API.md) — Endpoints

### Nível 3: Avançado

**Tempo:** 5+ horas

1. Código fonte em `app/services/`
2. [SERVICES.md — Padrões de Erro Detalhados](./SERVICES.md#padrões-de-erro-ml-e-tratamento)
3. [SERVICES-EXAMPLES.md — Análise de api_debug_logs](./SERVICES-EXAMPLES.md#análise-de-api_debug_logs)
4. Queries SQL para debugging
5. `error-history.yaml` para historical patterns

---

## Links Rápidos por Arquivo

### SERVICES.md

- [ml_api.py](./SERVICES.md#ml_apipy--cliente-api-mercado-livre)
  - [Token Management](./SERVICES.md#token-management--autenticação-oauth2)
  - [Item Operations](./SERVICES.md#operações-de-item)
  - [Compatibilidades](./SERVICES.md#compatibilidades-veiculares)
  - [Rate Limiting](./SERVICES.md#rate-limiting-e-retry)

- [item_copier.py](./SERVICES.md#item_copierpy--núcleo-de-cópia-de-anúncios)
  - [Constantes](./SERVICES.md#constantes-e-configurações)
  - [Detecção de Erros](./SERVICES.md#detecção-de-erros-ml)
  - [Build Payload](./SERVICES.md#construção-de-payload)
  - [Retry Logic](./SERVICES.md#loop-de-retry)

- [compat_copier.py](./SERVICES.md#compat_copierpy--cópia-de-compatibilidades-veiculares)
- [email.py](./SERVICES.md#emailpy--serviço-de-email)
- [config.py](./SERVICES.md#configpy--configuração)
- [Padrões de Erro](./SERVICES.md#padrões-de-erro-ml-e-tratamento)

### SERVICES-EXAMPLES.md

- [Exemplos 1-6](./SERVICES-EXAMPLES.md#exemplos-de-uso)
- [Troubleshooting 1-7](./SERVICES-EXAMPLES.md#troubleshooting-guia)
- [api_debug_logs Analysis](./SERVICES-EXAMPLES.md#análise-de-api_debug_logs)

### SERVICES-REFERENCE.md

- [Assinaturas de Funções](./SERVICES-REFERENCE.md#ml_apipy--assinaturas-rápidas)
- [Database Tables](./SERVICES-REFERENCE.md#database-tables-supabase)
- [Constantes](./SERVICES-REFERENCE.md#constantes-importantes)
- [Debugging](./SERVICES-REFERENCE.md#debugging-commands)

---

## Mantendo Documentação Atualizada

### Quando Adicionar Documentação

- [ ] Nova função principal → adicionar a SERVICES.md + SERVICES-REFERENCE.md
- [ ] Novo padrão de erro → adicionar tabela em SERVICES.md + SERVICES-EXAMPLES.md
- [ ] Nova feature → adicionar exemplo em SERVICES-EXAMPLES.md
- [ ] Nova variável env → adicionar a config.py + SERVICES-REFERENCE.md
- [ ] Bug fix → documentar em error-history.yaml

### Processo de Atualização

1. **Código:** Implementar feature/fix
2. **Documentação:** Atualizar docs correspondentes
3. **Exemplo:** Adicionar exemplo prático em SERVICES-EXAMPLES.md
4. **Reference:** Atualizar assinaturas em SERVICES-REFERENCE.md
5. **History:** Adicionar em error-history.yaml se bug fix
6. **Commit message:** "docs: Update SERVICES.md for new feature X"

---

## Conclusão

Documentação é organizada em 3 níveis:

1. **SERVICES.md** — Documentação técnica completa (referência definitiva)
2. **SERVICES-EXAMPLES.md** — Exemplos práticos e troubleshooting
3. **SERVICES-REFERENCE.md** — Cheat sheet rápido para desenvolvimento

Comece com [SERVICES-EXAMPLES.md](#servicesexamplesmd--exemplos-práticos-e-troubleshooting) para entender casos de uso reais, depois aprofunde em [SERVICES.md](#servicesmd--documentação-de-serviços-e-lógica-de-negócio) para detalhes técnicos.
