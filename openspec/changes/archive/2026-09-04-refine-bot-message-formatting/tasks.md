## 1. Prompt principal (`reply-strategy.prompt.md`)

- [x] 1.1 Reescrever a seção "Formato das respostas (WhatsApp)" distinguindo o modo
      conversacional (como hoje: curto, sem título/lista, no máximo um emoji) do modo
      estruturado (ficha de módulo, oferta de conjunto de módulos, citação de preço/plano):
      títulos em negrito, listas com marcador, negrito/itálico para hierarquia, espaçamento
      entre blocos, sem limite de "2-4 frases", um emoji por título/seção.
- [x] 1.2 Incluir no prompt um exemplo few-shot de cada um dos três cenários estruturados
      (ficha de módulo único, oferta de um conjunto de módulos, citação de preço/plano),
      usando o padrão validado na exploração (negrito para títulos/valores, `▪` para itens,
      um emoji de destaque por título).

## 2. Base de conhecimento — molde da ficha de módulo

- [x] 2.1 Reescrever o trecho `ficha-modulo-formato` em
      `src/conversation-engine/infrastructure/knowledge/sales-knowledge.md` para trazer o
      molde já formatado (título em negrito com emoji, campos como "O que é" / "Resolve
      principalmente" em itálico ou negrito, funcionalidades em lista com marcador,
      indicadores de "funciona separado" / "integra com" com emoji de destaque), em vez de
      só listar os 7 campos em texto.

## 3. Base de conhecimento — funcionalidades por módulo em bullets

- [x] 3.1 `gestao-obras-funcionalidades`: converter a lista de funcionalidades de prosa
      corrida para bullets por linha
- [x] 3.2 `obra360-funcionalidades`: idem
- [x] 3.3 `equipes-presenca-funcionalidades`: idem
- [x] 3.4 `planejamento-frentes-funcionalidades`: idem
- [x] 3.5 `checklists-funcionalidades`: idem
- [x] 3.6 `fluxodre-desktop-funcionalidades`: idem
- [x] 3.7 `colaboradores-documentos-funcionalidades`: idem
- [x] 3.8 `vales-pagamentos-funcionalidades`: idem
- [x] 3.9 `dre-custos-funcionalidades`: idem
- [x] 3.10 `hub-funcionalidades`: idem
- [x] 3.11 `artisys-finance-funcionalidades`: idem
- [x] 3.12 `universidade-funcionalidades`: idem
- [x] 3.13 `jogos-funcionalidades`: idem
- [x] 3.14 `assistente-funcionalidades`: idem
- [x] 3.15 Conferir que a descrição introdutória de cada trecho (o parágrafo de "o que é")
      permanece em prosa — só a lista de funcionalidades vira bullets — e que nenhum
      metadado (`id`/`module`/`tier`/`kind`/`title`) foi alterado

## 4. Validação manual

- [x] 4.1 Gerar manualmente (ambiente de desenvolvimento) uma resposta para cada um dos
      três cenários estruturados — pedido de detalhes de um módulo, dor que aciona mais de
      um módulo, pergunta de preço — e conferir visualmente que o WhatsApp renderiza
      negrito/itálico/marcadores/espaçamento como esperado

      Validado via smoke test contra a Anthropic API real (script ad-hoc, descartado após
      o uso), usando `StaticBusinessContext` para injetar a base inteira: os três cenários
      produziram título em negrito com emoji, rótulos em itálico, funcionalidades em lista
      com `▪`, blocos separados por linha em branco, e negrito nos nomes/valores de plano —
      sem exceder a régua de "sem inventar seções além da base de conhecimento".
- [x] 4.2 Gerar manualmente uma resposta de sondagem/saudação e confirmar que o modo
      conversacional continua curto e sem formatação estrutural, sem regressão

      Validado no mesmo smoke test: mensagem de interesse vago gerou resposta de sondagem
      curta (uma pergunta objetiva), sem título, sem negrito/itálico, sem emoji — sem
      regressão em relação ao comportamento anterior.
- [x] 4.3 Confirmar que a suíte de testes existente (`sales-knowledge.parser.test.ts`,
      `knowledge-loader.test.ts`) continua passando após a edição do markdown da base de
      conhecimento
