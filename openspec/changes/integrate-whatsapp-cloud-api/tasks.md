## 1. Scaffolding do projeto

- [x] 1.1 Inicializar `package.json` e configurar TypeScript (`tsconfig.json`)
- [x] 1.2 Adicionar dependências: `fastify`, `zod`; dependências de dev: `typescript`, `vitest`, `@types/node`
- [x] 1.3 Configurar scripts npm (`dev`, `build`, `start`, `test`)
- [x] 1.4 Configurar lint/format do projeto
- [x] 1.5 Criar esqueleto de pastas `src/whatsapp-connectivity/{domain,application,infrastructure}`

## 2. Configuração de ambiente

- [x] 2.1 Implementar `infrastructure/config/env.ts` com schema zod validando todas as variáveis obrigatórias, falhando rápido no boot se faltar alguma
- [x] 2.2 Preencher `META_PHONE_NUMBER_ID`, `META_WABA_ID` e `META_WEBHOOK_VERIFY_TOKEN` no `.env` local

## 3. Domínio

- [x] 3.1 Implementar VO `OutboundMessage` (template, idioma, parâmetros, número E.164) com validação
- [x] 3.2 Implementar VO `InboundMessage` (remetente, id da mensagem, texto, timestamp)
- [x] 3.3 Implementar VO/tipo para atualização de status (id da mensagem, novo status)

## 4. Envio outbound

- [x] 4.1 Definir `WhatsAppGatewayPort` em `application/ports/`
- [x] 4.2 Implementar `SendOutboundMessageUseCase`
- [x] 4.3 Implementar `MetaCloudApiGateway` (infrastructure) chamando a Graph API
- [x] 4.4 Testes unitários do use case com um fake do gateway (Vitest)

## 5. Webhook inbound

- [x] 5.1 Configurar Fastify com `addContentTypeParser` para capturar o corpo bruto (`rawBody`) na rota do webhook
- [x] 5.2 Implementar `webhook-signature.guard.ts` validando `X-Hub-Signature-256` com o App Secret
- [x] 5.3 Implementar handshake de verificação (`GET /webhooks/whatsapp`) validando `hub.verify_token`
- [x] 5.4 Implementar schema zod que discrimina `messages[]` vs `statuses[]` no payload recebido
- [x] 5.5 Implementar `HandleInboundMessageUseCase` (normaliza e loga a mensagem recebida)
- [x] 5.6 Implementar handler de atualização de status (normaliza e loga)
- [x] 5.7 Implementar rota `POST /webhooks/whatsapp` respondendo 200 imediatamente após validar e despachar o evento
- [x] 5.8 Testes unitários dos use cases e do parsing/discriminação de eventos com Vitest

## 6. Composition root

- [x] 6.1 Implementar `main.ts`: instanciar gateway e use cases, registrar rotas no Fastify e subir o servidor

## 7. Validação manual (QA)

- [ ] 7.1 Subir um túnel público (ex.: ngrok) apontando para o servidor local
- [ ] 7.2 Configurar a Callback URL e o Verify Token no painel do Meta for Developers e confirmar o handshake de verificação
- [ ] 7.3 Enviar o template `hello_world` via `SendOutboundMessageUseCase` para o número de teste e confirmar recebimento no celular
- [ ] 7.4 Responder pelo celular e confirmar que o webhook recebe, valida a assinatura e loga a mensagem normalizada
- [ ] 7.5 Confirmar que uma atualização de status (ex.: "delivered") é reconhecida e logada corretamente, sem ser confundida com mensagem recebida
