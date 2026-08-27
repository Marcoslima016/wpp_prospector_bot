## Why

O branch `poc/oficial_api` fixou a API oficial da Meta (WhatsApp Business Platform/Cloud API) como conectividade WhatsApp, substituindo as bibliotecas não-oficiais usadas antes (whatsapp-web.js, Baileys), cuja implementação foi integralmente removida. Hoje não existe nenhum código, projeto Node/TypeScript ou integração com a Cloud API neste repositório — sem essa fundação de transporte (enviar e receber mensagens), nenhuma funcionalidade de prospecção (leads, campanhas, raciocínio via LLM) pode ser construída.

## What Changes

- Scaffolding do projeto Node.js/TypeScript: `package.json`, `tsconfig`, ferramentas de lint/format, Fastify como framework HTTP, `zod` para validação, `vitest` como test runner.
- Esqueleto de pastas em Clean Architecture (domain/application/infrastructure) para a nova capability.
- Envio de uma mensagem de template outbound via Graph API (WhatsApp Cloud API).
- Recebimento de eventos inbound via webhook HTTP: handshake de verificação (`GET` com `hub.challenge`), validação de assinatura do payload (`X-Hub-Signature-256` usando o App Secret) e parsing de mensagens recebidas e atualizações de status de entrega.
- Sem persistência, sem gestão de leads/campanhas, sem raciocínio via LLM — este change entrega só a camada de transporte (walking skeleton), validada manualmente contra o número de teste já provisionado no Meta for Developers.

## Capabilities

### New Capabilities
- `whatsapp-connectivity`: enviar mensagens de template via WhatsApp Cloud API e receber/verificar eventos inbound (mensagens e status) via webhook.

### Modified Capabilities
(nenhuma — esta é a primeira change do repositório, `openspec/specs/` está vazio)

## Impact

- **Código novo**: `src/main.ts` (composition root), `src/whatsapp-connectivity/{domain,application,infrastructure}/**`.
- **Dependências novas**: `fastify`, `zod`, `vitest`, toolchain TypeScript.
- **Configuração nova**: variáveis de ambiente em `.env` (já criado localmente, fora do git) — token de acesso, app secret, phone number ID, WABA ID, webhook verify token.
- **Dependência externa**: Meta App + WhatsApp Business Account de teste já provisionados no Meta for Developers, com número de teste ativo.
- **Sem impacto** em outras capabilities — não há nenhuma outra ainda neste repositório.
