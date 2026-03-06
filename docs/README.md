# Documentação — Copy Anuncios

Bem-vindo à documentação técnica completa da plataforma Copy Anuncios. Este diretório contém documentação detalhada de todos os componentes, APIs, e lógica de negócio.

---

## Comece Aqui

### Primeira Vez?

1. **[INDEX.md](./INDEX.md)** — Guia de navegação (5 min)
   - Estrutura de todos os docs
   - Guias personalizados por rol (dev, QA, PM, DevOps)
   - Leitura recomendada por nível

2. **[SERVICES-EXAMPLES.md](./SERVICES-EXAMPLES.md)** — Exemplos Práticos (20 min)
   - 6 cenários de uso reais
   - 10 problemas comuns e soluções
   - Troubleshooting guia

3. **[SERVICES.md](./SERVICES.md)** — Documentação Técnica Completa (45 min)
   - Explicação detalhada de cada serviço
   - Fluxos passo-a-passo
   - Padrões de erro ML e tratamento

### Documentação por Tópico

#### Desenvolvimento Backend

- **[SERVICES.md](./SERVICES.md)** — Lógica de negócio (ml_api, item_copier, compat_copier)
- **[SERVICES-REFERENCE.md](./SERVICES-REFERENCE.md)** — Cheat sheet com assinaturas de funções
- **[API.md](./API.md)** — Endpoints REST (POST /api/copy, etc.)
- **[AUTH-SECURITY.md](./AUTH-SECURITY.md)** — Autenticação OAuth2 e RBAC

#### Banco de Dados

- **[DATABASE.md](./DATABASE.md)** — Schema, migrations, queries úteis
- **[SERVICES.md — Database Tables](./SERVICES.md#database-tables-supabase)** — Referência de tabelas

#### Infraestrutura / DevOps

- **[DEPLOY.md](./DEPLOY.md)** — Docker, environment variables, deployment
- **[SERVICES-REFERENCE.md — Environment Checklist](./SERVICES-REFERENCE.md#environment-checklist)**

#### Frontend

- **[FRONTEND.md](./FRONTEND.md)** — React components, hooks, UI

#### QA / Testing

- **[SERVICES-EXAMPLES.md — Troubleshooting](./SERVICES-EXAMPLES.md#troubleshooting-guia)** — Problemas e reprodução
- **[SERVICES-EXAMPLES.md — Análise de Logs](./SERVICES-EXAMPLES.md#análise-de-api_debug_logs)** — Debug queries

#### Product / Strategy

- **[estrategia-zero-friccao.md](./estrategia-zero-friccao.md)** — Roadmap e visão do produto

---

## Mapa de Documentação

```
docs/
├── README.md (este arquivo)
├── INDEX.md ⭐ Comece aqui para navegação
│
├── SERVIÇOS (Backend Lógica)
├── SERVICES.md ⭐⭐ Documentação técnica completa
├── SERVICES-EXAMPLES.md ⭐ Exemplos práticos + troubleshooting
├── SERVICES-REFERENCE.md ⭐ Cheat sheet rápido
│
├── API
├── API.md ⭐ Endpoints REST
│
├── AUTENTICAÇÃO
├── AUTH-SECURITY.md ⭐ OAuth2, RBAC, autenticação
│
├── BANCO DE DADOS
├── DATABASE.md ⭐ Schema, migrations
│
├── INFRAESTRUTURA
├── DEPLOY.md ⭐ Docker, deployment
│
├── FRONTEND
└── FRONTEND.md ⭐ React, UI components

⭐ = Documentação criada/atualizada recentemente
⭐⭐ = Documentação nova, leitura altamente recomendada
```

---

## Documentação por Rol

### Developer Backend

**Leitura essencial (ordem):**
1. [INDEX.md — Nível 1: Iniciante](./INDEX.md#nível-1-iniciante) (1-2h)
2. [SERVICES-EXAMPLES.md — Exemplos 1-3](./SERVICES-EXAMPLES.md#exemplos-de-uso) (15 min)
3. [SERVICES.md — item_copier.py](./SERVICES.md#item_copierpy--núcleo-de-cópia-de-anúncios) (30 min)
4. [SERVICES-REFERENCE.md](./SERVICES-REFERENCE.md) (manter aberto para referência)

**Para nova feature:**
- [INDEX.md — Adicionar Novo Endpoint de Copy](./INDEX.md#adicionar-novo-endpoint-de-copy)
- [SERVICES.md](./SERVICES.md)
- Código em `app/services/`

**Para debugar bug:**
- [SERVICES-EXAMPLES.md — Troubleshooting](./SERVICES-EXAMPLES.md#troubleshooting-guia)
- [SERVICES-EXAMPLES.md — Análise de api_debug_logs](./SERVICES-EXAMPLES.md#análise-de-api_debug_logs)
- [SERVICES.md — Padrões de Erro](./SERVICES.md#padrões-de-erro-ml-e-tratamento)

### QA / Tester

**Leitura essencial:**
1. [SERVICES-EXAMPLES.md — Exemplos 1-6](./SERVICES-EXAMPLES.md#exemplos-de-uso) (20 min)
2. [SERVICES-EXAMPLES.md — Troubleshooting](./SERVICES-EXAMPLES.md#troubleshooting-guia) (20 min)
3. [SERVICES.md — Diagrama de Fluxos](./SERVICES.md#diagrama-de-fluxos-principais) (10 min)

**Para reproduzir bug:**
- [SERVICES-EXAMPLES.md — Análise de api_debug_logs](./SERVICES-EXAMPLES.md#análise-de-api_debug_logs)

### DevOps / Infra

**Leitura essencial:**
1. [DEPLOY.md](./DEPLOY.md) — Setup inicial
2. [DATABASE.md](./DATABASE.md) — Backup, migrations
3. [SERVICES-REFERENCE.md — Environment Checklist](./SERVICES-REFERENCE.md#environment-checklist)
4. [SERVICES-REFERENCE.md — Debugging Commands](./SERVICES-REFERENCE.md#debugging-commands)

**Para monitorar health:**
- Queries em [SERVICES-REFERENCE.md](./SERVICES-REFERENCE.md#debugging-commands)
- Alertas em `api_debug_logs.resolved = false`

### Product Manager / Owner

**Leitura essencial:**
1. [API.md](./API.md) — Capacidades da plataforma
2. [SERVICES-EXAMPLES.md — Exemplos 1-6](./SERVICES-EXAMPLES.md#exemplos-de-uso) — casos de uso
3. [estrategia-zero-friccao.md](./estrategia-zero-friccao.md) — roadmap

**Para discuss features:**
- [SERVICES.md — Notas de Implementação](./SERVICES.md#notas-de-implementação-importantes) — limitações

### Frontend Developer

**Leitura essencial:**
1. [FRONTEND.md](./FRONTEND.md) — React components, hooks
2. [API.md](./API.md) — Endpoints que frontend consome
3. [SERVICES-EXAMPLES.md — Exemplos 1-4](./SERVICES-EXAMPLES.md#exemplos-de-uso) — fluxos esperados

---

## Tópicos Principais

### Como Funciona a Copy de Item?

- **Rápido (5 min):** [SERVICES-EXAMPLES.md — Exemplo 1](./SERVICES-EXAMPLES.md#1-copy-simples-de-item)
- **Completo (30 min):** [SERVICES.md — item_copier.py](./SERVICES.md#item_copierpy--núcleo-de-cópia-de-anúncios)
- **Diagrama:** [SERVICES.md — Copy Item (Happy Path)](./SERVICES.md#copy-de-item-happy-path)

### Como Debugar um Copy Que Falhou?

- [SERVICES-EXAMPLES.md — Troubleshooting Guide](./SERVICES-EXAMPLES.md#troubleshooting-guia)
- [SERVICES-EXAMPLES.md — api_debug_logs Analysis](./SERVICES-EXAMPLES.md#análise-de-api_debug_logs)

### Quais São Todas as Variáveis de Ambiente?

- [SERVICES.md — config.py](./SERVICES.md#configpy--configuração)
- [SERVICES-REFERENCE.md — Environment Checklist](./SERVICES-REFERENCE.md#environment-checklist)

### Como Implementar Nova Feature?

- [INDEX.md — Adicionar Novo Endpoint](./INDEX.md#adicionar-novo-endpoint-de-copy)
- [SERVICES.md](./SERVICES.md) (entender conceitos)
- [SERVICES-EXAMPLES.md](./SERVICES-EXAMPLES.md) (ver exemplo similar)
- [SERVICES-REFERENCE.md](./SERVICES-REFERENCE.md) (assinaturas exatas)

### O Que São Brand Accounts / Official Stores?

- [SERVICES.md — Brand Accounts](./SERVICES.md#diferenças-entre-contas-normais-e-brand-accounts-official-stores)
- [SERVICES-EXAMPLES.md — Problema: official_store_id](./SERVICES-EXAMPLES.md#problema-copy-falha-com-required_fields-official_store_id)

### Como Rate Limiting Funciona?

- [SERVICES.md — Rate Limiting](./SERVICES.md#rate-limiting-e-retry)
- [SERVICES-EXAMPLES.md — Problema: Rate Limit](./SERVICES-EXAMPLES.md#problema-rate-limit-429-too-many-requests)

### Database Schema?

- [DATABASE.md](./DATABASE.md) — Schema, indices, migrations
- [SERVICES.md — Database Tables](./SERVICES.md#database-tables-supabase)
- [SERVICES-REFERENCE.md — Database Tables](./SERVICES-REFERENCE.md#database-tables-supabase)

---

## Glossário Rápido

### Termos Técnicos Chave

- **Brand Account / Official Store:** Conta Mercado Livre de loja oficial — requer `official_store_id`
- **User Product:** Item usado por brand accounts — API endpoints diferentes
- **Safe Mode:** Retry com payload minimalista — ativado após 3 tentativas normais
- **SKU:** Seller custom field — identificador único do seller (não obrigatório)
- **OAuth2:** Fluxo de autenticação — user autoriza, recebe access + refresh token
- **Rate Limit (429):** Limite de requests à API ML — system retenta automaticamente
- **Token Refresh:** Renovação de access_token via refresh_token — automático
- **Compatibilidades:** Mapping de produto a veículos (ex: peça é compatível com Honda Civic 2010)

Veja [SERVICES.md — Glossário](./SERVICES.md#glossário) para lista completa com 15+ termos.

---

## Encontrando Informações Específicas

### "Como fazer X?"

→ [INDEX.md — Tarefas Comuns](./INDEX.md#tarefas-comuns)

### "Qual é a assinatura de função Y?"

→ [SERVICES-REFERENCE.md](./SERVICES-REFERENCE.md)

### "Qual erro ML é este?"

→ [SERVICES.md — Padrões de Erro](./SERVICES.md#padrões-de-erro-ml-e-tratamento)

### "Qual é o campo Z do banco?"

→ [SERVICES-REFERENCE.md — Database Tables](./SERVICES-REFERENCE.md#database-tables-supabase)

### "Como debugar erro A?"

→ [SERVICES-EXAMPLES.md — Troubleshooting](./SERVICES-EXAMPLES.md#troubleshooting-guia)

### "Qual é a query SQL para B?"

→ [SERVICES-REFERENCE.md — Debugging Commands](./SERVICES-REFERENCE.md#debugging-commands)

### "Qual é a variável de env C?"

→ [SERVICES-REFERENCE.md — Environment Checklist](./SERVICES-REFERENCE.md#environment-checklist)

---

## Mantendo Documentação Atualizada

### Quando Adicionar Documentação

- [ ] Nova função → Adicionar a SERVICES.md + SERVICES-REFERENCE.md
- [ ] Novo erro → Adicionar tabela em SERVICES.md + exemplo em SERVICES-EXAMPLES.md
- [ ] Nova feature → Adicionar exemplo em SERVICES-EXAMPLES.md
- [ ] Novo schema → Adicionar a DATABASE.md
- [ ] Bug fix → Documentar em error-history.yaml (se disponível)

### Como Contribuir

1. **Código:** Implementar feature/fix
2. **Documentação:** Atualizar docs correspondentes
3. **Exemplo:** Adicionar exemplo prático em SERVICES-EXAMPLES.md
4. **Reference:** Atualizar assinaturas em SERVICES-REFERENCE.md
5. **Commit:** `git commit -m "docs: Update SERVICES.md for feature X"`

---

## Recursos Adicionais

### Documentação Relacionada

- **Código Source:** `app/services/` (ml_api.py, item_copier.py, etc.)
- **Routers:** `app/routers/` (copy.py, compat.py, etc.)
- **Tests:** Não existe suite formal — relies em acceptance testing

### Ferramentas Úteis

- **Supabase Console:** Database schema, api_debug_logs
- **Mercado Livre Dev Center:** OAuth app config, rate limits
- **Stripe Dashboard:** Billing, webhooks
- **Docker:** `docker build -t copy-anuncios . && docker run -p 8000:8000 copy-anuncios`

### Links Externos

- [Mercado Livre API Docs](https://developers.mercadolibre.com.br/es_ar/items-y-anuncios)
- [Supabase Docs](https://supabase.com/docs)
- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [React 19 Docs](https://react.dev)

---

## FAQ Documentação

### Qual documento devo ler primeiro?

→ [INDEX.md](./INDEX.md) para leitura recomendada por nível. Iniciante = 1-2h.

### Não entendo o fluxo de copy

→ Ler [SERVICES-EXAMPLES.md — Exemplo 1](./SERVICES-EXAMPLES.md#1-copy-simples-de-item) depois [SERVICES.md — Loop de Retry](./SERVICES.md#loop-de-retry).

### Como debugar um erro que não está documentado?

→ [SERVICES-EXAMPLES.md — Análise de api_debug_logs](./SERVICES-EXAMPLES.md#análise-de-api_debug_logs) — query para encontrar padrão, depois [SERVICES.md — Padrões de Erro](./SERVICES.md#padrões-de-erro-ml-e-tratamento) para referência.

### Preciso fazer uma change rápida — qual doc?

→ [SERVICES-REFERENCE.md](./SERVICES-REFERENCE.md) — cheat sheet rápido com assinaturas.

### Docs estão desatualizados com o código?

→ File an issue ou PRs bem-vindas. Docs devem ser mantidas atualizadas com código (veja "Mantendo Documentação Atualizada" acima).

---

## Última Atualização

**Data:** 2026-03-05
**Documentação Criada:** SERVICES.md, SERVICES-EXAMPLES.md, SERVICES-REFERENCE.md, INDEX.md
**Status:** Completo e pronto para uso

Para atualizações mais recentes, consulte git log:
```bash
git log --oneline docs/ | head -10
```

---

## Contato / Suporte

Para dúvidas ou sugestões sobre documentação:
- Criar issue no repositório
- Consultar documentação existente
- Contribuir com atualizações via PR

---

**Bem-vindo! Comece por [INDEX.md](./INDEX.md) ou [SERVICES-EXAMPLES.md](./SERVICES-EXAMPLES.md).**
