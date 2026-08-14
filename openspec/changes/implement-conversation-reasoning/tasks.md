## 1. Setup

- [x] 1.1 Adicionar o SDK oficial da Anthropic (`@anthropic-ai/sdk`) às dependências do `package.json`
- [x] 1.2 Definir o formato do arquivo de configuração externo (system prompt + nome do modelo) e criar um exemplo versionado (ex.: `config/reasoning.yaml` ou similar) — implementado como `config/reasoning.json` (JSON simples, sem dependência nova de parser)
- [x] 1.3 Criar `src/reasoning/infrastructure/reasoningConfig.ts`: carrega e valida o arquivo de configuração (system prompt + modelo) na inicialização, falhando de forma clara se o arquivo estiver ausente/malformado
- [x] 1.4 Garantir que a aplicação falhe rápido na inicialização se `ANTHROPIC_API_KEY` não estiver definida

## 2. Domínio (`src/reasoning/domain/`)

- [x] 2.1 Criar `conversation.ts`: entidade `Conversation` (chave `sessionId` + JID do lead, lista ordenada de turnos com papel/texto/timestamp, última intenção classificada) com método para adicionar um novo turno
- [x] 2.2 Testes automatizados de `Conversation` (adicionar turnos, manter ordem, atualizar última intenção)
- [x] 2.3 Criar `reasoningRepository.ts`: interface `ReasoningRepository` com `reason(input): Promise<ReasoningResult>`, onde `ReasoningResult` é `{ replyText, intent }` e `intent` cobre os 4 valores do RF-04
- [x] 2.4 Criar `conversationRepository.ts`: interface `ConversationRepository` com métodos para carregar e salvar uma `Conversation` por `(sessionId, leadJid)`

## 3. Infraestrutura (`src/reasoning/infrastructure/`)

- [x] 3.1 Criar `claudeReasoningRepository.ts`: implementa `ReasoningRepository` usando o SDK da Anthropic, enviando o histórico da `Conversation` + o system prompt/modelo carregados de `reasoningConfig`, usando tool use / structured output para obter `intent` como enum confiável
- [x] 3.2 Testes automatizados de `ClaudeReasoningRepository` (mockando o cliente Anthropic): mapeia corretamente histórico → payload da API, e resposta estruturada da API → `{ replyText, intent }`
- [x] 3.3 Criar `fileConversationRepository.ts`: implementa `ConversationRepository` persistindo cada conversa em arquivo local (um arquivo por `sessionId`/lead), seguindo o mesmo padrão de `WarmupTracker`/`DailyVolumeLimiter`
- [x] 3.4 Testes automatizados de `FileConversationRepository` (criação, leitura, atualização de uma conversa existente, persistência sobrevive a uma nova instância apontando pro mesmo arquivo)

## 4. Aplicação (`src/reasoning/application/`)

- [x] 4.1 Criar `processIncomingMessage.ts`: caso de uso que recebe `(sessionId, leadJid, text)`, carrega a `Conversation` via `ConversationRepository`, chama `ReasoningRepository.reason(...)`, adiciona o turno recebido e o turno de resposta (com a intenção classificada) à conversa, salva via `ConversationRepository`, e entrega `replyText` a uma função de envio injetada (mesmo padrão de callback já usado na composição da `SendQueue`)
- [x] 4.2 Testes automatizados de `processIncomingMessage` (com fakes de `ReasoningRepository`/`ConversationRepository`/função de envio): fluxo feliz, e intenção `opt_out` classificada não impede o envio da resposta gerada (conforme spec — apenas persistida, sem alterar o comportamento)

## 5. Integração com WhatsApp

- [x] 5.1 `WhatsAppSession`: adicionar evento `message`, filtrando `messages.upsert` para excluir mensagens de grupo e mensagens `fromMe`, emitindo `{ sessionId, from, text, timestamp }`
- [x] 5.2 Testes automatizados do novo filtro em `session.test.ts` (mensagem 1:1 emite `message`; mensagem de grupo não emite; mensagem `fromMe` não emite)
- [x] 5.3 Em `src/index.ts`: registrar um listener do evento `message` da sessão pareada, chamando `processIncomingMessage` com a função de envio apontando para `sendQueue.enqueue(...)` (a mesma fila já usada para o envio manual via stdin)

## 6. Verificação

- [x] 6.1 Rodar a suíte automatizada completa (`npm test`) e confirmar que tudo passa — 49/49 testes passando
- [ ] 6.2 QA manual: parear uma sessão real, mandar uma mensagem de teste de outro número para o número pareado, e confirmar que o bot responde de forma contextual; mandar uma segunda mensagem e confirmar que a resposta considera o histórico da primeira
- [ ] 6.3 QA manual: reiniciar o processo entre as duas mensagens do teste acima e confirmar que o histórico da conversa (e portanto o contexto da resposta) sobrevive ao reinício
