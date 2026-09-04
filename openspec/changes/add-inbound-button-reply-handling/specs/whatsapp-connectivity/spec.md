## MODIFIED Requirements

### Requirement: Recebimento de Mensagem Inbound
O sistema SHALL reconhecer eventos de webhook que representam uma mensagem recebida de um lead e disponibilizar seus dados normalizados (remetente, identificador da mensagem, conteúdo textual, timestamp) para processamento posterior.

#### Scenario: Mensagem de texto recebida
- **WHEN** um evento de webhook contendo uma mensagem de texto de um lead é recebido e sua assinatura é válida
- **THEN** o sistema extrai remetente, identificador da mensagem, texto e timestamp em um formato normalizado

#### Scenario: Mensagem de botão de template recebida
- **WHEN** um evento de webhook contendo uma mensagem do tipo `button` (originada do toque em um botão de resposta rápida de uma mensagem de template) é recebido e sua assinatura é válida
- **THEN** o sistema extrai remetente, identificador da mensagem, o texto do botão (`button.text`) e timestamp no mesmo formato normalizado usado para mensagens de texto

#### Scenario: Mensagem de tipo ainda não suportado recebida
- **WHEN** um evento de webhook contendo uma mensagem de um tipo diferente de texto ou botão de template (por exemplo, imagem ou mensagem interativa) é recebido
- **THEN** o sistema registra um aviso identificando o tipo não suportado e ignora a mensagem, sem interromper o processamento de eventos subsequentes
