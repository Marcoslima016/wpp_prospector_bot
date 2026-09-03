## ADDED Requirements

### Requirement: Registro append-only de conversas de 24 h do WhatsApp

O sistema SHALL registrar cada janela de conversa de 24 h faturável da WhatsApp Cloud API —
identificada pelos dados de precificação/conversa presentes nos eventos de status do webhook
(`pricing` e `conversation`) — como um evento imutável de consumo. Cada evento SHALL conter:
o instante do evento, o identificador da conversa (`conversationId`), o telefone do lead
(`recipientId`), a categoria da conversa (`marketing`, `utility`, `service` ou
`authentication`), o tipo de origem da conversa, o modelo de precificação, o indicador
`billable` e o `expirationTimestamp` da janela quando presente. O sistema SHALL gravar **uma
linha por janela de conversa** e SHALL deduplicar por `conversationId` — a mesma janela de
24 h NÃO SHALL ser contada mais de uma vez, ainda que a Cloud API envie vários eventos de
status para ela. O registro é uma série temporal, somente-acréscimo: eventos já gravados
NÃO SHALL ser atualizados nem removidos pelo caminho da aplicação.

#### Scenario: Evento de status com dados de precificação registrado

- **WHEN** um evento de status de mensagem chega com os campos `pricing` e `conversation` preenchidos e ainda não há evento de consumo para aquele `conversationId`
- **THEN** o sistema grava um evento de consumo de WhatsApp com `conversationId`, telefone do lead, categoria, tipo de origem, modelo de precificação, `billable` e `expirationTimestamp`

#### Scenario: Evento de status sem dados de precificação

- **WHEN** um evento de status de mensagem chega sem os campos `pricing`/`conversation` (ou com eles vazios)
- **THEN** nenhum evento de consumo de WhatsApp é gravado e o tratamento da atualização de status segue normalmente

#### Scenario: Janela de conversa não é contada duas vezes

- **WHEN** chega um segundo evento de status para um `conversationId` que já possui um evento de consumo registrado
- **THEN** o sistema não grava uma nova linha para aquela janela e mantém a linha existente inalterada

#### Scenario: Eventos nunca são reescritos

- **WHEN** novos eventos de status chegam para um lead que já tem conversas registradas
- **THEN** o sistema acrescenta novas linhas apenas para janelas ainda não registradas e não altera nem remove os eventos já gravados

### Requirement: Registro da fonte WhatsApp é best-effort

O registro do consumo de mensageria NÃO SHALL alterar a confirmação HTTP 200 rápida do
webhook, o comportamento de log atual do tratamento de status, nem o recebimento de eventos
subsequentes. Uma falha ao gravar um evento de consumo de WhatsApp SHALL ser registrada em
log e SHALL ser engolida. Quando o registro da fonte WhatsApp estiver desabilitado por
configuração, o tratamento das atualizações de status SHALL operar exatamente como opera sem
esta capability.

#### Scenario: Falha ao persistir o evento de consumo

- **WHEN** a gravação de um evento de consumo de WhatsApp falha (erro de escrita, indisponibilidade do armazenamento)
- **THEN** o sistema registra o erro em log e conclui o tratamento do evento de status sem lançar exceção e sem afetar a resposta 200 já enviada

#### Scenario: Registro da fonte WhatsApp desabilitado

- **WHEN** o registro da fonte WhatsApp está desligado por configuração e um evento de status com dados de precificação é recebido
- **THEN** nenhum evento de consumo de WhatsApp é gravado e a atualização de status é tratada e logada normalmente

### Requirement: Custo de mensageria estimado por tabela de preços da Meta versionada

O sistema SHALL manter no repositório uma tabela de preços de conversa da Meta — valor por
conversa, discriminado por categoria e por país do destinatário, com data de vigência. Como
o preço varia por país e o MVP não resolve o país real de cada destinatário, o sistema SHALL
assumir um **país-base configurável** para a estimativa. O custo de um evento de consumo de
WhatsApp NÃO SHALL ser gravado congelado no próprio evento: SHALL ser derivado na
leitura/agregação a partir da categoria e da tabela de preços vigente na data do evento, ou
o evento SHALL guardar a versão da tabela de preços usada para permitir a derivação estável.
Uma mudança futura na tabela de preços NÃO SHALL reescrever o custo de eventos passados.
Para uma combinação categoria/país sem preço cadastrado, o sistema SHALL manter os
contadores de conversa e SHALL marcar o custo como indisponível.

#### Scenario: Custo calculado na agregação

- **WHEN** uma consulta de agregação é feita sobre eventos de WhatsApp de uma categoria com preço cadastrado para o país-base
- **THEN** o custo estimado é calculado a partir da contagem de conversas e do preço vigente na data dos eventos

#### Scenario: Categoria sem preço cadastrado

- **WHEN** um evento de consumo se refere a uma combinação categoria/país que não consta na tabela de preços
- **THEN** a contagem de conversas permanece registrada e agregável, e o custo estimado desse evento é reportado como indisponível

#### Scenario: Mudança de preço não afeta eventos passados

- **WHEN** a tabela de preços da Meta é alterada e uma agregação sobre eventos anteriores à mudança é executada
- **THEN** o custo dos eventos anteriores é derivado com o preço vigente à época, não com o preço novo

### Requirement: Agregação de custo de mensageria WhatsApp por período

O sistema SHALL disponibilizar internamente consultas de agregação sobre os eventos de
consumo de WhatsApp que, dado um intervalo de tempo, retornem a contagem de conversas e o
custo estimado, tanto no total quanto agrupados por dia, por categoria e por lead. Um
intervalo sem eventos SHALL retornar zeros / série vazia, sem erro. As agregações SHALL
seguir o mesmo formato das agregações da fonte LLM já existente. Esta capability NÃO SHALL
expor rota HTTP, comando ou interface de usuário nova — as consultas são a base para os
endpoints da API de gestão.

#### Scenario: Agregado total num intervalo

- **WHEN** uma agregação de mensageria é solicitada para um intervalo com eventos
- **THEN** o sistema retorna a contagem total de conversas e o custo estimado total do intervalo

#### Scenario: Agregado agrupado

- **WHEN** uma agregação de mensageria é solicitada com agrupamento por dia, por categoria ou por lead
- **THEN** o sistema retorna uma linha por grupo com a contagem de conversas e o custo estimado do grupo

#### Scenario: Intervalo sem eventos

- **WHEN** uma agregação de mensageria é solicitada para um intervalo sem nenhum evento de consumo de WhatsApp
- **THEN** o sistema retorna zeros / série vazia sem lançar erro

#### Scenario: Nenhuma superfície nova

- **WHEN** esta capability é entregue
- **THEN** nenhuma rota HTTP, comando ou interface de usuário nova passa a existir por causa dela
