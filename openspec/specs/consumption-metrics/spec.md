# consumption-metrics Specification

## Purpose

Registra, de forma append-only e com timestamp, o consumo de recursos pagos gerado por
cada interação do bot e disponibiliza agregações desse consumo por período. Esta capability
cobre a **fonte LLM** — tokens e custo estimado de cada chamada à Anthropic, atribuídos a
lead, modelo e tipo de chamada. A fonte WhatsApp (conversas de 24 h da Cloud API) é
adicionada por uma change posterior.

## Requirements

### Requirement: Registro append-only de consumo de LLM por chamada

O sistema SHALL registrar cada chamada ao LLM feita no fluxo de interpretação de mensagens
(geração da decisão e extração de sinais de busca) como um evento imutável de consumo. Cada
evento SHALL conter: o instante da chamada, o tipo de chamada (`reply-generation` ou
`signal-extraction`), o modelo efetivamente usado, os quatro contadores de token da
resposta (entrada, saída, leitura de cache, escrita de cache), o telefone do lead quando a
chamada estiver associada a uma conversa, e o identificador de requisição do provider
quando disponível. O sistema SHALL gravar **uma linha por chamada** e NÃO SHALL atualizar
um acumulado — o registro é uma série temporal, somente-acréscimo.

#### Scenario: Chamada de geração da decisão registrada

- **WHEN** a consulta ao LLM que gera a decisão do bot para um lead retorna
- **THEN** o sistema grava um evento de consumo com `callType` `reply-generation`, o modelo usado, os contadores de token da resposta e o telefone do lead

#### Scenario: Chamada de extração de sinais registrada

- **WHEN** a consulta ao LLM que extrai os sinais de busca do turno retorna
- **THEN** o sistema grava um evento de consumo com `callType` `signal-extraction`, o modelo usado, os contadores de token e o telefone do lead

#### Scenario: Chamada sem lead associado

- **WHEN** uma chamada ao LLM ocorre sem uma conversa/telefone de lead associado
- **THEN** o sistema grava o evento de consumo com o telefone do lead ausente, sem falhar

#### Scenario: Eventos nunca são reescritos

- **WHEN** novas chamadas ao LLM ocorrem para um lead que já tem eventos registrados
- **THEN** o sistema acrescenta novas linhas e não altera nem remove os eventos já gravados

### Requirement: Registro de consumo é best-effort

O registro do consumo NÃO SHALL alterar o resultado da interpretação nem o comportamento de
falha/retry existente do fluxo. Uma falha ao gravar um evento de consumo SHALL ser
registrada em log e SHALL ser engolida — a geração e o envio da resposta ao lead seguem
normalmente. Quando o registro de consumo estiver desabilitado por configuração, o fluxo de
interpretação SHALL operar exatamente como opera sem esta capability.

#### Scenario: Falha ao persistir o evento

- **WHEN** a gravação de um evento de consumo falha (erro de escrita, indisponibilidade do armazenamento)
- **THEN** o sistema registra o erro em log e conclui a interpretação e o envio da resposta sem lançar exceção

#### Scenario: Registro de consumo desabilitado

- **WHEN** o registro de consumo está desligado por configuração e uma mensagem de lead é interpretada
- **THEN** nenhum evento de consumo é gravado e a decisão do bot é produzida e enviada normalmente

### Requirement: Custo estimado derivado de tabela de preços versionada

O sistema SHALL manter no repositório uma tabela de preços por modelo — valor por milhão de
tokens, discriminado por tipo de token, com data de vigência. O custo de um evento NÃO
SHALL ser gravado congelado no próprio evento: SHALL ser derivado na leitura/agregação a
partir dos contadores de token e da tabela de preços vigente na data do evento, ou o evento
SHALL guardar a versão da tabela de preços usada para permitir a derivação estável. Uma
mudança futura na tabela de preços NÃO SHALL reescrever o custo de eventos passados. Para um
modelo sem preço cadastrado, o sistema SHALL manter os contadores de token e SHALL marcar o
custo como indisponível.

#### Scenario: Custo calculado na agregação

- **WHEN** uma consulta de agregação é feita sobre eventos de um modelo com preço cadastrado
- **THEN** o custo estimado é calculado a partir dos contadores de token e da tabela de preços vigente na data dos eventos

#### Scenario: Modelo sem preço cadastrado

- **WHEN** um evento de consumo se refere a um modelo que não consta na tabela de preços
- **THEN** os contadores de token permanecem registrados e agregáveis, e o custo estimado desse evento é reportado como indisponível

#### Scenario: Mudança de preço não afeta eventos passados

- **WHEN** a tabela de preços é alterada e uma agregação sobre eventos anteriores à mudança é executada
- **THEN** o custo dos eventos anteriores é derivado com o preço vigente à época, não com o preço novo

### Requirement: Agregação de consumo de LLM por período

O sistema SHALL disponibilizar internamente consultas de agregação sobre os eventos de
consumo de LLM que, dado um intervalo de tempo, retornem os contadores de token somados e o
custo estimado, tanto no total quanto agrupados por dia, por lead, por modelo e por tipo de
chamada. Um intervalo sem eventos SHALL retornar zeros / série vazia, sem erro. Esta
capability NÃO SHALL expor rota HTTP, comando ou interface de usuário — as consultas são a
base para os endpoints da API de gestão.

#### Scenario: Agregado total num intervalo

- **WHEN** uma agregação é solicitada para um intervalo com eventos
- **THEN** o sistema retorna a soma dos contadores de token e o custo estimado total do intervalo

#### Scenario: Agregado agrupado

- **WHEN** uma agregação é solicitada com agrupamento por dia, por lead, por modelo ou por tipo de chamada
- **THEN** o sistema retorna uma linha por grupo com os contadores de token somados e o custo estimado do grupo

#### Scenario: Intervalo sem eventos

- **WHEN** uma agregação é solicitada para um intervalo sem nenhum evento de consumo
- **THEN** o sistema retorna zeros / série vazia sem lançar erro

#### Scenario: Nenhuma superfície nova

- **WHEN** esta capability é entregue
- **THEN** nenhuma rota HTTP, comando ou interface de usuário nova passa a existir por causa dela
