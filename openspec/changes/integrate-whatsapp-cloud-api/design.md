## Context

Repositório vazio (sem `package.json`, sem código-fonte) — ver proposal.md. Esta é a primeira capability implementada no branch `poc/oficial_api`, então este design também fixa a estrutura de projeto (camadas, convenções de pasta, composition root) que changes futuras (gestão de leads, motor de conversa) vão seguir.

Credenciais de um Meta App + WhatsApp Business Account de teste já estão provisionadas e guardadas em `.env` (fora do git): `META_ACCESS_TOKEN`, `META_APP_SECRET`, `META_PHONE_NUMBER_ID`, `META_WABA_ID`, `META_WEBHOOK_VERIFY_TOKEN` (os dois últimos ainda a preencher pelo autor da change antes da validação manual).

## Goals / Non-Goals

**Goals:**
- Estabelecer a estrutura de pastas em Clean Architecture (domain/application/infrastructure) por capability, reutilizável pelas próximas changes.
- Enviar e receber mensagens reais via Cloud API contra o número de teste, validando o desenho ponta a ponta.

**Non-Goals:**
- Persistência de mensagens/conversas (fica para change futura de gestão de leads/conversas).
- Qualquer lógica de negócio sobre o conteúdo das mensagens (raciocínio, qualificação, opt-out) — fica para a change de motor de conversa.
- Rotação entre múltiplos phone numbers ou lógica de fila/throttling de campanha — fora do escopo desta change de transporte.

## Decisions

**Estrutura por capability, não por camada global.** `src/whatsapp-connectivity/{domain,application,infrastructure}` em vez de `src/domain/`, `src/application/` na raiz. Cada capability futura (leads, campanhas, reasoning) ganha sua própria fatia vertical; evita um único diretório `domain/` virar dumping ground de conceitos não relacionados conforme o produto cresce.

**Ports & Adapters dentro de `application/`.** A interface `WhatsAppGatewayPort` fica em `application/ports/`, não em `domain/` — é a aplicação que declara o que precisa do mundo externo (Dependency Inversion clássico de Clean Architecture); o domínio (VOs `OutboundMessage`/`InboundMessage`) não sabe que HTTP ou Graph API existem. `MetaCloudApiGateway` (infrastructure) implementa o port.

**Fastify + zod, sem o type-provider de integração.** Validação via `zod` (`safeParse`) chamada explicitamente dentro dos route handlers e nos DTOs de entrada dos use cases, em vez de usar `@fastify/type-provider-zod` ou o JSON Schema nativo do Fastify (ajv). Alternativa considerada: schema nativo do Fastify (zero dependência extra) — rejeitada porque duplicaria a validação em dois sistemas de schema diferentes (ajv na borda HTTP, zod no domínio); um único mecanismo de validação (zod) reaproveitado em toda a stack (env, DTOs, payload do webhook) é mais simples de manter.

**Corpo bruto capturado antes do parse padrão.** A validação de assinatura (`X-Hub-Signature-256`) precisa do payload como bytes crus. `fastify-server.ts` registra um `addContentTypeParser` para `application/json` que guarda o `rawBody` no request antes do parse, especificamente na rota do webhook — o parse padrão do Fastify (JSON já deserializado) seria tarde demais para calcular o HMAC corretamente.

**Discriminação de eventos do webhook via zod.** O payload da Meta (`entry[].changes[].value`) é parseado com um schema zod que distingue a presença de `messages[]` (mensagem recebida) de `statuses[]` (atualização de status), despachando para `HandleInboundMessageUseCase` ou um handler equivalente de status. Eventos de tipos ainda não suportados são logados e ignorados, sem derrubar a rota.

**Sem persistência nesta change.** `HandleInboundMessageUseCase` e o handler de status apenas validam, normalizam e logam o evento — o armazenamento de conversas fica para a change de gestão de leads/conversas (decisão já tomada de usar arquivo local, não banco, nesse momento futuro).

**Validação de ambiente fail-fast.** `infrastructure/config/env.ts` valida todas as variáveis de ambiente obrigatórias com zod no boot (`main.ts`); o processo falha imediatamente com mensagem clara se `META_PHONE_NUMBER_ID`, `META_WABA_ID` ou `META_WEBHOOK_VERIFY_TOKEN` não estiverem preenchidos, em vez de falhar tarde na primeira chamada à Cloud API.

**Composition root manual, sem framework de DI.** `main.ts` instancia `MetaCloudApiGateway`, injeta nos use cases via construtor, e passa os use cases para as rotas do Fastify. Escala suficiente para o tamanho atual do projeto; introduzir um container de DI seria over-engineering nesta fase.

**Vitest como test runner**, substituindo o `node:test` usado na implementação anterior (removida) — decisão do autor da change, sem necessidade de justificativa técnica adicional além de ergonomia (watch mode, mocking).

## Risks / Trade-offs

- **Teste local do webhook exige túnel público (ngrok/cloudflared)** → mitigação: documentado como tarefa explícita de setup em `tasks.md`, não bloqueia o código em si.
- **Token de acesso hoje é um valor colado manualmente no `.env`** → mitigação já aplicada: `.env` está no `.gitignore`; recomenda-se ao autor considerar regenerar o token, já que passou em texto puro por uma conversa.
- **Dois motores de validação convivendo indiretamente** (zod no código, nada no nível de rede) → mitigação: rejeitado o uso simultâneo do validator nativo do Fastify, conforme decisão acima, para não duplicar regras de schema.
- **Confirmação HTTP 200 antes do processamento completo** (requisito de spec) exige que o handler não faça trabalho pesado de forma síncrona antes de responder — nesta change o processamento é só log, então não há risco real ainda; changes futuras que adicionarem trabalho pesado no handler de inbound precisarão revisitar esse ponto (ex.: mover para fila).

## Migration Plan

Greenfield — não há deploy ou dado existente para migrar. Validação antes de considerar a change concluída:
1. Enviar `hello_world` para o número de teste usando o `SendOutboundMessageUseCase` (não o painel da Meta) e confirmar recebimento no celular.
2. Responder pelo celular e confirmar que o webhook recebe, valida a assinatura e loga a mensagem normalizada.
3. Confirmar que uma atualização de status (ex.: "delivered") também é reconhecida e logada, sem ser confundida com mensagem recebida.

Rollback: reverter os commits da change — nada em produção depende disso ainda.

## Open Questions

- Qual ferramenta de túnel usar em desenvolvimento (ngrok, cloudflared, outra) fica a critério de quem for validar localmente; não afeta specs nem tasks.
- Política de renovação do token de longa duração (antes de expirar) fica para uma change futura de operação/observabilidade — não bloqueia esta entrega.
