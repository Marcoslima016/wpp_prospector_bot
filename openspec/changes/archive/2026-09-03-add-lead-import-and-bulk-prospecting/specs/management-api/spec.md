## ADDED Requirements

### Requirement: Listagem paginada e filtrável de leads

O sistema SHALL expor `GET /admin/api/leads`, protegido pela sessão de usuário único,
retornando uma página de leads a partir do armazenamento operacional. A resposta SHALL ser
paginada por cursor e SHALL informar o suficiente para o cliente navegar as páginas (tamanho
da página e como pedir a próxima). O endpoint SHALL aceitar filtros combináveis por estado
de prospecção (`pending`, `sent`, `replied`, `failed`), por trecho do telefone e por
segmento. O resultado SHALL ser ordenado de forma estável e determinística (por instante de
importação/atualização mais recente primeiro, com o telefone como desempate). Cada item
SHALL trazer ao menos o telefone, o nome de exibição, a empresa, o segmento, a cidade, a
origem, o estado de prospecção e os instantes de primeiro contato e de primeira resposta
quando houver. Uma consulta sem nenhum lead correspondente SHALL retornar uma página vazia
com sucesso, sem erro.

#### Scenario: Página padrão de leads

- **WHEN** um cliente autenticado chama `GET /admin/api/leads` sem filtros
- **THEN** o sistema retorna a primeira página de leads na ordem determinística definida, com os dados de paginação

#### Scenario: Filtro por estado de prospecção

- **WHEN** um cliente chama a listagem filtrando por estado `pending`
- **THEN** o sistema retorna apenas os leads nesse estado

#### Scenario: Filtros combinados

- **WHEN** um cliente chama a listagem filtrando por segmento e por trecho de telefone ao mesmo tempo
- **THEN** o sistema retorna apenas os leads que satisfazem os dois critérios

#### Scenario: Nenhum lead corresponde

- **WHEN** os filtros informados não correspondem a nenhum lead
- **THEN** o sistema retorna uma página vazia com sucesso e sem erro

#### Scenario: Sem sessão

- **WHEN** uma requisição chega a `GET /admin/api/leads` sem cookie de sessão válido
- **THEN** o sistema responde HTTP 401 sem retornar dados de leads

### Requirement: Descoberta de capacidades da API

O sistema SHALL expor `GET /admin/api/capabilities`, protegido pela sessão de usuário único,
retornando um objeto tipado que declara quais famílias de ação da superfície `/admin/api/`
estão disponíveis neste deploy — no mínimo `conversationActions` e `prospecting` — como
booleanos. O endpoint SHALL refletir o estado real de montagem das rotas correspondentes no
processo. A interface SHALL poder usar essa resposta para exibir ou ocultar afordâncias de
ação sem depender de tentar as rotas e tratar `404`.

#### Scenario: Capacidades declaradas

- **WHEN** um cliente autenticado chama `GET /admin/api/capabilities` num deploy com as rotas de prospecção montadas
- **THEN** o sistema responde com `prospecting: true` e com os demais sinalizadores conforme as rotas montadas

#### Scenario: Sem sessão

- **WHEN** uma requisição chega a `GET /admin/api/capabilities` sem cookie de sessão válido
- **THEN** o sistema responde HTTP 401

### Requirement: Contratos de resposta tipados incluem os recursos de leads

O sistema SHALL definir os formatos de resposta dos endpoints de leads (item de lista de
lead e página de leads, resultado da importação em lote, resultado do disparo de prospecção
em lote, resultado do reset de um lead) como contratos versionados e tipados, no mesmo
módulo de contratos dos demais endpoints de gestão e reutilizáveis pelo cliente da
interface. Em ambientes de desenvolvimento e teste, essas respostas SHALL ser validadas
contra os contratos antes de serem enviadas, de modo que uma divergência de formato seja
detectada.

#### Scenario: Resposta de leads conforme o contrato

- **WHEN** um endpoint de leads produz uma resposta em ambiente de desenvolvimento ou teste
- **THEN** a resposta é validada contra o contrato declarado e enviada quando conforme

#### Scenario: Divergência de formato numa resposta de leads é detectada

- **WHEN** um endpoint de leads tenta responder com um corpo que não bate com o contrato declarado, em desenvolvimento ou teste
- **THEN** a divergência é sinalizada em vez de passar silenciosamente
