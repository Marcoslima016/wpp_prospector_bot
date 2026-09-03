# whatsapp-connectivity Specification

## Purpose

Conecta o sistema à API oficial do WhatsApp (Cloud API da Meta) para enviar mensagens de template e receber eventos de mensagens e status via webhook, servindo de camada de transporte para toda a prospecção construída em changes futuras.

## Requirements

### Requirement: Envio de Mensagem de Template

O sistema SHALL enviar uma mensagem de template para um número de telefone via WhatsApp Cloud
API, dado o nome do template, o idioma e os parâmetros de substituição.

O envio de template SHALL permanecer disponível como caso de uso chamável em código e SHALL,
adicionalmente, ser **acionável por um gatilho HTTP autenticado** exposto pela API de gestão
(`POST /admin/api/leads/:leadPhone/prospect`, ver a capability `outbound-prospecting`), usado
para o primeiro contato de prospecção. O gatilho HTTP SHALL exigir uma sessão de gestão
válida e SHALL delegar ao mesmo caso de uso de envio de template, sem duplicar a integração
com a Cloud API. Nenhum comportamento do envio em si (formato do payload, propagação de erro
da Cloud API, retorno do `wamid`) muda por causa do gatilho.

#### Scenario: Envio bem-sucedido

- **WHEN** uma mensagem de template válida é enviada para um número de telefone válido
- **THEN** o sistema retorna o identificador da mensagem (wamid) atribuído pela Cloud API

#### Scenario: Falha reportada pela Cloud API

- **WHEN** a Cloud API rejeita o envio (ex.: número inválido, template não aprovado, limite de tier excedido)
- **THEN** o sistema propaga um erro identificável com a causa retornada pela API, sem lançar exceção não tratada

#### Scenario: Envio de template disparado por gatilho HTTP autenticado

- **WHEN** um operador autenticado dispara o primeiro contato de prospecção de um lead pela API de gestão
- **THEN** o sistema envia a mensagem de template pela Cloud API pelo mesmo caso de uso usado em código e retorna o `wamid`

#### Scenario: Gatilho HTTP de template sem sessão

- **WHEN** uma requisição chega ao gatilho HTTP de envio de template de prospecção sem sessão de gestão válida
- **THEN** o sistema responde HTTP 401 e não envia nenhuma mensagem de template

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

### Requirement: Encaminhamento de Mensagem Inbound para Processamento

O sistema SHALL encaminhar cada mensagem inbound normalizada a um processador downstream por meio de uma interface desacoplada, além de continuar a registrá-la. O encaminhamento NÃO SHALL bloquear nem atrasar a confirmação HTTP 200 rápida à Meta (ver requirement "Confirmação Rápida de Recebimento").

#### Scenario: Mensagem inbound encaminhada

- **WHEN** uma mensagem de texto de um lead é recebida e sua assinatura é válida
- **THEN** o sistema disponibiliza os dados normalizados (remetente, identificador, texto, timestamp) ao processador downstream configurado

#### Scenario: Falha no processamento downstream

- **WHEN** o processador downstream lança um erro ao receber a mensagem encaminhada
- **THEN** o sistema registra o erro e continua operando normalmente, sem afetar a confirmação 200 já enviada nem o recebimento de eventos subsequentes

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

### Requirement: Confirmação Rápida de Recebimento
O sistema SHALL confirmar o recebimento de um evento de webhook com uma resposta HTTP 200 sem aguardar a conclusão do processamento downstream do evento, evitando reenvios da Meta por timeout.

#### Scenario: Confirmação antes do processamento completo
- **WHEN** um evento de webhook com assinatura válida é recebido
- **THEN** o sistema responde 200 à Meta imediatamente após aceitar o evento, independentemente de quanto tempo o processamento subsequente levará
