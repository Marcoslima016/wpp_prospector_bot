## Why

Hoje o sistema recebe e normaliza mensagens de leads (`HandleInboundMessageUseCase`), mas apenas as loga — não há nenhuma resposta. O produto (ver `CLAUDE.md` — Visão do produto) depende de interpretar a mensagem do lead via LLM e responder dando seguimento à conversa. Esta change entrega o primeiro comportamento de resposta autônoma: ao receber mensagem(ns) de um lead, o bot interpreta o conteúdo com a API da Anthropic seguindo um prompt de negócio predefinido e envia a resposta pela conversa do WhatsApp.

## What Changes

- **Nova capability `conversation-engine`**: dado o histórico de uma conversa e uma ou mais mensagens novas do lead, produzir uma decisão estruturada (`BotDecision`) e enviar as respostas resultantes.
- **Agregado `Conversation` persistido** (um arquivo JSON por lead, identidade = telefone E.164): histórico de turnos (inbound/outbound), status do lead (intenção e qualificação), ciclo de vida (ativa/encerrada; **reabre automaticamente** no próximo inbound) e deduplicação por `messageId`.
- **`BotDecision` (Value Object estruturado)**: `replyMessages` (lista ordenada; vazia = não responder), `endConversation`, `leadIntent`, `leadQualification`, `handoffToHuman`, `reasoning`. É o formato de saída exigido da LLM, validado por schema.
- **`ReplyStrategy` (domain service)** detém o prompt predefinido de prospecção (arquivo `.md` injetado no construtor) e monta a requisição para a LLM a partir do histórico recente + lote de mensagens novas.
- **`LlmClientPort`** — abstração fina e agnóstica de provider, com `responseSchema` opcional para saída estruturada — desacopla o motor do cliente LLM concreto. Adapter inicial: **Anthropic** via `@anthropic-ai/sdk` (structured outputs). **BREAKING de dependências**: adiciona `@anthropic-ai/sdk`.
- **Coalescing de rajada**: mensagens do mesmo lead recebidas dentro de uma janela fixa (default 8s, configurável) são interpretadas em conjunto. O bot responde com **uma** mensagem quando as mensagens do lead tratam do mesmo assunto, e com **múltiplas** apenas quando pontos distintos exigem respostas separadas.
- **Envio das respostas em sequência**, cada uma com retry único; falha de envio de uma mensagem é logada sem abortar as demais do lote.
- **Varredura no boot**: mensagens inbound persistidas mas ainda sem decisão de resposta (ex.: processo reiniciou durante a janela de coalescing) são reenfileiradas para processamento.
- **Tratamento de falha da LLM**: retry único com backoff; persistindo a falha, registra erro e segue sem responder (sem mensagem de fallback).
- **`whatsapp-connectivity` passa a encaminhar** cada mensagem inbound normalizada para um port de processamento downstream, implementado pelo motor; fiação manual no composition root (`main.ts`).
- **Novas variáveis de ambiente**: `ANTHROPIC_API_KEY`, `LLM_MODEL` (default `claude-sonnet-5`), `CONVERSATION_BATCH_WINDOW_MS` (default `8000`), `CONVERSATION_HISTORY_TURNS` (default `20`), `CONVERSATIONS_DIR` (default `./data/conversations`).

## Capabilities

### New Capabilities

- `conversation-engine`: interpreta mensagens recebidas de leads via LLM seguindo um prompt de prospecção predefinido, mantém o histórico persistido de cada conversa e decide de forma estruturada se e como o bot responde.

### Modified Capabilities

- `whatsapp-connectivity`: nova requirement — o sistema encaminha cada mensagem inbound normalizada a um processador downstream desacoplado (port), além de continuar a registrá-la; a confirmação HTTP 200 rápida à Meta permanece independente da conclusão desse processamento.

## Impact

- **Código novo**: `src/conversation-engine/{domain,application,infrastructure}` (agregado, VOs, domain service, ports, use case, adapters Anthropic e de persistência em arquivo, coordenador de lote, varredura de boot).
- **Código alterado**: `src/whatsapp-connectivity/application/ports/` (novo port de processamento inbound), `HandleInboundMessageUseCase` (ganha dependência do port), `src/main.ts` (composição do motor + fiação do port), configuração de ambiente (novas variáveis).
- **Dependências**: adiciona `@anthropic-ai/sdk`.
- **APIs externas**: Anthropic Messages API (`messages.create` / `messages.parse` com `output_config.format`).
- **Sistema de arquivos**: escrita em `CONVERSATIONS_DIR` — incluir no `.gitignore`.
- **Depende de**: change `add-session-text-messaging` (consome `SendTextMessageUseCase` via port de envio) — deve estar aplicada e arquivada antes.
- **Limitação conhecida**: o disparo inicial de prospecção (template outbound) não é registrado na conversa nesta change; a primeira resposta a um lead enxerga apenas o lado inbound. Registro de outbound fica para change futura.
