## ADDED Requirements

### Requirement: Encaminhamento de Mensagem Inbound para Processamento

O sistema SHALL encaminhar cada mensagem inbound normalizada a um processador downstream por meio de uma interface desacoplada, além de continuar a registrá-la. O encaminhamento NÃO SHALL bloquear nem atrasar a confirmação HTTP 200 rápida à Meta (ver requirement "Confirmação Rápida de Recebimento").

#### Scenario: Mensagem inbound encaminhada

- **WHEN** uma mensagem de texto de um lead é recebida e sua assinatura é válida
- **THEN** o sistema disponibiliza os dados normalizados (remetente, identificador, texto, timestamp) ao processador downstream configurado

#### Scenario: Falha no processamento downstream

- **WHEN** o processador downstream lança um erro ao receber a mensagem encaminhada
- **THEN** o sistema registra o erro e continua operando normalmente, sem afetar a confirmação 200 já enviada nem o recebimento de eventos subsequentes
