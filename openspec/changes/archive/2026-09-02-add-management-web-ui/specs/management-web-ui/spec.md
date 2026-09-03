## Purpose

Oferece uma aplicação web autenticada de usuário único para operar e observar o bot de
prospecção: consome a `management-api`, dá visão navegável e filtrável das conversas com
detalhe por lead, apresenta um painel de consumo (tokens/custo de LLM e custo de WhatsApp)
por período, e serve de ponto de entrada para as ações de operação e de prospecção conforme
a API as expõe. Em produção é entregue como estático pelo próprio processo do bot sob
`/admin`.

## ADDED Requirements

### Requirement: Aplicação web entregue como artefato estático único

O sistema SHALL produzir a interface visual de gestão como uma aplicação de página única
(SPA) cujo build é um conjunto de arquivos estáticos servidos pelo próprio processo do bot
sob o prefixo `/admin` (caminhos fora de `/admin/api/`), reusando o mecanismo de estáticos
com fallback de SPA já definido pela `management-api`. A aplicação SHALL ser construída para
operar sob o caminho base `/admin` (assets e rotas de navegação resolvidos relativos a esse
prefixo). Não SHALL haver um segundo processo de servidor em produção. Em desenvolvimento a
aplicação SHALL ser servida por um dev server próprio que encaminha as chamadas de
`/admin/api` para o processo do bot, sem exigir build.

#### Scenario: Navegação sob o caminho base

- **WHEN** um navegador acessa `/admin` ou uma rota de navegação da interface (por exemplo `/admin/conversations`) com o build presente no deploy
- **THEN** o sistema serve a aplicação e ela carrega seus assets e resolve suas rotas internas sob o prefixo `/admin`, sem depender de um servidor adicional

#### Scenario: Recarga em uma rota profunda

- **WHEN** o operador recarrega a página estando em uma rota de navegação interna da interface
- **THEN** a aplicação volta a montar na mesma rota, apoiada no fallback de `index.html` da `management-api`, sem erro 404 de navegação

#### Scenario: Desenvolvimento sem build

- **WHEN** a interface roda em modo de desenvolvimento pelo seu dev server e faz uma chamada para `/admin/api/...`
- **THEN** a chamada é encaminhada ao processo do bot e respondida, sem necessidade de gerar o build estático

### Requirement: Acesso condicionado à sessão de gestão

A interface SHALL exigir uma sessão de gestão válida para exibir qualquer dado do bot. Sem
sessão, o operador SHALL ver apenas uma tela de login que troca o segredo compartilhado por
uma sessão via `POST /admin/api/session`. Com a sessão estabelecida, a interface SHALL
revelar a navegação autenticada (conversas, consumo e ações). Uma resposta `401` de qualquer
chamada a `/admin/api/` SHALL levar a interface de volta à tela de login sem exibir dados
obsoletos. A interface SHALL oferecer um logout que chama `DELETE /admin/api/session` e
retorna à tela de login. A interface NÃO SHALL tentar ler o cookie de sessão diretamente
(ele é `HttpOnly`); o estado "autenticado" SHALL ser inferido do resultado das chamadas à
API.

#### Scenario: Login com o segredo correto

- **WHEN** o operador informa o segredo compartilhado correto na tela de login
- **THEN** a interface cria a sessão via `POST /admin/api/session`, passa a exibir a navegação autenticada e carrega os dados da primeira tela

#### Scenario: Login com o segredo errado

- **WHEN** o operador informa um segredo que a API recusa com `401`
- **THEN** a interface permanece na tela de login, sinaliza a falha e não exibe nenhum dado de gestão

#### Scenario: Sessão expirada durante o uso

- **WHEN** a interface está exibindo uma tela autenticada e uma chamada a `/admin/api/` passa a responder `401`
- **THEN** a interface retorna à tela de login e deixa de exibir os dados carregados anteriormente

#### Scenario: Logout

- **WHEN** o operador aciona o logout em uma tela autenticada
- **THEN** a interface chama `DELETE /admin/api/session` e volta à tela de login; uma nova navegação exige autenticar de novo

### Requirement: Listagem de conversas navegável e filtrável

A interface SHALL apresentar uma tela de conversas que consome `GET /admin/api/conversations`
e exibe, por linha, ao menos o telefone do lead, o estado da conversa, o intent, a
qualificação, a contagem de turnos, o instante da última atividade e a marcação de inbound
pendente. A tela SHALL oferecer filtros combináveis por estado (`active`, `ended`,
`awaitingHuman`), por intent do lead, por trecho do telefone e por faixa de data de última
atividade, repassando-os como query à API. A listagem SHALL respeitar a ordenação por última
atividade (mais recente primeiro) devolvida pela API e SHALL permitir avançar as páginas
usando o cursor da resposta. Uma consulta sem resultados SHALL mostrar um estado vazio
explícito, não um erro.

#### Scenario: Página inicial de conversas

- **WHEN** o operador abre a tela de conversas sem aplicar filtros
- **THEN** a interface exibe a primeira página de conversas na ordem devolvida pela API e um controle para carregar a próxima página quando houver cursor

#### Scenario: Filtros combinados

- **WHEN** o operador aplica ao mesmo tempo um filtro de estado e uma faixa de data de última atividade
- **THEN** a interface repassa os dois critérios na chamada e exibe somente as conversas devolvidas para essa combinação

#### Scenario: Busca por trecho de telefone

- **WHEN** o operador digita um trecho de número de telefone no filtro correspondente
- **THEN** a interface consulta a API com esse trecho e lista as conversas devolvidas

#### Scenario: Nenhuma conversa corresponde

- **WHEN** os filtros aplicados não retornam nenhuma conversa
- **THEN** a interface mostra um estado vazio informativo e nenhum erro

### Requirement: Detalhe de uma conversa

A interface SHALL apresentar uma tela de detalhe que consome
`GET /admin/api/conversations/:leadPhone` e exibe a linha do tempo dos turnos (inbound e
outbound, com texto e instante), o intent e a qualificação do lead, os módulos/assuntos
identificados, o plano citado quando houver, e as flags de inbound pendente e de
abandono/inatividade. Quando a API responder `404` para o telefone, a interface SHALL
exibir um estado de "conversa não encontrada", não uma falha genérica.

#### Scenario: Detalhe de uma conversa existente

- **WHEN** o operador abre o detalhe de um lead com conversa persistida
- **THEN** a interface exibe a linha do tempo dos turnos e os campos de intent, qualificação, módulos, plano citado e as flags de pendência e de abandono

#### Scenario: Conversa inexistente

- **WHEN** o operador abre o detalhe de um telefone para o qual a API responde `404`
- **THEN** a interface exibe um estado de "conversa não encontrada" e um caminho de volta para a listagem

### Requirement: Painel de consumo por período

A interface SHALL apresentar um painel de consumo que consome
`GET /admin/api/stats/consumption` para um intervalo selecionável (ao menos hoje, últimos
7 dias, últimos 30 dias e um intervalo personalizado) e permite alternar o agrupamento entre
dia, lead, modelo e categoria de chamada. O painel SHALL exibir os contadores de token
somados e o custo estimado por grupo e o total do intervalo, incluindo o custo de WhatsApp
por categoria quando presente na resposta, e SHALL sinalizar quando o custo do grupo estiver
parcial (modelo sem preço cadastrado). O painel SHALL também exibir os contadores do "agora"
de `GET /admin/api/stats/overview` (conversas por estado, total de leads, inbound pendente).
Um intervalo sem eventos SHALL ser exibido como série vazia / zeros, não como erro.

#### Scenario: Consumo agrupado por dia

- **WHEN** o operador seleciona um intervalo e o agrupamento por dia
- **THEN** a interface exibe uma visão com uma entrada por dia (tokens somados e custo estimado) e o total do intervalo

#### Scenario: Alternância de agrupamento

- **WHEN** o operador alterna o agrupamento entre lead, modelo e categoria de chamada
- **THEN** a interface refaz a consulta com o novo agrupamento e exibe uma entrada por grupo com tokens somados e custo estimado

#### Scenario: Custo parcial sinalizado

- **WHEN** a resposta indica que algum grupo tem custo parcial por modelo sem preço cadastrado
- **THEN** a interface marca visualmente esse grupo como custo parcial

#### Scenario: Intervalo sem eventos

- **WHEN** o operador escolhe um intervalo sem nenhum evento de consumo
- **THEN** a interface exibe série vazia / zeros com sucesso, sem erro

#### Scenario: Contadores do agora

- **WHEN** o painel de consumo é aberto
- **THEN** a interface exibe os contadores de conversas por estado, total de leads e inbound pendente devolvidos por `GET /admin/api/stats/overview`

### Requirement: Atualização periódica dos dados exibidos

As telas de dados da interface SHALL se manter atualizadas por consulta periódica à API
(polling) enquanto visíveis, sem recarregar a página inteira e sem depender de um canal de
eventos do servidor. A consulta periódica SHALL ser suspensa quando a aba não está visível e
retomada quando volta a ficar visível, para não gerar carga desnecessária no processo único
do bot.

#### Scenario: Atualização enquanto a tela está aberta

- **WHEN** uma tela de dados permanece aberta e o estado no servidor muda (nova conversa, novo turno, novo evento de consumo)
- **THEN** a interface reflete a mudança na próxima consulta periódica, sem recarregar a página

#### Scenario: Aba em segundo plano

- **WHEN** a aba da interface deixa de estar visível
- **THEN** a interface suspende as consultas periódicas até a aba voltar a ficar visível

### Requirement: Consumo dos contratos versionados da API

A interface SHALL consumir os contratos de resposta versionados e tipados definidos pela
`management-api` (item de lista de conversa, detalhe de conversa, série de consumo e
contadores do estado atual) como fonte única dos tipos do cliente HTTP. A interface SHALL
validar as respostas recebidas contra esses contratos antes de renderizá-las e, ao detectar
uma resposta que não bate com o contrato conhecido, SHALL exibir um aviso de incompatibilidade
(indicando a versão de contrato que a interface espera) em vez de renderizar dados possivelmente
incorretos.

#### Scenario: Resposta conforme o contrato

- **WHEN** a interface recebe uma resposta de um endpoint de gestão que bate com o contrato que ela conhece
- **THEN** a interface renderiza os dados normalmente

#### Scenario: Resposta divergente do contrato

- **WHEN** a interface recebe de um endpoint de gestão um corpo que não valida contra o contrato conhecido
- **THEN** a interface exibe um aviso de incompatibilidade de contrato, com a versão esperada, e não renderiza aquele dado como se estivesse correto

### Requirement: Superfície de ações condicionada à disponibilidade da API

A interface SHALL organizar as ações de operação sobre uma conversa (assumir atendimento,
retomar o bot, enviar mensagem avulsa) e a prospecção de leads (cadastrar lead, disparar
template) como afordâncias acopladas aos respectivos endpoints de `/admin/api/`. Quando um
endpoint de ação não estiver disponível no deploy (a API responde como rota inexistente ou
não implementada), a interface NÃO SHALL exibir um controle de ação quebrado: o controle
SHALL ficar oculto ou desabilitado com indicação de indisponível. Quando o endpoint estiver
disponível, a interface SHALL executar a ação e, diante de uma recusa com motivo (por
exemplo, janela de 24 h fechada para mensagem avulsa), SHALL exibir o motivo devolvido pela
API sem descartar o restante da tela.

#### Scenario: Endpoint de ação ausente no deploy

- **WHEN** a interface roda contra um deploy cuja API ainda não expõe um endpoint de ação
- **THEN** a interface não apresenta um controle de ação acionável para essa operação (oculto ou desabilitado como indisponível)

#### Scenario: Ação disponível executada com sucesso

- **WHEN** o endpoint de ação está disponível e o operador aciona a ação a partir do detalhe da conversa
- **THEN** a interface chama o endpoint e reflete o novo estado da conversa na tela

#### Scenario: Ação recusada com motivo

- **WHEN** o operador aciona uma ação e a API a recusa devolvendo um motivo (por exemplo, janela de 24 h fechada)
- **THEN** a interface exibe o motivo devolvido e mantém o restante da tela utilizável
