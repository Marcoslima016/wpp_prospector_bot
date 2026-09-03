## MODIFIED Requirements

### Requirement: Ciclo de Vida da Conversa

Quando a decisão indica encerramento, o sistema SHALL marcar a conversa como encerrada; a próxima mensagem do lead SHALL reabri-la automaticamente e ser processada normalmente.

Quando a decisão indica transferência para atendimento humano, o sistema SHALL enviar as mensagens de resposta do turno, marcar a conversa como aguardando atendimento humano e, a partir daí, registrar as mensagens seguintes do lead SEM gerar resposta automática, até que a marcação seja removida manualmente. A conversa nesse estado NÃO SHALL ser reaberta automaticamente.

O ciclo de vida da conversa SHALL admitir transições **iniciadas por um operador humano**, independentes de uma `BotDecision`:

- Uma transição manual para **aguardando atendimento humano** SHALL colocar a conversa nesse estado a partir de `active` ou `ended`, com o mesmo efeito de uma transferência decidida pelo bot: as mensagens seguintes do lead são registradas sem resposta automática e a conversa não é reaberta automaticamente. Aplicá-la a uma conversa já aguardando atendimento humano SHALL ser idempotente.
- Uma transição manual de **retomada** SHALL devolver a conversa ao estado `active` a partir de `awaitingHuman` ou de `ended` (reabrindo-a), fazendo o bot voltar a responder às próximas mensagens do lead. Aplicá-la a uma conversa já `active` SHALL ser idempotente.

As transições manuais NÃO SHALL exigir uma `BotDecision` nem alterar a intenção ou a qualificação correntes do lead.

#### Scenario: Conversa encerrada e retomada pelo lead

- **WHEN** a decisão encerra a conversa e, depois, o lead envia uma nova mensagem
- **THEN** o sistema reabre a conversa e gera uma nova resposta normalmente

#### Scenario: Conversa transferida para humano

- **WHEN** a decisão marca transferência para humano e, depois, o lead envia novas mensagens
- **THEN** o sistema registra as mensagens e não gera resposta automática enquanto a marcação estiver ativa

#### Scenario: Transição manual para atendimento humano

- **WHEN** um operador coloca manualmente uma conversa `active` em atendimento humano
- **THEN** o sistema marca a conversa como `awaitingHuman`, e as mensagens seguintes do lead são registradas sem resposta automática, sem reabertura automática

#### Scenario: Retomada manual devolve a conversa ao bot

- **WHEN** um operador retoma manualmente uma conversa que estava em `awaitingHuman`
- **THEN** o sistema marca a conversa como `active` e o bot volta a gerar resposta automática para as próximas mensagens do lead

#### Scenario: Retomada manual reabre conversa encerrada

- **WHEN** um operador retoma manualmente uma conversa que estava em `ended`
- **THEN** o sistema marca a conversa como `active` sem depender de uma nova mensagem do lead

#### Scenario: Transição manual redundante é idempotente

- **WHEN** um operador aplica uma transição manual que corresponde ao estado em que a conversa já está
- **THEN** o sistema mantém o estado atual sem erro e sem efeito adicional

### Requirement: Histórico Persistido da Conversa

O sistema SHALL persistir cada conversa, identificada pelo número de telefone do lead, incluindo os turnos recebidos e enviados, a intenção e a qualificação correntes do lead e o estado do ciclo de vida. O sistema SHALL carregar o histórico existente antes de interpretar novas mensagens e SHALL incluir no prompt do LLM no máximo os N turnos mais recentes (padrão 20, configurável).

Cada turno outbound SHALL registrar a sua **origem**: gerado pelo bot ou escrito por um operador humano. A origem SHALL ser persistida e exposta no histórico de forma que os dois casos sejam distinguíveis. A serialização SHALL ser retrocompatível: um turno outbound carregado de uma conversa persistida antes desta mudança, sem o campo de origem, SHALL ser interpretado como tendo origem no bot.

#### Scenario: Lead com histórico existente

- **WHEN** uma mensagem chega de um lead que já tem conversa registrada
- **THEN** o sistema carrega o histórico recente e o inclui na interpretação da nova mensagem

#### Scenario: Primeira mensagem de um lead

- **WHEN** uma mensagem chega de um lead sem conversa registrada
- **THEN** o sistema cria uma nova conversa e a persiste com o primeiro turno recebido

#### Scenario: Turno outbound do bot registra a origem

- **WHEN** o sistema aplica uma decisão do bot que produz mensagens de resposta
- **THEN** cada turno outbound resultante é persistido com origem no bot

#### Scenario: Turno outbound manual registra a origem

- **WHEN** um operador registra uma mensagem outbound escrita à mão na conversa
- **THEN** o turno é persistido com origem no operador, distinguível dos turnos gerados pelo bot

#### Scenario: Conversa persistida antes desta mudança

- **WHEN** o sistema carrega uma conversa cujos turnos outbound foram salvos sem o campo de origem
- **THEN** o sistema os interpreta como tendo origem no bot, sem erro
