## ADDED Requirements

### Requirement: Envio de Mensagem de Texto de Sessão

O sistema SHALL enviar uma mensagem de texto livre para um número de telefone via WhatsApp Cloud API, dado o número de destino e o corpo textual da mensagem. O envio é válido apenas dentro da janela de atendimento de 24h do número de destino; o sistema não mantém o estado dessa janela e depende da Cloud API para rejeitar envios fora dela.

O corpo da mensagem MUST ser não-vazio e MUST ter no máximo 4096 caracteres. O número de destino MUST estar no formato E.164.

#### Scenario: Envio bem-sucedido

- **WHEN** uma mensagem de texto com corpo válido é enviada para um número em formato E.164 com a janela de atendimento aberta
- **THEN** o sistema retorna o identificador da mensagem (`wamid`) atribuído pela Cloud API

#### Scenario: Falha reportada pela Cloud API

- **WHEN** a Cloud API rejeita o envio (ex.: janela de atendimento fechada, número inválido, corpo recusado, limite de tier excedido)
- **THEN** o sistema propaga um erro identificável com a causa retornada pela API, sem lançar exceção não tratada

#### Scenario: Corpo de mensagem inválido

- **WHEN** o corpo da mensagem é vazio ou excede 4096 caracteres
- **THEN** o sistema rejeita o envio antes de chamar a Cloud API, com um erro de validação identificável

#### Scenario: Número de destino em formato inválido

- **WHEN** o número de destino não está no formato E.164
- **THEN** o sistema rejeita o envio antes de chamar a Cloud API, com um erro de validação identificável
