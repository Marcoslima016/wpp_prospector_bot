## 1. Domínio

- [x] 1.1 Criar `src/whatsapp-connectivity/domain/outbound-text-message.ts` — VO `OutboundTextMessage` com schema zod (`to` no formato E.164 reaproveitando o `E164_REGEX`; `body` string com `min(1)` e `max(4096)`) e factory estática `create` que lança `DomainValidationError` em caso de input inválido
- [x] 1.2 Criar `src/whatsapp-connectivity/domain/outbound-text-message.test.ts` — casos: input válido; `body` vazio; `body` com 4097 caracteres; `to` fora do formato E.164

## 2. Aplicação

- [x] 2.1 Adicionar `sendTextMessage(message: OutboundTextMessage): Promise<SentMessage>` à interface `WhatsAppGatewayPort` em `src/whatsapp-connectivity/application/ports/whatsapp-gateway.port.ts`
- [x] 2.2 Criar `src/whatsapp-connectivity/application/use-cases/send-text-message.use-case.ts` — `SendTextMessageUseCase` recebe o gateway via construtor; `execute(input)` monta o VO com `OutboundTextMessage.create` e delega a `gateway.sendTextMessage`
- [x] 2.3 Criar `src/whatsapp-connectivity/application/use-cases/send-text-message.use-case.test.ts` — com fake gateway: envio bem-sucedido retorna `wamid`; erro do gateway (`WhatsAppApiError`) é propagado; input inválido é rejeitado antes de o gateway ser chamado

## 3. Infraestrutura

- [x] 3.1 Refatorar `src/whatsapp-connectivity/infrastructure/gateways/meta-cloud-api.gateway.ts` — extrair helper privado compartilhado que, dada uma `Response`, trata `response.ok`, extrai o `wamid` e constrói `WhatsAppApiError` a partir do corpo de erro; aplicar em `sendTemplateMessage` sem mudar seu comportamento
- [x] 3.2 Implementar `sendTextMessage` em `MetaCloudApiGateway` — `POST /{phoneNumberId}/messages` com corpo `{ messaging_product: "whatsapp", to, type: "text", text: { body } }`, reutilizando o helper de 3.1 e o mesmo tratamento de falha de rede (`WhatsAppApiError` com `cause`)
- [x] 3.3 Estender `src/whatsapp-connectivity/infrastructure/gateways/meta-cloud-api.gateway` (arquivo de teste correspondente) com `fetch` mockado — envio bem-sucedido; resposta de erro da Cloud API (status não-ok com `error.message`/`error.code`); falha de rede; resposta sem `wamid`

## 4. Composition root

- [x] 4.1 Em `src/main.ts`, instanciar `SendTextMessageUseCase` com o `gateway` e exportá-lo para validação manual de QA, espelhando o comentário e o padrão de `sendOutboundMessage`

## 5. Validação

- [x] 5.1 Rodar `npm test` e `npm run lint` — tudo verde
- [ ] 5.2 QA manual: enviar uma mensagem de texto para o número de teste com a janela de 24h aberta (responder pelo celular antes) e confirmar recebimento no aparelho + retorno de `wamid`
- [x] 5.3 Rodar `openspec validate add-session-text-messaging --strict` sem erros
