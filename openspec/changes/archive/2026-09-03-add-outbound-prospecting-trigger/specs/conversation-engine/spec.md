## MODIFIED Requirements

### Requirement: Histórico Persistido da Conversa

O sistema SHALL persistir cada conversa, identificada pelo número de telefone do lead, incluindo os turnos recebidos e enviados, a intenção e a qualificação correntes do lead e o estado do ciclo de vida. O sistema SHALL carregar o histórico existente antes de interpretar novas mensagens e SHALL incluir no prompt do LLM no máximo os N turnos mais recentes (padrão 20, configurável).

Cada turno outbound SHALL registrar a sua **origem**: gerado pelo bot ou escrito por um operador humano. A origem SHALL ser persistida e exposta no histórico de forma que os dois casos sejam distinguíveis. A serialização SHALL ser retrocompatível: um turno outbound carregado de uma conversa persistida antes desta mudança, sem o campo de origem, SHALL ser interpretado como tendo origem no bot.

Uma conversa PODE ser criada **por iniciativa outbound** — o disparo do primeiro contato de prospecção pelo operador (ver a capability `outbound-prospecting`) — antes de qualquer mensagem recebida do lead. Nesse caso o primeiro turno registrado SHALL ser um turno outbound com origem no operador e marcação de que foi o primeiro contato de prospecção; a conversa SHALL nascer no estado `active`. Quando o disparo de prospecção ocorre para um lead que já tem conversa registrada, o sistema SHALL apenas acrescentar esse turno à conversa existente, sem criar uma segunda. O primeiro inbound subsequente do lead SHALL ser anexado à mesma conversa criada pela prospecção.

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

#### Scenario: Conversa criada por iniciativa outbound

- **WHEN** o operador dispara o primeiro contato de prospecção para um lead sem conversa registrada
- **THEN** o sistema cria a conversa no estado `active` e a persiste com um único turno outbound de origem no operador, marcado como primeiro contato de prospecção, sem nenhum turno inbound

#### Scenario: Disparo de prospecção para lead com conversa existente

- **WHEN** o operador dispara o primeiro contato de prospecção para um lead que já tem conversa registrada
- **THEN** o sistema acrescenta um turno outbound de origem no operador à conversa existente, sem criar uma segunda conversa

#### Scenario: Primeiro inbound após a prospecção anexa à conversa existente

- **WHEN** um lead que recebeu o primeiro contato de prospecção responde pela primeira vez
- **THEN** o sistema anexa o turno inbound à conversa já criada pela prospecção e a interpreta com esse histórico, sem criar uma segunda conversa
