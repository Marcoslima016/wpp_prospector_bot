## Why

As respostas do bot são hoje sempre um único bloco de texto corrido, sem títulos, listas, negrito/itálico ou espaçamento — mesmo quando o conteúdo é inerentemente estruturado (detalhes de módulo, oferta de vários módulos, preços/planos). Isso cansa a leitura no WhatsApp e dificulta a compreensão exatamente nos turnos que mais precisam ser claros: quando o bot está apresentando produto e preço para converter o lead.

## What Changes

- A seção "Formato das respostas (WhatsApp)" do prompt de prospecção passa a distinguir dois modos de resposta:
  - **Conversacional** (sondagem, saudação, confirmação social, opt-out): continua curto, texto corrido, no máximo um emoji — como hoje.
  - **Estruturado** (ficha de módulo, oferta de um conjunto de módulos, citação de preço/planos): usa títulos em negrito, listas com marcador, negrito/itálico para hierarquia (ex.: valores em negrito) e espaçamento entre blocos; pode exceder o limite de "2-4 frases" do modo conversacional; permite um emoji de destaque por título/seção (não mais um único emoji por mensagem inteira).
- O trecho `ficha-modulo-formato` da base de conhecimento passa a trazer o molde já formatado (título com emoji, campos em negrito, funcionalidades em lista), em vez de só listar os 7 campos em texto.
- Os 14 trechos `kind: funcionalidades` da base de conhecimento (um por módulo) são reescritos de prosa corrida para lista de bullets por linha, para que o LLM tenha a granularidade pronta ao montar a ficha ou uma oferta de módulos.
- Nenhuma mudança de código, schema ou pipeline de envio — é uma mudança de conteúdo de prompt e de base de conhecimento; o texto formatado passa pelo canal exatamente como hoje (sem sanitização).

## Capabilities

### New Capabilities

(nenhuma)

### Modified Capabilities

- `conversation-engine`: a Requirement "Condução de Venda Consultiva" passa a exigir estruturação visual (títulos, listas, ênfases, espaçamento) quando a resposta apresenta conteúdo estruturado (ficha de módulo, conjunto de módulos ofertado, preços/planos citados), mantendo o formato curto e conversacional para os demais turnos.

## Impact

- `src/conversation-engine/domain/reply-strategy.prompt.md` — seção "Formato das respostas (WhatsApp)".
- `src/conversation-engine/infrastructure/knowledge/sales-knowledge.md` — trecho `ficha-modulo-formato` e os 14 trechos `kind: funcionalidades`.
- `openspec/specs/conversation-engine/spec.md` — Requirement "Condução de Venda Consultiva".
- Sem impacto em código, schema (`bot-decision.ts`), testes ou pipeline de envio (`meta-cloud-api.gateway.ts`).
