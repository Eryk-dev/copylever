# PRD: Experiencia do Cliente — Onboarding e Pagamento

## Introducao

Depois de implementar o paywall, o fluxo do cliente funciona mas tem varios pontos de friccao: nao detecta pagamento automaticamente, nao mostra preco, nao tem guia de primeiro uso, nao tem "esqueci minha senha", e a pagina de cadastro nao explica o produto. Este PRD cobre todas as melhorias necessarias para uma experiencia de cliente profissional.

## Objetivos

- Cliente completa o fluxo cadastro → pagamento → primeiro uso sem precisar de suporte
- Zero friccao no retorno do Stripe (deteccao automatica de pagamento)
- Informacoes claras sobre preco antes de assinar
- Recuperacao de senha self-service
- Primeira impressao profissional na pagina de cadastro

## User Stories

### US-001: Detectar pagamento apos retorno do Stripe

**Descricao:** Como cliente que acabou de pagar no Stripe, quero que o sistema detecte meu pagamento automaticamente para que eu nao fique preso na tela de paywall.

**Acceptance Criteria:**
- Quando o usuario retorna do Stripe com `?billing=success` na URL, o app faz polling do GET /api/billing/status a cada 2 segundos (maximo 10 tentativas)
- Quando `payment_active` retorna `true`, o paywall desaparece e o usuario ve o sistema
- Se apos 10 tentativas ainda nao ativou, mostra mensagem "Pagamento em processamento. Atualize a pagina em alguns segundos."
- O parametro `?billing=success` e removido da URL apos processamento (sem recarregar a pagina)
- Se retorna com `?billing=cancel`, mostra mensagem "Assinatura cancelada" na tela de paywall
- Typecheck passa

### US-002: Mostrar preco na tela de paywall

**Descricao:** Como cliente na tela de assinatura, quero ver o preco antes de clicar em "Assinar" para que eu saiba quanto vou pagar.

**Acceptance Criteria:**
- A tela de paywall mostra "R$ 349,90/mes" acima do botao de assinar
- O texto fica: "Plano mensal — R$ 349,90/mes"
- O valor e hardcoded no frontend (nao precisa buscar do Stripe)
- O BillingPage.tsx tambem mostra o preco quando `payment_active` e false
- Typecheck passa

### US-003: Guia de primeiro uso apos pagamento

**Descricao:** Como cliente que acabou de pagar, quero ver um guia rapido para que eu saiba como comecar a usar o sistema.

**Acceptance Criteria:**
- Apos o pagamento ser detectado (transicao de paywall para o app), mostra um card de boas-vindas no topo da pagina
- O card tem 3 passos: "1. Conecte sua conta ML (aba Admin > Sellers)" → "2. Cole os IDs dos anuncios" → "3. Selecione origem e destino e clique Copiar"
- O card tem um botao "Entendi" que o fecha
- O estado "ja viu o guia" e salvo no localStorage para nao mostrar de novo
- Typecheck passa

### US-004: Melhorar pagina de cadastro

**Descricao:** Como visitante, quero entender o que o produto faz na pagina de cadastro para que eu tenha confianca em criar uma conta.

**Acceptance Criteria:**
- Acima do formulario, adicionar subtitulo: "Copie anuncios e compatibilidades entre contas do Mercado Livre"
- Abaixo do subtitulo, 3 bullet points curtos: "Copia em massa entre contas", "Compatibilidades veiculares automaticas", "Gerenciamento multi-conta"
- Abaixo do formulario (antes do link "Ja tem conta?"), adicionar texto: "Plano mensal: R$ 349,90/mes"
- Manter o mesmo design system (CSS variables, cores, espacamento)
- Typecheck passa

### US-005: Esqueci minha senha — Backend

**Descricao:** Como desenvolvedor, quero endpoints de reset de senha para que clientes possam recuperar acesso sem suporte.

**Acceptance Criteria:**
- POST /api/auth/forgot-password aceita `{email}` — busca usuario por email, gera token de reset (secrets.token_urlsafe(32)), salva na tabela `password_reset_tokens` com expiracao de 1 hora, retorna 200 `{message: "Se o email existir, enviaremos instrucoes"}` (mensagem generica por seguranca)
- POST /api/auth/reset-password aceita `{token, new_password}` — valida token nao expirado, atualiza password_hash do usuario, deleta o token, retorna 200
- Criar migration 009_password_reset_tokens.sql: tabela password_reset_tokens (id serial PK, user_id UUID FK, token TEXT UNIQUE, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now())
- Validacao: new_password minimo 6 caracteres
- Token expira em 1 hora
- Typecheck passa

### US-006: Esqueci minha senha — Frontend

**Descricao:** Como cliente que esqueceu a senha, quero um fluxo na tela de login para redefinir minha senha.

**Acceptance Criteria:**
- Na tela de Login, adicionar link "Esqueci minha senha" abaixo do botao de entrar
- Clicar abre uma tela (mesmo estilo do login) com campo de email e botao "Enviar link"
- Ao enviar, chama POST /api/auth/forgot-password e mostra mensagem "Se o email existir, enviaremos instrucoes de redefinicao" (fixo, independente da resposta)
- Adicionar pagina de reset: quando a URL tem `?reset_token=xxx`, mostra formulario com "Nova senha" + "Confirmar senha" e botao "Redefinir"
- Ao redefinir com sucesso, mostra "Senha alterada com sucesso" e botao "Ir para login"
- Se token invalido/expirado, mostra "Link expirado. Solicite um novo."
- Typecheck passa

### US-007: Enviar email de reset de senha

**Descricao:** Como sistema, quero enviar um email com o link de reset para que o cliente possa redefinir sua senha.

**Acceptance Criteria:**
- No endpoint forgot-password, apos gerar o token, enviar email para o usuario
- O email contem link: `{BASE_URL}?reset_token={token}`
- Usar um servico simples de email (ex: smtp via config ou Resend API)
- Adicionar variaveis de ambiente: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM (ou RESEND_API_KEY)
- Se as variaveis de email nao estiverem configuradas, logar warning e nao enviar (o endpoint ainda retorna 200 por seguranca)
- O email tem subject "Copy Anuncios — Redefinir senha" e corpo simples com o link
- Typecheck passa

## Requisitos Funcionais

- FR-1: O sistema deve detectar pagamento automaticamente quando o usuario retorna do Stripe
- FR-2: O sistema deve mostrar o preco da assinatura antes do checkout
- FR-3: O sistema deve guiar o novo usuario nos primeiros passos apos pagamento
- FR-4: A pagina de cadastro deve explicar o que o produto faz
- FR-5: O sistema deve permitir redefinicao de senha por email
- FR-6: O sistema deve enviar email com link de redefinicao de senha

## Non-Goals (Fora do Escopo)

- Email de boas-vindas apos cadastro (pode ser adicionado depois)
- Verificacao de email no cadastro
- Planos diferentes (por enquanto so tem um plano)
- Periodo de trial gratuito
- Notificacoes push ou in-app

## Consideracoes Tecnicas

- O preco (R$ 349,90) e hardcoded no frontend — se mudar, atualizar em 2 lugares (paywall e signup)
- O polling apos retorno do Stripe usa intervalo de 2s para nao sobrecarregar a API
- A tabela password_reset_tokens precisa de migration nova (009)
- O envio de email e opcional (graceful degradation se nao configurado)
- O token de reset expira em 1 hora por seguranca

## Metricas de Sucesso

- 0% de clientes presos na tela de paywall apos pagamento
- Clientes completam primeiro uso sem contatar suporte
- Reset de senha funcional sem intervencao manual
