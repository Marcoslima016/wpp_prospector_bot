## Context

Ver proposal.md - Why. Dois arquivos concentram o comportamento hoje:

- `src/conversation-engine/domain/reply-strategy.prompt.md` — prompt fixo, enviado em
  todo turno. Sua seção "Formato das respostas (WhatsApp)" hoje só descreve o modo
  conversacional (mensagens curtas, no máximo um emoji).
- `src/conversation-engine/infrastructure/knowledge/sales-knowledge.md` — base de
  conhecimento recuperada por busca léxica. O trecho `ficha-modulo-formato` e os 14
  trechos `kind: funcionalidades` (um por módulo) são os pontos de conteúdo que alimentam
  as respostas estruturadas.

Levantamento técnico confirmou que não há sanitização no envio (`meta-cloud-api.gateway.ts`
manda `message.body` literal para a Cloud API) nem limite de tamanho ou regra de formato no
schema de `replyMessages` (`bot-decision.ts` só valida não-vazio). O
`BOT_DECISION_JSON_SCHEMA` usado como saída estruturada do LLM não aceita
`minLength`/`maxLength`. Ou seja: toda a regra de formatação só pode existir como texto de
instrução (prompt + base de conhecimento), não como validação de código.

## Goals / Non-Goals

**Goals:**
- Dar ao LLM um padrão visual concreto (títulos, listas, ênfases, espaçamento, emojis por
  seção) para os três cenários de conteúdo estruturado: ficha de módulo, oferta de um
  conjunto de módulos e citação de preço/plano.
- Preservar o modo conversacional atual (curto, sem título/lista) para sondagem, saudação,
  confirmação social e encerramento/opt-out.
- Reescrever os 14 trechos `kind: funcionalidades` da base de conhecimento em bullets por
  linha, para reduzir a chance do LLM "errar a mão" ao transformar prosa em lista.

**Non-Goals:**
- Nenhuma mudança de código, schema, validação ou pipeline de envio.
- Não bulletizar os trechos `kind: problema-solucao` (dores) — permanecem em prosa; são
  usados mais como insumo de raciocínio (identificar a dor) do que citados ao lead como
  lista.
- Não alterar a regra de "uma mensagem vs. várias mensagens" (`replyMessages`) — a
  formatação estruturada resolve dentro de uma única mensagem o que antes só formatação
  múltipla poderia (ex.: apresentar 2 módulos), então não há necessidade de tocar nessa
  regra separada.

## Decisions

**1. Convenção visual usada (negrito `*texto*`, marcador `▪`, emoji por título/seção).**
O WhatsApp (Cloud API, mensagem de texto) não tem markdown de título ou lista nativos —
só `*negrito*`, `_itálico_`, `~riscado~` e monoespaçado. "Título" e "lista" são convenções
simuladas: uma linha isolada em negrito com um emoji de destaque funciona como título de
seção; um caractere de marcador (`▪`) no início da linha funciona como item de lista.
Alternativa considerada: usar `-` como marcador de lista (mais comum em texto puro), mas
`▪` fica visualmente mais distinto de uma frase que apenas começa com hífen.

**2. Regra fica só no prompt + base de conhecimento, sem enforcement em código.**
Dado que `BOT_DECISION_JSON_SCHEMA` não aceita `minLength`/`maxLength` e que a saída é
texto livre por natureza, não há como validar formatação por schema. A decisão é confiar
no LLM seguindo o exemplo explícito (few-shot) no prompt e no molde já formatado do trecho
`ficha-modulo-formato`. Isso é consistente com o resto do prompt, que já rege qualidade de
resposta inteiramente por instrução textual (ex.: "sem textão", "no máximo 2 a 4 frases").

**3. Onde a regra geral fica fixada: `reply-strategy.prompt.md`, não a base de
conhecimento.**
Os trechos `venda-consultiva` e `ficha-modulo-formato` da base **não são `pinned`** — só
entram no contexto quando recuperados por busca léxica. A regra geral de "quando usar modo
conversacional vs. estruturado" precisa estar em todo turno, então vai na seção "Formato
das respostas" do prompt principal (sempre enviado). O trecho `ficha-modulo-formato`
recebe o molde formatado como reforço concreto para quando for recuperado.

**4. Bulletizar só `kind: funcionalidades`, não `kind: problema-solucao`.**
As funcionalidades mapeiam diretamente para o campo "Funcionalidades" da ficha
estruturada — é onde a lista visual mais aparece na saída ao lead. As dores (`problema-
solucao`) são usadas majoritariamente para o bot identificar/confirmar a necessidade do
lead durante a sondagem, um uso mais narrativo que não se beneficia tanto de virar lista.
Manter esse conteúdo em prosa também reduz o escopo da mudança (14 trechos em vez de 28).

## Risks / Trade-offs

- [Risco] O LLM pode aplicar a formatação estruturada em turnos que não deveriam
  (ex.: título/negrito numa resposta de sondagem) ou, ao contrário, manter tudo em bloco
  mesmo com múltiplos módulos → Mitigação: os exemplos no prompt e no trecho
  `ficha-modulo-formato` são explícitos sobre quando cada modo se aplica; como não há
  enforcement de código, resta observar decisões reais (`reasoning`, `recommendedModules`)
  registradas por turno para detectar desvio ao longo do uso.
- [Risco] `▪`/emoji podem renderizar de forma inconsistente em clientes WhatsApp
  específicos (alguns Android antigos, web) → Mitigação: usar apenas emojis Unicode comuns
  já presentes no prompt atual e um caractere de marcador simples; não é um risco novo
  introduzido por esta mudança, é inerente ao canal.
- [Trade-off] Mensagens estruturadas ficam mais longas que o "2-4 frases" de hoje →
  aceito deliberadamente (ver proposal.md - Why): o objetivo é reduzir a carga cognitiva
  de ler um bloco denso, e formatação visual é o que torna uma mensagem mais longa ainda
  assim fácil de escanear.

## Migration Plan

Mudança de conteúdo, sem estado a migrar nem toggle de feature. Efetiva a partir do
próximo deploy do prompt e da base de conhecimento; conversas em andamento simplesmente
passam a receber o novo formato nos próximos turnos estruturados.
