## Why

A capability `whatsapp-connectivity` só sabe enviar mensagens de **template** (`sendTemplateMessage`). O motor de conversa (change seguinte `add-conversation-engine`) precisa enviar respostas de **texto livre** geradas por LLM. Dentro da janela de atendimento de 24h — que é justamente aberta por uma mensagem recebida do lead — a Cloud API permite enviar texto livre (`type: "text"`), sem template. Esta change adiciona esse caminho de envio como camada de transporte, sem nenhuma lógica de negócio sobre o conteúdo.

## What Changes

- Novo Value Object de domínio `OutboundTextMessage` (`to` em E.164, `body` não-vazio com limite de tamanho da Cloud API).
- `WhatsAppGatewayPort` ganha o método `sendTextMessage(message: OutboundTextMessage): Promise<SentMessage>`, ao lado do já existente `sendTemplateMessage`.
- Novo use case `SendTextMessageUseCase` (valida o input, monta o VO, delega ao gateway).
- `MetaCloudApiGateway` implementa `sendTextMessage` via `POST /{phoneNumberId}/messages` com corpo `type: "text"`, reaproveitando o tratamento de erro/`wamid` já existente para template.
- `SendTextMessageUseCase` é exportado pelo composition root (`main.ts`) para validação manual de QA, espelhando o tratamento dado a `SendOutboundMessageUseCase`. Esta change **não** expõe gatilho HTTP para envio — o consumidor real será o motor de conversa via composition root.

## Capabilities

### New Capabilities

Nenhuma.

### Modified Capabilities

- `whatsapp-connectivity`: nova requirement "Envio de Mensagem de Texto de Sessão" — enviar mensagem de texto livre para um número dentro da janela de atendimento, retornando o `wamid` ou propagando erro identificável da Cloud API (mesmo contrato de falha já definido para template).

## Impact

- **Código**: `src/whatsapp-connectivity/domain/` (novo VO), `src/whatsapp-connectivity/application/ports/whatsapp-gateway.port.ts` (novo método), `src/whatsapp-connectivity/application/use-cases/` (novo use case + teste), `src/whatsapp-connectivity/infrastructure/gateways/meta-cloud-api.gateway.ts` (nova chamada), `src/main.ts` (exporta o novo use case).
- **Dependências**: nenhuma nova.
- **APIs externas**: WhatsApp Cloud API `messages` endpoint com `type: "text"` — mesma URL, credenciais e versão de Graph API já usadas para template.
- **Pré-requisito operacional**: envio de texto livre só funciona com a janela de 24h aberta (mensagem recebida do lead nas últimas 24h); fora disso a Cloud API rejeita e o erro é propagado.
- **Habilita**: a change `add-conversation-engine`, que consome `SendTextMessageUseCase` através de um port de envio.
