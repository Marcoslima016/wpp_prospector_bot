# Explore — Contexto de negócio no motor de conversas

> Sessão de discovery (`opsx:explore`). Foco: definir os detalhes da change que adicionará
> ao Bot o conhecimento sobre produto, módulos, valores e comportamentos de prospecção
> específicos do negócio.

## Decisões tomadas nesta sessão

| Tema | Decisão |
|---|---|
| Abordagem de conhecimento | **RAG léxico local** |
| Escopo comercial | **Núcleo FluxoDRE** (base), com os demais módulos como camada "extra" |
| Política de preço do bot | **Cita valores** (dos dois planos) |
| Estrutura de preço | **Valor base + adicional único que libera todos os módulos extra** |

### Reconciliação escopo × preço

Escopo "Núcleo FluxoDRE" (que deixava Artisys Finance, Universidade, Jogos e Assistente de
fora) **e** um modelo de preço em que *um único adicional libera todos os demais módulos*
só fecham se o bot **conhecer os 14 módulos**, organizados em duas camadas: **base** (o que
ele lidera a venda) e **extra** (o que entra via adicional).

### Nota sobre a escolha do RAG

Seguimos com RAG léxico. O que assumimos: mais um índice e um mapa de sinônimos para
manter, e (se formos de 2 chamadas) +1–3 s de latência e +1 ponto de falha. Em troca,
um pipeline que escala se o catálogo crescer e um passo de extração reaproveitável.
Desenho com o `BusinessContextProvider` (port) no meio, de forma que trocar
RAG ↔ prompt-estático seja só de adapter — a decisão continua reversível.

---

# 1. Modelo comercial (estruturado)

## Dois planos, uma alavanca

| Plano | Módulos incluídos | Preço (exemplo — a definir) |
|---|---|---|
| **FluxoDRE Essencial** | Núcleo de operação + administração + resultado: Gestão de Obras/Campo · Obra360 · Equipes e Presença · Planejamento e Frentes · Checklists · FluxoDRE Desktop · Colaboradores e Documentos · Vales/Pagamentos/Obrigações · DRE, Custos e Centros de Custo · Hub | mensalidade base **R$ 700/mês** |
| **FluxoDRE Completo** | Essencial **+ Adicional Inteligência**: Artisys Finance · Universidade Empresarial · Jogos e Gamificação · Assistente Inteligente · (+ módulos futuros) | base **+ R$ 500/mês** = **R$ 1.200/mês** |

**Termo comercial da alavanca:** *"Adicional Inteligência"* — um valor único que destrava
tudo que está fora do Essencial. Sem venda de módulo extra avulso: ou o cliente está no
Essencial, ou sobe para o Completo.

Nomenclaturas alternativas:

```
  base        alavanca                plano cheio
  ─────────────────────────────────────────────────────
  Essencial   Adicional Inteligência  Completo      ← proposto (funcional, direto)
  Núcleo      Pacote Ecossistema      Integrado     ← ecoa a linguagem dos payloads
  Gestão      Módulo Inteligência     Gestão+IA     ← separa "gestão" de "inteligência"
  Base        Upgrade Completo        Full          ← genérico
```

## Termos a definir (checklist)

| Item | Proposta para o lançamento enxuto | Precisa de definição |
|---|---|---|
| Mensalidade base (Essencial) | R$ ___ | valor |
| Adicional Inteligência | R$ ___ fixo (ou % da base) | valor / forma |
| Cobrança variável por usuário ou por obra | **não** — preço único, revisar depois | confirmar |
| Período mínimo / fidelidade | mensal, sem fidelidade | confirmar |
| Setup / implantação | isento no lançamento | confirmar |
| Trial | 14 dias | confirmar / duração |
| Plano anual | ~2 meses de desconto | confirmar |
| Extra "à la carte" (só 1 módulo extra) | **não existe** — extras só via Adicional | confirmar |

## Como o bot usa isso

- `pricing.md` guarda os dois valores + os termos. É um **chunk fixo (pinned)** — preço
  entra em *toda* resposta, nunca depende de retrieval.
- Lead pergunta "quanto custa?" → bot cita a mensalidade do Essencial e menciona o Completo
  com o adicional. Não negocia, não dá desconto → fechamento/negociação continua sendo
  `handoffToHuman` (comportamento atual).
- Lead pede só um módulo extra → bot explica que os extras vêm juntos no Adicional Inteligência.
- Guardrail dos payloads "não informar preços enquanto a base não estiver cadastrada" →
  **substituído** por "informar apenas os valores de `pricing.md`; qualquer condição
  especial é com um vendedor".

---

# 2. RAG léxico — design refinado

## 2.1 Corpus e chunking

```
2 payloads (docs/payloads/*.txt)
   │  curadoria: dedup leve + inserir metadados por seção
   ▼
src/conversation-engine/infrastructure/knowledge/
   sales-knowledge.md        ~90 seções, já delimitadas por  ====
   pricing.md                pequeno, sempre pinned
   │
   ▼ boot: split em  ====  → 1 seção = 1 chunk (~100–400 tok)
   ▼
chunks[]  cada um com:
   id, heading, body
   module:   gestao-obras | obra360 | equipes-presenca | frentes | checklists |
             fluxodre-desktop | colaboradores-docs | vales-pagamentos |
             dre-custos | artisys-finance | universidade | jogos | assistente | hub | geral
   tier:     base | extra | geral
   kind:     visao | funcionalidades | problema-solucao | publico |
             guardrail | objecao | discovery | preco
   keywords: reforços manuais de jargão de campo
```

**Chunks "pinned" (nunca dependem de retrieval, vão no prefixo estável):**
`kind ∈ {guardrail, preco}` + a visão curta do produto + o contrato de saída JSON.
O retrieval só preenche a **fatia variável**: `funcionalidades`, `problema-solucao`,
`objecao`, `publico`, `discovery`.

## 2.2 Índice: BM25 em memória

Corpus é minúsculo (~150 chunks). **BM25 em memória, reconstruído no boot** a partir
dos `.md`:

- zero infra, zero migração, zero índice obsoleto — mesma cadência de manutenção do
  `reply-strategy.prompt.md` atual (editar `.md`, reiniciar)
- SQLite FTS5 só valeria para persistir o índice entre reinícios ou consultar de outro
  processo — não é o caso nesse tamanho
- **Tokenização PT-BR**: lowercase + remover acentos + stopwords PT + stemming leve
  (sufixos). O peso está no **mapa de sinônimos** (`synonyms.pt-br.ts`):
  `"andar" → pavimento`, `"bater ponto" → presença`, `"medição/aditivo" → dre/custos`,
  `"extrato/conciliação" → artisys-finance`, `"treinar equipe" → universidade`.
  Cliente de obra fala jargão que não bate literalmente com a redação formal do KB.

## 2.3 A pergunta central: 1 chamada ou 2

```
┌── OPÇÃO A · extração LOCAL · 1 chamada LLM ──────────────────────────┐
│ msgs novas → normaliza + sinônimos → termos                          │
│ termos → BM25 → top-k (dedupe por seção, teto ~2k tok)               │
│ persona + pinned + chunks + histórico + msgs → LLM → BotDecision     │
│ + 1 chamada, +5–20ms, custo de token inalterado                     │
│ + "extração" não pode falhar (é código)                             │
│ − msg vaga ("oi, vi o anúncio") → query fraca → chunks ruidosos     │
└─────────────────────────────────────────────────────────────────────┘
┌── OPÇÃO B · extração via LLM · 2 chamadas ──────────────────────────┐
│ persona-lite + histórico + msgs → LLM#1 → { temas[], dores[],        │
│                                   modulosProvaveis[], leadIntent }   │
│ dores/temas → BM25 → top-k chunks                                    │
│ persona + pinned + chunks + histórico + msgs → LLM#2 → BotDecision   │
│ + query muito melhor ("encarregado só manda áudio" → dores=          │
│   [comunicação campo-escritório, falta de registro])                │
│ + LLM#1 já devolve intent/qualification → reaproveita               │
│ − 2 chamadas sequenciais: +1–3s sobre a janela de 8s               │
│ − LLM#1 é ponto de falha novo → precisa cair p/ extração local      │
│ − ~2× custo de input (ainda ~US$ 0,03 no total)                    │
└─────────────────────────────────────────────────────────────────────┘
┌── OPÇÃO C · híbrida · 1 chamada, 2ª condicional ───────────────────┐
│ extração local sempre. Dispara LLM#1 só se: melhor score BM25 <      │
│ limiar (query ambígua) OU turno crítico (lead pediu detalhe/proposta)│
│ + caso comum = 1 chamada; gasta a 2ª só quando compensa             │
│ − limiar para calibrar                                              │
└─────────────────────────────────────────────────────────────────────┘
```

**Recomendação dentro do RAG: começar na Opção A.** Os payloads já nos dão um
**conjunto de avaliação pronto** — ~18 falas de cliente mapeadas para módulos esperados
(`base_conhecimento... §54` e `modulos_funcionalidades... §30`). Dá para tunar BM25 +
sinônimos com `recall@k` desses pares, tudo determinístico, rodando no CI sem LLM.
Se o recall ficar fraco em mensagens conversacionais, subir para C e, só se necessário,
B — trocando o adapter, não o resto.

## 2.4 Onde encaixa (Clean Architecture)

```
conversation-engine/
  domain/
    reply-strategy.ts          recebe businessContext: string, compõe no system  (não sabe o que é RAG)
    reply-strategy.prompt.md   persona — ajustes de comportamento (§3 abaixo)
  application/
    ports/
      business-context.port.ts        NOVO  ── getContext({ conversation, newMessages }): Promise<string>
    use-cases/
      generate-reply.use-case.ts       + 1 passo: businessContext = provider.getContext(...) antes de buildRequest
  infrastructure/
    knowledge/
      sales-knowledge.md   pricing.md            fonte de verdade, versionada e commitada
      lexical-index.ts     synonyms.pt-br.ts     BM25 + jargão  (infra)
      lexical-retrieval.business-context.ts      adapter do port — Opção A
      static.business-context.ts                 adapter alternativo — fallback / testes / A-B
```

- `domain` só recebe uma **string** de contexto — desacoplado de RAG, igual à lição do
  `LlmClientPort`.
- índice + sinônimos são `infrastructure`.
- `main.ts` decide qual adapter injetar.

## 2.5 Prompt caching com RAG

```
system:  [ block 1: persona + pinned (guardrails, pricing, visão curta, contrato JSON) ]  ← cache_control: ephemeral
         [ block 2: chunks recuperados deste turno ]                                       ← sem cache_control (varia)
messages: [ ...histórico (≤20), ...msgs novas ]                                            ← volátil
```

Cache é prefix-match: block 2 mudar não invalida block 1. Ganhamos cache no pedaço grande
e estável mesmo com retrieval variável em cima.

## 2.6 Falhas e fallback

| Falha | Comportamento |
|---|---|
| retrieval retorna 0 chunks acima do limiar | injeta conjunto default (pinned + visão curta) e segue |
| query só com stopwords ("oi tudo bem?") | não faz retrieval; pinned + visão curta |
| (Opção B/C) LLM#1 de extração falha | cai para extração local; segue |
| índice não construiu no boot | degrada para `StaticBusinessContext` (KB inteiro no prompt) e loga — **decisão:** fail-fast ou degradar |
| `.md` sem metadado de seção | fail-fast no boot com mensagem clara |

## 2.7 Impacto no schema `BotDecision`

O modelo de 2 planos + venda modular pede rastreio. Proposta:

```
+ recommendedModules: string[]   módulos que o bot ofereceu neste turno
+ interestedModules: string[]    módulos em que o lead demonstrou interesse
+ quotedPlan: "essencial" | "completo" | null    plano cujo preço foi citado (auditoria)
```

Persistidos por turno + no agregado → brief de handoff e relatório de funil.
Toca `bot-decision.ts`, o contrato no `reply-strategy.prompt.md`, `conversation.ts`,
`conversation-turn.ts`.

---

# 3. Comportamentos — o que muda na persona

| Situação | Ação |
|---|---|
| **Discovery-first** | regra explícita: entender a dor (banco de perguntas de sondagem) antes de ofertar módulo |
| **Dor → conjunto mínimo de módulos** | apoiado nos chunks `problema-solucao` recuperados |
| **Enquadramento em 2 planos** | apresentar Essencial como ponto de partida; Completo quando a dor toca um módulo extra |
| **Guardrails de produto** | lista específica dos payloads: nada de BIM/CompatibilizaBIM/DWG/IFC; não inventar features; não prometer economia X; "IA não decide sozinha"; recurso futuro ≠ disponível |
| **Preço** | citar só os valores de `pricing.md`; condição especial = humano |
| **Formato no WhatsApp** | explicação curta/intermediária (payloads §50–51); ficha completa de módulo só sob pedido explícito |
| **Fora do segmento** (não é construção civil) | qualificar como `cold` gentilmente |
| **"manda PDF / tem site / quero demo"** | decisão pendente: link canônico? agendar? handoff? |
| **"é robô?" / transparência** | política de honestidade |
| **Objeção de preço** | reframe de valor → `handoffToHuman` se travar |

---

# 4. Forma da change

Uma change: **`add-business-context-to-engine`**

```
1. Curar os 2 payloads → knowledge/sales-knowledge.md (seccionado, com metadados) + pricing.md
2. BusinessContextProvider (port) + LexicalRetrievalBusinessContext (adapter, Opção A)
   + StaticBusinessContext (adapter fallback)
3. lexical-index.ts (BM25 boot) + synonyms.pt-br.ts
4. GenerateReplyUseCase chama o provider; ReplyStrategy compõe persona + contexto; cache breakpoint
5. Persona: discovery-first, 2 planos, formato WhatsApp, guardrails, política de preço
6. BotDecision + schema + Conversation: recommendedModules / interestedModules / quotedPlan
7. Conjunto de avaliação de retrieval (pares §54/§30) como teste de CI
8. Fiação no main.ts
```

---

# 5. Confirmações pendentes para escrever os artefatos

1. **Números de preço** e os termos do checklist (§1) — pelo menos base + adicional.
2. **Split base vs extra** — ok manter Equipes/Presença, Frentes, Checklists no
   **Essencial** (e só Artisys/Universidade/Jogos/Assistente como extra)?
3. **Nomenclatura** — "Essencial / Adicional Inteligência / Completo" serve, ou prefere
   outro conjunto?
4. **RAG: Opção A** (extração local, 1 chamada) como ponto de partida — ok?
5. **Schema** — incluir os 3 campos novos em `BotDecision`, ou manter mínimo (só prompt)?
6. **Fallback de índice** — fail-fast no boot, ou degradar para KB inteiro no prompt?

---

## Anexo — Code Map do fluxo atual (interpretação → resposta)

### Slices envolvidos

```
src/
├── main.ts .......................... COMPOSITION ROOT (lê o prompt .md do disco)
│
├── whatsapp-connectivity/ ........... SLICE 1 — Meta Cloud API
│   ├── application/
│   │   ├── ports/inbound-message.port.ts ........ InboundMessagePort  ◄── entrada do motor
│   │   └── use-cases/handle-inbound-message.use-case.ts  (filtra type!="text")
│   └── infrastructure/
│       ├── http/routes/whatsapp-webhook.routes.ts . POST /webhooks/whatsapp (HMAC)
│       └── gateways/meta-cloud-api.gateway.ts ..... envio real
│
└── conversation-engine/ ............ SLICE 2 — o "cérebro"
    ├── domain/
    │   ├── reply-strategy.prompt.md ....... system prompt de prospecção (persona)
    │   ├── reply-strategy.ts .............. monta LlmRequest: prompt + histórico + msgs novas
    │   ├── bot-decision.ts ................ VO da decisão + JSON Schema da saída
    │   ├── conversation.ts ................ AGREGADO: turnos, estado, dedupe, ciclo de vida
    │   └── conversation-turn.ts ........... turno inbound/outbound (+ pendingDecision)
    ├── application/
    │   ├── ports/ ........ llm-client · conversation-repository · reply-sender · logger
    │   └── use-cases/generate-reply.use-case.ts . ORQUESTRADOR do turno de resposta
    └── infrastructure/
        ├── inbound/inbound-batch-coordinator.ts ... coalescing 8s + fila serial por lead
        ├── llm/anthropic-llm-client.ts ............ adapter @anthropic-ai/sdk (output_config)
        ├── persistence/file-conversation-repository.ts . 1 JSON por lead
        ├── sending/reply-sender.adapter.ts ........ liga o motor ao SendTextMessageUseCase
        └── boot/pending-inbound-sweeper.ts ........ reprocessa pendências no boot
```

### Sequência (resumida)

```
Lead → Meta → webhook.routes (HMAC, parse zod) → HandleInboundMessageUseCase (só type=text)
  → InboundBatchCoordinator.receive:
       load conversation | dedupe (hasProcessed) | recordInboundTurn (pendingDecision=true) | save
       se awaitingHuman → só registra | senão bufferAndSchedule (setTimeout 8s, janela desde a 1ª pendente)
  ⏲ 8s → GenerateReplyUseCase.execute(leadPhone, ids[]):
       load conversation | filtra pendingInboundTurns ∈ ids
       reopenIfEnded (ended→active; awaitingHuman NÃO)
       ReplyStrategy.buildRequest(conversation, newMessages):
         system   = promptText (.md)
         messages = últimos N turnos não-pendentes (inbound→user / outbound→assistant) + msgs novas
         responseSchema = BOT_DECISION_JSON_SCHEMA
       llmClient.generate → interpretWithRetry (1 retry, backoff 500ms; persistiu → logger.error + return)
       JSON.parse → BotDecision.create (valida zod)
       conversation.applyDecision (push outbound, atualiza intent/qualification, clearPending,
                                   handoffToHuman→awaitingHuman | endConversation→ended)
       repository.save
       for body of replyMessages: replySender.send (1 retry; falha → logger.error, segue lote)
       handoffToHuman → logger.warn
```

### Montagem do prompt hoje (`ReplyStrategy.buildRequest`)

```
reply-strategy.prompt.md  (lido 1x no boot em main.ts)
        │
        ▼
LlmRequest
  system  = promptText   ← 100% do contexto de negócio hoje mora aqui (hardcoded no .md)
  messages= [ ...últimos N turnos não pendentes... ] + [ ...newMessages como role:"user"... ]
  model   = LLM_MODEL (env, default claude-sonnet-5)
  maxTokens = 2000 (fixo)
  responseSchema = BOT_DECISION_JSON_SCHEMA
        │
        ▼
AnthropicLlmClient.generate()  → messages.create({ ..., output_config: { format: { type: "json_schema", schema }}})
        │
        ▼
{ text: "<JSON conforme BOT_DECISION_JSON_SCHEMA>" }
```

### Estruturas de dados centrais

```
BotDecision (saída do LLM, validada por zod)
  replyMessages: string[]   — []=não responde; 1=normal; N=pontos distintos
  endConversation: boolean  — → state "ended" (reabre sozinho depois)
  leadIntent: interested | not_interested | needs_more_info | opt_out | off_topic | unknown
  leadQualification: hot | warm | cold | null
  handoffToHuman: boolean   — → state "awaitingHuman" (NÃO reabre sozinho)
  reasoning: string | null  — auditoria, NUNCA vai pro lead

Conversation (1 arquivo JSON por lead em data/conversations/)
  leadPhone: E.164
  turns[]: ConversationTurn (inbound: text,ts,messageId,pendingDecision,abandoned |
                             outbound: text,ts,leadIntent,leadQualification,reasoning)
  leadIntent / leadQualification: status corrente
  state: active | ended | awaitingHuman
  processedMessageIds: Set — deduplicação de webhooks reentregues
```

### Payloads de conhecimento (fonte)

| Arquivo | Ângulo | Tamanho cru |
|---|---|---|
| `docs/payloads/base_conhecimento_bot_vendas_obra_na_mao.txt` | Ecossistema holístico (conexões, posicionamento, explicações curta/intermediária) | ~1070 linhas / ~16k tok |
| `docs/payloads/modulos_funcionalidades_obra_na_mao_bot_vendas.txt` | Catálogo modular/comercial (14 módulos, "pode vender separado?", pacotes, regras de venda modular) | ~1266 linhas / ~15k tok |

Sobreposição alta (~60%): ambos repetem dores, mapa problema→solução, discovery questions,
lista de "o que o bot NÃO deve fazer", ausência de preço. Curados e deduplicados: ~6–9k tokens.
