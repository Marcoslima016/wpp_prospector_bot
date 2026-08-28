## 1. Setup e configuração

- [x] 1.1 Adicionar `@anthropic-ai/sdk` às dependências em `package.json` e instalar
- [x] 1.2 Adicionar `data/` ao `.gitignore`
- [x] 1.3 Criar `src/conversation-engine/infrastructure/config/env.ts` — schema zod com `ANTHROPIC_API_KEY` (obrigatória), `LLM_MODEL` (default `claude-sonnet-5`), `CONVERSATION_BATCH_WINDOW_MS` (default 8000), `CONVERSATION_HISTORY_TURNS` (default 20), `CONVERSATIONS_DIR` (default `./data/conversations`), `BOOT_SWEEP_MAX_AGE_MS` (default 3600000) + loader `loadConversationEngineEnv`, espelhando o padrão de `whatsapp-connectivity/infrastructure/config/env.ts`
- [x] 1.4 Teste de `loadConversationEngineEnv` — defaults aplicados; ausência de `ANTHROPIC_API_KEY` falha com mensagem clara

## 2. Domínio

- [x] 2.1 Criar `src/conversation-engine/domain/lead-intent.ts` e `lead-qualification.ts` — unions/constantes (`interested | not_interested | needs_more_info | opt_out | off_topic | unknown`; `hot | warm | cold`)
- [x] 2.2 Criar `src/conversation-engine/domain/bot-decision.ts` — VO `BotDecision` com schema zod (`replyMessages: string[]`, `endConversation: boolean`, `leadIntent`, `leadQualification: … | null`, `handoffToHuman: boolean`, `reasoning: string | null`), refinement "`replyMessages` não-vazia sse `shouldReply`" não é necessário (lista vazia = não responde), factory `create` lançando `DomainValidationError`; exportar também o JSON Schema equivalente para uso como `responseSchema`
- [x] 2.3 Teste de `BotDecision` — decisão válida com 0/1/N mensagens; enum inválido; tipos errados
- [x] 2.4 Criar `src/conversation-engine/domain/conversation-turn.ts` — turno com `direction` (`inbound | outbound`), `text`, `timestamp`, `messageId` (inbound), `pendingDecision` (inbound), metadados da decisão (outbound)
- [x] 2.5 Criar `src/conversation-engine/domain/conversation.ts` — agregado identificado pelo telefone E.164, com turnos, `leadIntent`, `leadQualification`, estado do ciclo de vida (`active | ended | awaitingHuman`), conjunto de `messageId` processados; métodos: `createNew`, `recordInboundTurn`, `hasProcessed`, `markPending`/`clearPending`, `applyDecision` (adiciona turnos outbound, atualiza intent/qualificação, aplica `endConversation`/`handoffToHuman`), `reopenIfEnded`, `markPendingAbandoned`, `recentTurns(n)`, `pendingInboundTurns`
- [x] 2.6 Teste de `Conversation` — dedup por `messageId`; `applyDecision` com resposta/sem resposta; `endConversation` seguido de novo inbound reabre; `handoffToHuman` bloqueia processamento e não reabre; corte de `recentTurns`
- [x] 2.7 Criar `src/conversation-engine/domain/reply-strategy.ts` — domain service; construtor recebe o texto do prompt; `buildRequest(conversation, newMessages): LlmRequest` compõe system + histórico recente + lote; expõe o `responseSchema` de `BotDecision`
- [x] 2.8 Teste de `ReplyStrategy` — inclui no máximo N turnos; inclui todas as mensagens do lote; system prompt presente
- [x] 2.9 Criar `src/conversation-engine/domain/reply-strategy.prompt.md` — prompt de prospecção predefinido, extenso, cobrindo: objetivo do produto/oferta, tom, interpretação de intenção, quando NÃO responder, quando encerrar, quando transferir para humano, tratamento de opt-out, e o contrato de saída estruturada (uma resposta por assunto; múltiplas só para pontos distintos)

## 3. Aplicação — ports

- [x] 3.1 Criar `src/conversation-engine/application/ports/llm-client.port.ts` — `LlmRequest` (`system`, `messages`, `model`, `maxTokens`, `responseSchema?`), `LlmResponse`, `LlmClientPort.generate`
- [x] 3.2 Criar `src/conversation-engine/application/ports/conversation-repository.port.ts` — `load(leadPhone)`, `save(conversation)`, `findConversationsWithPendingInbound()`
- [x] 3.3 Criar `src/conversation-engine/application/ports/reply-sender.port.ts` — `send(to: string, body: string): Promise<void>`
- [x] 3.4 Criar `src/whatsapp-connectivity/application/ports/inbound-message.port.ts` — `InboundMessageDto` (`from`, `messageId`, `text`, `timestamp`) e `InboundMessagePort.receive(message: InboundMessageDto): void`

## 4. Aplicação — use case

- [x] 4.1 Criar `src/conversation-engine/application/use-cases/generate-reply.use-case.ts` — `execute(leadPhone, messageIds)`: carrega/cria a `Conversation`, ignora `messageId` já processados, `reopenIfEnded`, monta request via `ReplyStrategy`, chama `LlmClientPort.generate` com retry único + backoff, valida a saída contra `BotDecision` (falha de schema = falha de interpretação), `conversation.applyDecision`, `repository.save`, envia `replyMessages` em sequência via `ReplySenderPort`
- [x] 4.2 Teste de `GenerateReplyUseCase` com fakes — mensagem única → 1 resposta; rajada mesmo assunto → 1 resposta; assuntos distintos → N respostas na ordem; `messageId` duplicado ignorado; falha de LLM após retry → sem resposta + erro logado; saída fora do schema → sem resposta; `endConversation` marca encerrada; `handoffToHuman` envia turno, marca e bloqueia; falha de envio de 1 mensagem não aborta o lote

## 5. Infraestrutura — motor

- [x] 5.1 Criar `src/conversation-engine/infrastructure/llm/anthropic-llm-client.ts` — implementa `LlmClientPort` via `@anthropic-ai/sdk`; usa `output_config.format` a partir de `responseSchema`; modelo e API key da config; mapeia erros do SDK para erro identificável
- [x] 5.2 Teste de `AnthropicLlmClient` — SDK/HTTP mockado: resposta estruturada válida; erro da API; resposta sem conteúdo utilizável
- [x] 5.3 Criar `src/conversation-engine/infrastructure/persistence/file-conversation-repository.ts` — implementa o repositório; um JSON por lead em `CONVERSATIONS_DIR`; escrita atômica (temp + `rename`); (de)serialização do agregado; `findConversationsWithPendingInbound`
- [x] 5.4 Teste de `FileConversationRepository` — diretório temporário: round-trip load/save; criação de novo; varredura de pendentes; escrita concorrente serializada não corrompe o arquivo
- [x] 5.5 Criar `src/conversation-engine/infrastructure/inbound/inbound-batch-coordinator.ts` — implementa `InboundMessagePort`; por lead: persiste inbound como pendente, buffer de ids, `setTimeout` de janela fixa a partir da 1ª pendente, fila serial; ao fechar a janela chama `GenerateReplyUseCase`; pula agendamento se a conversa está `awaitingHuman`; nova rajada durante processamento vai para nova janela enfileirada
- [x] 5.6 Teste de `InboundBatchCoordinator` com timers fake — agrupa mensagens dentro da janela numa só execução; mensagem após a janela abre novo grupo; grupos processados em ordem; `awaitingHuman` só persiste
- [x] 5.7 Criar `src/conversation-engine/infrastructure/sending/reply-sender.adapter.ts` — implementa `ReplySenderPort` embrulhando `SendTextMessageUseCase`; retry único por mensagem; falha após retry → `logger.error`
- [x] 5.8 Teste de `ReplySenderAdapter` — sucesso; falha transitória recuperada no retry; falha persistente logada sem lançar
- [x] 5.9 Criar `src/conversation-engine/infrastructure/boot/pending-inbound-sweeper.ts` — usa `findConversationsWithPendingInbound`; por lead, reenfileira no coordenador se a pendente mais recente < `BOOT_SWEEP_MAX_AGE_MS`, senão `markPendingAbandoned` + `logger.warn`
- [x] 5.10 Teste de `PendingInboundSweeper` — pendência recente reenfileirada; pendência antiga marcada abandonada; conversa sem pendências ignorada

## 6. whatsapp-connectivity — hand-off

- [x] 6.1 Alterar `src/whatsapp-connectivity/application/use-cases/handle-inbound-message.use-case.ts` — receber `InboundMessagePort` por construtor e chamar `receive({ from, messageId, text, timestamp })` após o `logger.info`
- [x] 6.2 Atualizar `handle-inbound-message.use-case.test.ts` — verifica encaminhamento ao port com o DTO correto; tipo não suportado não encaminha; erro do port não quebra o use case (registrado)

## 7. Composition root

- [x] 7.1 Em `src/main.ts` — carregar `loadConversationEngineEnv`; ler `reply-strategy.prompt.md` (via `import.meta.url`); instanciar `ReplyStrategy`, `AnthropicLlmClient`, `FileConversationRepository`, `ReplySenderAdapter` (com `SendTextMessageUseCase`), `GenerateReplyUseCase`, `InboundBatchCoordinator`
- [x] 7.2 Injetar o `InboundBatchCoordinator` como `InboundMessagePort` em `HandleInboundMessageUseCase`
- [x] 7.3 Executar `PendingInboundSweeper` no boot, antes de `app.listen`

## 8. Validação

- [x] 8.1 Rodar `npm test` e `npm run lint` — tudo verde
- [x] 8.2 Rodar `openspec validate add-conversation-engine --strict` sem erros
- [x] 8.3 QA manual — responder pelo celular e confirmar resposta coerente do bot; enviar 3 mensagens em rajada sobre o mesmo assunto → 1 resposta; enviar mensagens sobre assuntos distintos → múltiplas respostas ordenadas; reenviar evento (dedup) → sem segunda resposta; encerrar o processo durante a janela e reiniciar → varredura de boot responde a pendência recente
