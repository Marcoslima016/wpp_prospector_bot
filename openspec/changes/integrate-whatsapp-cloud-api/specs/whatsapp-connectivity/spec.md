## Purpose

Conecta o sistema à API oficial do WhatsApp (Cloud API da Meta) para enviar mensagens de template e receber eventos de mensagens e status via webhook, servindo de camada de transporte para toda a prospecção construída em changes futuras.

## ADDED Requirements

### Requirement: Envio de Mensagem de Template
O sistema SHALL enviar uma mensagem de template para um número de telefone via WhatsApp Cloud API, dado o nome do template, o idioma e os parâmetros de substituição.

#### Scenario: Envio bem-sucedido
- **WHEN** uma mensagem de template válida é enviada para um número de telefone válido
- **THEN** o sistema retorna o identificador da mensagem (wamid) atribuído pela Cloud API

#### Scenario: Falha reportada pela Cloud API
- **WHEN** a Cloud API rejeita o envio (ex.: número inválido, template não aprovado, limite de tier excedido)
- **THEN** o sistema propaga um erro identificável com a causa retornada pela API, sem lançar exceção não tratada

### Requirement: Verificação do Webhook
O sistema SHALL responder ao handshake de verificação de webhook da Meta (requisição GET) validando o verify token configurado.

#### Scenario: Verify token correto
- **WHEN** a Meta envia uma requisição GET de verificação com o verify token configurado e modo "subscribe"
- **THEN** o sistema responde com status 200 e o valor exato do challenge recebido

#### Scenario: Verify token incorreto
- **WHEN** a Meta envia uma requisição GET de verificação com um verify token diferente do configurado
- **THEN** o sistema rejeita a requisição sem confirmar a assinatura

### Requirement: Validação de Assinatura do Payload
O sistema SHALL validar a assinatura de todo evento de webhook recebido (assinatura HMAC calculada com o app secret sobre o corpo da requisição) antes de processar seu conteúdo.

#### Scenario: Assinatura válida
- **WHEN** um evento de webhook chega com assinatura válida para o corpo da requisição
- **THEN** o sistema processa o evento normalmente

#### Scenario: Assinatura ausente ou inválida
- **WHEN** um evento de webhook chega sem assinatura ou com assinatura que não corresponde ao corpo da requisição
- **THEN** o sistema rejeita o evento sem processá-lo

### Requirement: Recebimento de Mensagem Inbound
O sistema SHALL reconhecer eventos de webhook que representam uma mensagem recebida de um lead e disponibilizar seus dados normalizados (remetente, identificador da mensagem, conteúdo textual, timestamp) para processamento posterior.

#### Scenario: Mensagem de texto recebida
- **WHEN** um evento de webhook contendo uma mensagem de texto de um lead é recebido e sua assinatura é válida
- **THEN** o sistema extrai remetente, identificador da mensagem, texto e timestamp em um formato normalizado

### Requirement: Recebimento de Atualização de Status
O sistema SHALL reconhecer eventos de webhook que representam atualização de status de uma mensagem enviada anteriormente (enviada, entregue, lida ou falhou), distinguindo-os de eventos de mensagem recebida.

#### Scenario: Atualização de status recebida
- **WHEN** um evento de webhook contendo uma atualização de status de mensagem é recebido e sua assinatura é válida
- **THEN** o sistema identifica o evento como atualização de status (não como mensagem recebida) e extrai o identificador da mensagem e o novo status

### Requirement: Confirmação Rápida de Recebimento
O sistema SHALL confirmar o recebimento de um evento de webhook com uma resposta HTTP 200 sem aguardar a conclusão do processamento downstream do evento, evitando reenvios da Meta por timeout.

#### Scenario: Confirmação antes do processamento completo
- **WHEN** um evento de webhook com assinatura válida é recebido
- **THEN** o sistema responde 200 à Meta imediatamente após aceitar o evento, independentemente de quanto tempo o processamento subsequente levará
