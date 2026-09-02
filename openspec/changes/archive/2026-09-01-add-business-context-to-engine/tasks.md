## 1. Curadoria da base de conhecimento

- [x] 1.1 Definir o catálogo estável de módulos (ids kebab-case) e o split `base` / `extra` conforme o explore; registrar em um único ponto reutilizável (ex.: `domain/product-catalog.ts`)
- [x] 1.2 Curar `docs/payloads/*.txt` em `src/conversation-engine/infrastructure/knowledge/sales-knowledge.md`: deduplicar, seccionar por `====`, e anexar metadados por trecho (`module`, `tier`, `kind`)
- [x] 1.3 Criar `src/conversation-engine/infrastructure/knowledge/pricing.md` com os dois planos (Essencial R$ 300/mês; Personalizado R$ 500/mês = base + R$ 200), termos do lançamento e a regra "sem contratação avulsa dos módulos extra"
- [x] 1.4 Marcar como `pinned` os trechos `kind ∈ {guardrail, preco}` + posicionamento curto (metadado ou convenção de seção)
- [x] 1.5 Escrever `synonyms.pt-br.ts` com o mapa inicial de jargão de campo → termos/ids de módulo

## 2. Configuração

- [x] 2.1 Adicionar em `infrastructure/config/env.ts`: `KNOWLEDGE_DIR` (default `./src/conversation-engine/infrastructure/knowledge`), `RETRIEVAL_TOP_K`, `RETRIEVAL_MIN_SCORE`, `EXTRACTION_LLM_MODEL` (default modelo barato)
- [x] 2.2 Atualizar `.env` de exemplo e `env.test.ts`

## 3. Índice léxico e recuperação

- [x] 3.1 Implementar o parser de `sales-knowledge.md` → lista de trechos com metadados; falhar com erro descritivo se um trecho não tiver os metadados exigidos ou se nenhum trecho for reconhecido
- [x] 3.2 Implementar tokenização PT-BR (lowercase, remoção de acentos, stopwords, stemming leve) e expansão por `synonyms.pt-br.ts`
- [x] 3.3 Implementar `lexical-index.ts`: índice BM25 em memória sobre os trechos da fatia variável, com `search(query, { topK, minScore })` retornando trechos dedupe por seção
- [x] 3.4 Implementar montagem do conjunto `pinned` obrigatório (posicionamento curto + guardrails + `pricing.md`)

## 4. Port e adapters de contexto de negócio

- [x] 4.1 Criar `application/ports/business-context.port.ts` (`getContext({ conversation, newMessages }): Promise<string>`)
- [x] 4.2 Implementar `infrastructure/knowledge/lexical-retrieval.business-context.ts`: chamada #1 de extração de sinais via `LlmClientPort`; fallback para extração local em caso de falha/vazio; busca no índice; retorno de `pinned` + trechos recuperados como string
- [x] 4.3 Implementar `infrastructure/knowledge/static.business-context.ts` (KB inteiro + `pricing.md`) para testes / A-B — sem fiação como fallback de runtime
- [x] 4.4 Definir o prompt/contrato da chamada #1 (saída estruturada: `temas[]`, `dores[]`, `modulosProvaveis[]`); garantir que intenção/qualificação NÃO saem dela

## 5. Schema da decisão e persistência

- [x] 5.1 Estender `domain/bot-decision.ts`: `botDecisionSchema` (zod) + `BOT_DECISION_JSON_SCHEMA` com `recommendedModules`, `interestedModules`, `quotedPlan` (`essencial|personalizado|null`); todos em `required` no JSON Schema
- [x] 5.2 Estender `domain/conversation-turn.ts` (outbound) para serializar/desserializar os campos, com default `[]` / `null` quando ausentes
- [x] 5.3 Estender `domain/conversation.ts`: `applyDecision` grava os campos no turno e atualiza o agregado; `toJSON`/`fromJSON` incluem os campos com defaults retrocompatíveis
- [x] 5.4 Atualizar o contrato de saída no texto da persona (`reply-strategy.prompt.md`) para os 3 campos novos

## 6. Composição do prompt e persona

- [x] 6.1 Alterar `domain/reply-strategy.ts`: `buildRequest(conversation, newMessages, businessContext)` compõe `system` = persona + `pinned` (bloco cacheável) seguido dos trechos recuperados (bloco não cacheável)
- [x] 6.2 Aplicar `cache_control` no bloco persona + `pinned` na chamada da `AnthropicLlmClient` (ou via `LlmRequest`)
- [x] 6.3 Reescrever `reply-strategy.prompt.md`: condução consultiva (sondar dor antes de ofertar, 1 pergunta por mensagem), enquadramento nos planos Essencial/Personalizado, formato WhatsApp (curto/intermediário; ficha estruturada só sob pedido), guardrails de produto, política de preço (citar planos; negociação → handoff), descrição de "Personalizado" como plano que libera todos os módulos

## 7. Fiação e boot

- [x] 7.1 Em `main.ts`: construir o índice a partir de `KNOWLEDGE_DIR`; abortar a inicialização (log + exit) se o preparo falhar; não subir o servidor nesse caso
- [x] 7.2 Em `main.ts`: instanciar `LexicalRetrievalBusinessContext` (com `LlmClientPort` do modelo de extração) e injetá-lo na `GenerateReplyUseCase`
- [x] 7.3 Alterar `GenerateReplyUseCase.execute`: chamar `businessContextProvider.getContext(...)` antes de `replyStrategy.buildRequest` e repassar a string
- [x] 7.4 Adicionar script `knowledge:validate` (npm) que roda o parser + checagem de metadados + contagem mínima; incluir no CI

## 8. Testes e avaliação

- [x] 8.1 Testes de unidade do parser de `sales-knowledge.md` (feliz + malformado + sem metadados + vazio)
- [x] 8.2 Testes do índice BM25 e da tokenização/sinônimos
- [x] 8.3 Teste de avaliação de recuperação (determinístico, sem LLM): conjunto golden dos ~18 pares fala→módulos dos payloads; afere `recall@k`
- [x] 8.4 Testes do `LexicalRetrievalBusinessContext`: chamada #1 ok; chamada #1 falha → extração local; busca vazia → só `pinned`; `pinned` sempre presente
- [x] 8.5 Atualizar `bot-decision.test.ts`, `conversation.test.ts`, `generate-reply.use-case.test.ts` para os campos novos e para o passo de contexto de negócio
- [x] 8.6 Teste de retrocompatibilidade: carregar um JSON de conversa sem os campos novos sem erro
- [x] 8.7 Teste de boot fail-fast: `KNOWLEDGE_DIR` inexistente/malformado → inicialização aborta

## 9. Validação OpenSpec

- [x] 9.1 `openspec validate add-business-context-to-engine --strict` sem erros
- [x] 9.2 Revisar `proposal.md` / `design.md` / `specs` contra a implementação final e ajustar divergências antes do archive
