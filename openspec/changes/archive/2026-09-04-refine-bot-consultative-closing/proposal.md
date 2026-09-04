## Why

O prompt de prospecção atual (`reply-strategy.prompt.md`) declara, já na frase de abertura, que "uma demonstração" é um próximo passo equivalente a "o contato com um vendedor humano". Sem nenhuma seção do prompt distinguindo os dois, o bot vem usando a oferta de "apresentação do sistema" como atalho de saída da venda consultiva: em vez de seguir sondando a dor e apresentando módulos/planos, ele oferece agendar uma demonstração e encaminha `handoffToHuman: true` prematuramente, mesmo quando o lead não pediu para falar com uma pessoa nem manifestou intenção de compra. Isso reduz o número de leads que o bot conduz sozinho até o ponto real de fechamento.

## What Changes

- Remover, da frase de abertura do prompt, o enquadramento de "demonstração" como destino equivalente a "vendedor humano".
- Adicionar guardrail explícito: o bot NÃO SHALL oferecer, por iniciativa própria, agendar uma demonstração/apresentação do sistema com o time como forma de avançar a conversa.
- Diferenciar pedido de demonstração pelo lead:
  - Pedido genérico ("tem como ver funcionando?", "vocês fazem demo?") → o bot responde ele mesmo, no chat, usando a ficha estruturada de módulo (já existente) ou uma explicação textual — sem handoff.
  - Pedido específico por atendimento humano ao vivo (call, reunião, "quero falar com um vendedor pra ver funcionando") → handoff, usando o gatilho já existente de "lead pede para falar com pessoa/vendedor" (nenhum gatilho novo).
- Reforçar que o objetivo do bot é conduzir a venda consultiva sozinho (sondagem → dor → módulo mínimo → plano/preço) até o próprio lead manifestar intenção clara de comprar/assinar; só então a conversa é transferida para fechamento humano.
- Nenhuma mudança nos gatilhos de handoff já existentes (negociação de valor, condição especial, pedido explícito de humano, questão jurídica/sensível, objeção sem solução no contexto) nem no schema de `BotDecision` — a mudança é de conteúdo de prompt e de requisito de comportamento, não de estrutura de dados.

## Capabilities

### New Capabilities

(nenhuma)

### Modified Capabilities

- `conversation-engine`: o requirement "Condução de Venda Consultiva" passa a proibir explicitamente que o bot ofereça, por iniciativa própria, agendar uma demonstração/apresentação como próximo passo, e a distinguir pedido genérico de demo (respondido pelo próprio bot) de pedido de atendimento humano ao vivo (handoff pelo gatilho já existente).

## Impact

- `src/conversation-engine/domain/reply-strategy.prompt.md`: reescrita da frase de abertura e da seção "Condução consultiva (discovery-first)", com reforço equivalente na seção "Quando transferir para um humano" esclarecendo que oferecer demo não é, por si só, gatilho de handoff.
- `openspec/specs/conversation-engine/spec.md`: atualização do requirement "Condução de Venda Consultiva" via sync da delta spec desta change.
- Nenhum impacto em código de aplicação, schema de `BotDecision`, ou em outras capabilities.
