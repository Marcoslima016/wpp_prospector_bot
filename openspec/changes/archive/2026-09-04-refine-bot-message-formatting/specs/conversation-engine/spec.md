## MODIFIED Requirements

### Requirement: Condução de Venda Consultiva

Antes de apresentar módulos, o bot SHALL procurar identificar a necessidade ou dor do lead,
usando perguntas de sondagem objetivas, uma por mensagem. Identificada a dor, o bot SHALL
apresentar apenas o conjunto mínimo de módulos relacionado a ela, e SHALL enquadrar a
oferta nos dois planos comerciais sem afirmar que o lead precisa contratar todos os
módulos. Integrações entre módulos SHALL ser apresentadas como benefício adicional, nunca
como obrigação.

As respostas SHALL seguir o formato do canal, distinguindo dois modos:

- **Conversacional** — sondagem, saudação, confirmação social, transições de ciclo de
  vida (encerramento, opt-out) e demais turnos sem conteúdo estruturado: mensagem curta
  (explicação curta ou intermediária), texto corrido, no máximo um emoji.
- **Estruturado** — a ficha de um módulo, a apresentação de um conjunto de módulos ou a
  citação de preço/plano: o bot SHALL usar títulos em destaque (negrito), listas com
  marcador para itens (ex.: funcionalidades), negrito/itálico para criar hierarquia entre
  valores e informações, e espaçamento entre blocos. O limite de "mensagem curta" do modo
  conversacional NÃO SHALL se aplicar a esse modo — o tamanho é função do conteúdo
  organizado, não de uma contagem de frases. O bot PODE usar um emoji de destaque por
  título ou seção, sem se limitar a um único emoji por mensagem inteira.

A ficha estruturada de um módulo (o que é / para quem / resolve / funcionalidades /
funciona separado / integra com) SHALL ser usada apenas quando o lead pedir explicitamente
detalhes daquele módulo, e SHALL seguir o modo estruturado de formatação.

O bot NÃO SHALL oferecer, por iniciativa própria, agendar uma demonstração ou apresentação
do sistema com o time como forma de avançar a conversa. O bot SHALL conduzir a venda
consultiva sozinho — sondagem, identificação da dor, apresentação do conjunto mínimo de
módulos e enquadramento nos planos comerciais — até que o próprio lead manifeste intenção
clara de comprar ou peça explicitamente para falar com uma pessoa/vendedor; só então a
conversa é transferida para atendimento humano, pelos gatilhos de handoff já definidos
para a conversa (sem que a mera oferta de demonstração constitua, por si só, um gatilho
de transferência).

Quando o lead pede para ver o sistema funcionando de forma genérica (sem pedir
explicitamente uma call, reunião ou atendimento por uma pessoa), o bot SHALL responder ele
mesmo, no chat, usando a ficha estruturada do módulo relevante ou uma explicação textual
do funcionamento — sem transferir a conversa para atendimento humano nem oferecer agendar
uma demonstração com o time.

#### Scenario: Lead genérico sem dor declarada

- **WHEN** o lead inicia com interesse vago ("vi o anúncio", "quero saber mais")
- **THEN** o bot faz uma pergunta de sondagem para entender a operação do lead antes de ofertar módulos, no modo conversacional (mensagem curta, sem título nem lista)

#### Scenario: Dor identificada

- **WHEN** o lead descreve um problema específico (ex.: não sabe o que cada equipe está fazendo)
- **THEN** o bot apresenta apenas o conjunto mínimo de módulos relacionado àquela dor e o situa nos planos

#### Scenario: Pedido explícito de detalhes de um módulo

- **WHEN** o lead pede para detalhar um módulo específico
- **THEN** o bot responde com a ficha estruturada daquele módulo no modo estruturado: título em negrito com emoji de destaque, funcionalidades em lista com marcador, e as demais seções da ficha organizadas em blocos separados por espaçamento

#### Scenario: Enquadramento modular

- **WHEN** o bot apresenta um módulo ou plano
- **THEN** o bot não afirma que todos os módulos são obrigatórios e apresenta integrações como benefício opcional

#### Scenario: Oferta de um conjunto de módulos

- **WHEN** o bot apresenta mais de um módulo relacionado à mesma dor identificada, no mesmo turno
- **THEN** o bot usa o modo estruturado — um título em negrito por módulo, com espaçamento entre eles — em vez de descrever os módulos em um único parágrafo corrido

#### Scenario: Citação de preço ou comparação de planos

- **WHEN** o bot cita o valor de um ou mais planos comerciais no turno
- **THEN** o bot usa o modo estruturado — nome do plano em destaque e valor em negrito, com um bloco por plano quando mais de um plano é citado — em vez de descrever os valores em uma frase corrida

#### Scenario: Pedido genérico de demonstração

- **WHEN** o lead pergunta, de forma genérica, se pode ver o sistema funcionando ou se a empresa faz demonstração ("tem como ver funcionando?", "vocês fazem demo?")
- **THEN** o bot responde ele mesmo, no chat, com a ficha estruturada do módulo relevante ou uma explicação textual do funcionamento, sem transferir a conversa para atendimento humano

#### Scenario: Bot não oferece demonstração por iniciativa própria

- **WHEN** o bot avalia que o lead está qualificado ou maduro para avançar, mas o lead ainda não manifestou intenção clara de comprar nem pediu falar com uma pessoa
- **THEN** o bot continua a condução consultiva (sondagem, apresentação de módulos, enquadramento nos planos) e não oferece agendar uma demonstração ou apresentação do sistema com o time como próximo passo

#### Scenario: Lead pede atendimento humano ao vivo para ver o sistema

- **WHEN** o lead pede explicitamente uma call, reunião ou atendimento por uma pessoa para ver o sistema funcionando
- **THEN** o sistema transfere a conversa para atendimento humano, pelo gatilho já existente de pedido explícito de falar com uma pessoa/vendedor
