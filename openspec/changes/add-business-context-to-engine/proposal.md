## Why

O motor de conversas já interpreta mensagens do lead e responde de forma contínua, mas
não conhece **o que a empresa vende**. Todo o contexto comercial hoje é genérico
("uma solução digital para PMEs") e vive fixo no prompt de persona. Para operar de verdade
na prospecção do ecossistema **Obra na Mão / FluxoDRE**, o bot precisa dominar os módulos,
o público, o mapa dor→solução, os dois planos comerciais e seus preços — e conduzir a
conversa como um vendedor consultivo, não como um catálogo.

## What Changes

- **Base de conhecimento do negócio versionada**: os dois payloads de `docs/payloads/`
  são curados e deduplicados em `sales-knowledge.md` (seccionado, com metadados por chunk)
  e `pricing.md`, sob `src/conversation-engine/infrastructure/knowledge/`.
- **Recuperação de contexto por RAG léxico local** (2 chamadas ao LLM):
  - índice **BM25 em memória**, construído no boot a partir dos `.md`;
  - **chamada #1** extrai sinais de busca da mensagem do lead (`temas`, `dores`,
    `módulos prováveis`) — com fallback para extração local por keywords + mapa de
    sinônimos PT-BR se a chamada falhar;
  - busca BM25 → top-k chunks da fatia variável do conhecimento;
  - **chamada #2** gera a `BotDecision` com persona + chunks fixos (`pinned`) + chunks
    recuperados + histórico.
- **Novo port `BusinessContextProvider`** entre o use case e a fonte do contexto, com
  adapter `LexicalRetrievalBusinessContext` (produção) e `StaticBusinessContext`
  (testes / A-B; **não** é fallback automático de runtime).
- **Fail-fast no boot**: se o índice não construir (arquivo ausente, `.md` malformado,
  metadado de seção faltando), o processo não sobe — mesma postura dos loaders de env.
  Acompanha um check `knowledge:validate` para CI.
- **`BotDecision` ganha 3 campos** (**BREAKING** no contrato de saída do LLM e no formato
  persistido da conversa): `recommendedModules: string[]`, `interestedModules: string[]`,
  `quotedPlan: "essencial" | "personalizado" | null`. Persistidos por turno e no agregado.
- **Persona (`reply-strategy.prompt.md`) reescrita** para: condução consultiva
  (entender a dor antes de ofertar), enquadramento nos dois planos, formato de resposta
  para WhatsApp (curto/intermediário; ficha completa só sob pedido), guardrails de produto
  (sem BIM/CompatibilizaBIM/DWG/IFC, sem inventar features, sem prometer economia
  específica, "IA não decide sozinha", recurso futuro ≠ disponível) e nova política de
  preço.
- **Política de preço**: o bot passa a **citar os valores dos planos** (Essencial
  R$ 300/mês; Personalizado R$ 500/mês) a partir de `pricing.md`; negociação e condição
  especial continuam sendo `handoffToHuman`.
- **`ReplyStrategy.buildRequest`** passa a compor `system = persona + pinned` (com
  `cache_control`) seguido dos chunks recuperados (fora do prefixo cacheado).
- **`main.ts`** passa a construir o índice, o provider e injetá-lo na `GenerateReplyUseCase`.

## Capabilities

### New Capabilities
<!-- Nenhuma capability nova: a organização de specs do projeto é por slice/bounded context
     (conversation-engine, whatsapp-connectivity). Toda a mudança de comportamento cai
     dentro do slice conversation-engine. -->

### Modified Capabilities
- `conversation-engine`: adiciona requisitos de **base de conhecimento do negócio**,
  **recuperação de contexto por RAG léxico**, **conhecimento de produto e planos
  comerciais**, **condução de venda consultiva**, **guardrails de produto** e
  **política de preço**; e altera os requisitos existentes **"Interpretação de Mensagem
  Recebida via LLM"** (fluxo de 2 chamadas com contexto de negócio recuperado) e
  **"Formato Estruturado da Decisão do Bot"** (3 campos novos).

## Impact

- **Código**:
  - `src/conversation-engine/domain/` — `bot-decision.ts` (schema + `BOT_DECISION_JSON_SCHEMA`),
    `conversation.ts` e `conversation-turn.ts` (persistir campos novos),
    `reply-strategy.ts` (compor contexto de negócio), `reply-strategy.prompt.md` (reescrita).
  - `src/conversation-engine/application/` — novo `ports/business-context.port.ts`;
    `use-cases/generate-reply.use-case.ts` (chamar o provider antes do `buildRequest`).
  - `src/conversation-engine/infrastructure/` — novo diretório `knowledge/`
    (`sales-knowledge.md`, `pricing.md`, `lexical-index.ts`, `synonyms.pt-br.ts`,
    `lexical-retrieval.business-context.ts`, `static.business-context.ts`).
  - `src/main.ts` — fiação do índice + provider; boot fail-fast.
  - `src/conversation-engine/infrastructure/config/env.ts` — variáveis novas
    (ex.: `KNOWLEDGE_DIR`, `RETRIEVAL_TOP_K`, `RETRIEVAL_MIN_SCORE`, modelo da chamada #1).
- **Dados persistidos**: arquivos em `data/conversations/*.json` ganham os 3 campos novos
  nos turnos outbound e no agregado. Conversas antigas sem os campos precisam ser lidas
  sem erro (default para listas vazias / `null`).
- **Custo/latência por interpretação**: +1 chamada LLM sequencial (~1–3 s sobre a janela
  de rajada de 8 s); custo de input ~2× (ainda na casa de US$ 0,03), mitigado por
  prompt caching do prefixo persona + pinned.
- **Dependências**: nenhuma nova de runtime obrigatória (BM25 pode ser implementação
  própria sobre o corpus pequeno). Possível dependência utilitária de tokenização/stemming
  PT-BR — decidir no design.
- **Fora de escopo**: mensagens não-texto (áudio/imagem) continuam descartadas em
  `HandleInboundMessageUseCase`; agendamento de demo e envio de material continuam via
  `handoffToHuman`.
