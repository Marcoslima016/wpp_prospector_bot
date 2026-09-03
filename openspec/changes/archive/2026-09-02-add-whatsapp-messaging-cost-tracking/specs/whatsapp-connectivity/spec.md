## MODIFIED Requirements

### Requirement: Recebimento de Atualização de Status

O sistema SHALL reconhecer eventos de webhook que representam atualização de status de uma
mensagem enviada anteriormente (enviada, entregue, lida ou falhou), distinguindo-os de
eventos de mensagem recebida, e SHALL extrair o identificador da mensagem e o novo status.

Quando o evento de status carregar os dados de precificação e de conversa da Cloud API
(`pricing` com `billable`, `pricing_model` e `category`; `conversation` com `id`,
`origin.type` e `expiration_timestamp`), o sistema SHALL extrair também esses campos e
disponibilizá-los para o registro de consumo de mensageria (capability
`consumption-metrics`). A extração SHALL ser tolerante: campos ausentes, vazios ou
desconhecidos NÃO SHALL derrubar o parsing do evento nem impedir o tratamento do status. O
registro de consumo resultante SHALL ser best-effort — NÃO SHALL alterar a confirmação HTTP
200 rápida à Meta nem o comportamento de log atual do tratamento de status.

#### Scenario: Atualização de status recebida

- **WHEN** um evento de webhook contendo uma atualização de status de mensagem é recebido e sua assinatura é válida
- **THEN** o sistema identifica o evento como atualização de status (não como mensagem recebida) e extrai o identificador da mensagem e o novo status

#### Scenario: Atualização de status com dados de precificação e conversa

- **WHEN** um evento de status válido chega com os objetos `pricing` e `conversation` preenchidos
- **THEN** o sistema extrai, além do identificador da mensagem e do status, os campos `billable`, `pricing_model`, `category`, o `id` da conversa, o tipo de origem e o `expiration_timestamp`, e os disponibiliza para o registro de consumo de mensageria

#### Scenario: Atualização de status sem dados de precificação

- **WHEN** um evento de status válido chega sem os objetos `pricing`/`conversation`
- **THEN** o sistema trata o evento normalmente extraindo apenas o identificador da mensagem e o status, sem falhar e sem registrar consumo de mensageria

#### Scenario: Campos desconhecidos nos objetos de precificação/conversa

- **WHEN** um evento de status chega com campos adicionais ou valores não previstos dentro de `pricing`/`conversation`
- **THEN** o parsing do evento não é derrubado, o status é tratado normalmente e os campos reconhecidos seguem disponíveis para o registro de consumo

#### Scenario: Falha ao registrar o consumo de mensageria

- **WHEN** o registro do consumo de mensageria derivado do evento de status falha
- **THEN** o sistema registra o erro em log e conclui o tratamento do evento de status sem afetar a confirmação 200 já enviada nem o recebimento de eventos subsequentes
