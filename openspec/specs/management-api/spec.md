# management-api Specification

## Purpose

Expõe uma API HTTP autenticada de gestão, separada do webhook público, para um único
operador observar o estado operacional do bot: autenticação por sessão assinada,
listagem/filtragem/paginação e detalhe de conversas, e consulta às estatísticas de consumo
por período. Somente leitura nesta capability.

## Requirements

### Requirement: Superfície de gestão isolada do webhook público

O sistema SHALL expor os recursos de gestão sob o prefixo de caminho `/admin`, no mesmo
processo que atende o webhook do WhatsApp, de modo que o parsing e as rotas de `/admin` NÃO
interfiram com o parsing de corpo bruto usado pela verificação de assinatura do webhook. A
superfície `/admin` SHALL ser condicionada por configuração (`ADMIN_ENABLED`, default
ligado): quando desligada, nenhuma rota `/admin` SHALL responder e o webhook SHALL continuar
operando normalmente. Nenhum requisito de comportamento do webhook público muda por causa
desta capability.

#### Scenario: Webhook segue funcionando com a gestão ligada

- **WHEN** a superfície `/admin` está ligada e chega um POST de webhook do WhatsApp com assinatura válida
- **THEN** a validação de assinatura e o encaminhamento da mensagem inbound ocorrem exatamente como antes desta capability

#### Scenario: Gestão desligada por configuração

- **WHEN** `ADMIN_ENABLED` está desligado e chega uma requisição para qualquer caminho sob `/admin`
- **THEN** o sistema não atende a rota de gestão e o webhook continua respondendo normalmente

### Requirement: Autenticação de usuário único por sessão assinada

O sistema SHALL proteger todo endpoint sob `/admin/api/` — exceto a criação de sessão — com
uma sessão de usuário único. A sessão SHALL ser criada trocando um segredo compartilhado
(`ADMIN_ACCESS_SECRET`) por um cookie de sessão assinado com um segredo de servidor
(`ADMIN_SESSION_SECRET`). O cookie SHALL ser `HttpOnly`, `SameSite=Strict`, `Secure` e
limitado ao caminho `/admin`, e SHALL carregar um instante de emissão e um instante de
expiração cobertos pela assinatura. Uma requisição a `/admin/api/` protegido sem cookie, com
cookie de assinatura inválida, ou com a expiração vencida, SHALL ser recusada com HTTP 401 e
NÃO SHALL revelar dados de gestão. Trocar `ADMIN_SESSION_SECRET` SHALL invalidar todas as
sessões existentes. Não há modelo de papéis, dono, refresh token nem revogação individual
antes da expiração.

#### Scenario: Login com o segredo correto

- **WHEN** um cliente envia `POST /admin/api/session` com o segredo igual a `ADMIN_ACCESS_SECRET`
- **THEN** o sistema responde com sucesso e define o cookie de sessão assinado, com instante de emissão e expiração

#### Scenario: Login com o segredo errado

- **WHEN** um cliente envia `POST /admin/api/session` com um segredo diferente de `ADMIN_ACCESS_SECRET`
- **THEN** o sistema recusa a criação da sessão e não define cookie

#### Scenario: Acesso sem sessão

- **WHEN** uma requisição chega a um endpoint sob `/admin/api/` protegido sem cookie de sessão válido
- **THEN** o sistema responde HTTP 401 sem retornar dados de gestão

#### Scenario: Sessão expirada

- **WHEN** uma requisição chega a um endpoint protegido com um cookie de sessão cuja expiração já passou
- **THEN** o sistema responde HTTP 401 e o cliente precisa criar uma nova sessão

#### Scenario: Logout

- **WHEN** um cliente autenticado envia `DELETE /admin/api/session`
- **THEN** o sistema expira o cookie de sessão e requisições subsequentes a endpoints protegidos passam a responder HTTP 401

#### Scenario: Rotação do segredo de servidor invalida sessões

- **WHEN** `ADMIN_SESSION_SECRET` é alterado e um cliente reaproveita um cookie emitido com o segredo anterior
- **THEN** o sistema trata o cookie como inválido e responde HTTP 401

### Requirement: Projeção de leitura de conversas em sincronia com o repositório

O sistema SHALL manter um índice de leitura das conversas usado para listagem, filtro,
paginação e contadores. O arquivo por lead SHALL permanecer a fonte da verdade; o índice é
derivado. O índice SHALL ser materializado no boot a partir das conversas persistidas
existentes e SHALL ser atualizado sempre que uma conversa for gravada, refletindo pelo menos
o estado da conversa, o intent e a qualificação do lead, a contagem de turnos, o instante da
última atividade e se há mensagem inbound pendente. Uma falha ao atualizar o índice NÃO
SHALL falhar a gravação da conversa: o erro SHALL ser registrado em log e engolido, e o
índice SHALL se reconstruir no próximo boot. O motor de conversas NÃO SHALL depender do
índice nem tomar conhecimento dele.

#### Scenario: Índice populado no boot

- **WHEN** o sistema inicia e existem conversas persistidas mas o índice de leitura está vazio ou marcado como desatualizado
- **THEN** o sistema varre as conversas persistidas uma vez e popula o índice com uma entrada por lead

#### Scenario: Índice atualizado ao gravar uma conversa

- **WHEN** uma conversa é gravada após ser processada
- **THEN** a entrada correspondente no índice passa a refletir o novo estado, contagem de turnos, última atividade e pendência de inbound

#### Scenario: Falha ao atualizar o índice não quebra a gravação

- **WHEN** a atualização do índice falha durante a gravação de uma conversa
- **THEN** a conversa é gravada normalmente no arquivo, o erro é registrado em log, e o índice é reconstruído no próximo boot

#### Scenario: Nova conversa aparece na listagem

- **WHEN** uma conversa nunca vista antes é gravada pela primeira vez
- **THEN** ela passa a aparecer na listagem paginada de conversas sem reiniciar o processo

### Requirement: Listagem paginada e filtrável de conversas

O sistema SHALL expor `GET /admin/api/conversations` retornando uma página de conversas a
partir do índice de leitura. A resposta SHALL ser paginada e SHALL informar o suficiente
para o cliente navegar as páginas (tamanho da página e como pedir a próxima). O endpoint
SHALL aceitar filtros por estado da conversa (`active`, `ended`, `awaitingHuman`), por
intent do lead, por trecho do telefone e por faixa de data de última atividade, combináveis.
O resultado SHALL ser ordenado por última atividade, do mais recente para o mais antigo. Uma
consulta sem nenhuma conversa correspondente SHALL retornar uma página vazia com sucesso,
sem erro.

#### Scenario: Página padrão ordenada por última atividade

- **WHEN** um cliente autenticado chama `GET /admin/api/conversations` sem filtros
- **THEN** o sistema retorna a primeira página de conversas ordenadas da última atividade mais recente para a mais antiga, com os dados de paginação

#### Scenario: Filtro por estado

- **WHEN** um cliente chama a listagem filtrando por estado `awaitingHuman`
- **THEN** o sistema retorna apenas as conversas nesse estado

#### Scenario: Filtros combinados

- **WHEN** um cliente chama a listagem filtrando por intent do lead e por faixa de data de última atividade ao mesmo tempo
- **THEN** o sistema retorna apenas as conversas que satisfazem os dois critérios

#### Scenario: Busca por trecho do telefone

- **WHEN** um cliente chama a listagem passando um trecho de número de telefone
- **THEN** o sistema retorna as conversas cujo telefone do lead contém esse trecho

#### Scenario: Nenhuma conversa corresponde

- **WHEN** os filtros informados não correspondem a nenhuma conversa
- **THEN** o sistema retorna uma página vazia com sucesso e sem erro

### Requirement: Detalhe completo de uma conversa

O sistema SHALL expor `GET /admin/api/conversations/:leadPhone` retornando o detalhe
completo de uma conversa lido a partir da fonte da verdade (o arquivo do lead), não do
índice. O detalhe SHALL incluir o histórico de turnos, o intent e a qualificação do lead, os
módulos/assuntos identificados, o plano citado quando houver, e as flags de pendência de
inbound e de abandono/inatividade. Quando não existir conversa para o telefone informado, o
sistema SHALL responder HTTP 404.

#### Scenario: Detalhe de uma conversa existente

- **WHEN** um cliente autenticado chama `GET /admin/api/conversations/:leadPhone` para um lead com conversa persistida
- **THEN** o sistema retorna o histórico de turnos, intent, qualificação, módulos, plano citado e as flags de pendência e de abandono

#### Scenario: Detalhe reflete a fonte da verdade

- **WHEN** o arquivo de uma conversa foi atualizado e o cliente pede o detalhe dessa conversa
- **THEN** o detalhe retornado corresponde ao conteúdo atual do arquivo, mesmo que o índice ainda não tenha sido atualizado

#### Scenario: Conversa inexistente

- **WHEN** um cliente pede o detalhe de um telefone sem conversa persistida
- **THEN** o sistema responde HTTP 404

### Requirement: Estatísticas de consumo por período

O sistema SHALL expor `GET /admin/api/stats/consumption` retornando agregações de consumo
(LLM e, quando disponível, WhatsApp) para um intervalo `from`/`to`, com agrupamento
selecionável por dia, por lead, por modelo e por categoria de chamada. A resposta SHALL
incluir os contadores de token somados e o custo estimado por grupo e no total, delegando o
cálculo às consultas de agregação da capability de métricas de consumo. Quando as tabelas de
eventos de consumo ainda não existirem no deploy, ou o intervalo não tiver eventos, o
endpoint SHALL responder série vazia / zeros com sucesso, sem erro.

#### Scenario: Consumo agrupado por dia

- **WHEN** um cliente autenticado chama `GET /admin/api/stats/consumption` com um intervalo e `groupBy=day`
- **THEN** o sistema retorna uma linha por dia com os tokens somados e o custo estimado, mais o total do intervalo

#### Scenario: Consumo agrupado por lead, modelo ou categoria

- **WHEN** um cliente chama o endpoint variando o agrupamento entre lead, modelo e categoria de chamada
- **THEN** o sistema retorna uma linha por grupo com os tokens somados e o custo estimado do grupo

#### Scenario: Intervalo sem eventos

- **WHEN** um cliente pede o consumo de um intervalo sem nenhum evento registrado
- **THEN** o sistema retorna série vazia / zeros com sucesso

#### Scenario: Tabelas de consumo ausentes no deploy

- **WHEN** as tabelas de eventos de consumo ainda não foram criadas neste deploy e o endpoint é chamado
- **THEN** o sistema trata a ausência como "sem dados" e responde série vazia / zeros sem erro

### Requirement: Contadores do estado atual

O sistema SHALL expor `GET /admin/api/stats/overview` retornando contadores do "agora"
derivados do índice de leitura: a quantidade de conversas por estado, o total de leads e a
quantidade de conversas com inbound pendente. O endpoint SHALL responder com sucesso mesmo
quando não há nenhuma conversa, retornando zeros.

#### Scenario: Contadores com conversas registradas

- **WHEN** um cliente autenticado chama `GET /admin/api/stats/overview` e existem conversas no índice
- **THEN** o sistema retorna a contagem de conversas por estado, o total de leads e a contagem de conversas com inbound pendente

#### Scenario: Nenhuma conversa

- **WHEN** o índice de leitura está vazio e o endpoint é chamado
- **THEN** o sistema retorna todos os contadores zerados com sucesso

### Requirement: Contratos de resposta tipados e estáveis

O sistema SHALL definir os formatos de resposta dos endpoints de gestão (item de lista de
conversa, detalhe de conversa, série de consumo e contadores do estado atual) como
contratos versionados e tipados, reutilizáveis pelo cliente da interface. Em ambientes de
desenvolvimento e teste, as respostas SHALL ser validadas contra esses contratos antes de
serem enviadas, de modo que uma divergência de formato seja detectada.

#### Scenario: Resposta conforme o contrato

- **WHEN** um endpoint de gestão produz uma resposta em ambiente de desenvolvimento ou teste
- **THEN** a resposta é validada contra o contrato declarado e enviada quando conforme

#### Scenario: Divergência de formato detectada

- **WHEN** um endpoint tenta responder com um corpo que não bate com o contrato declarado, em desenvolvimento ou teste
- **THEN** a divergência é sinalizada em vez de passar silenciosamente

### Requirement: Servir a interface visual quando o build existe

O sistema SHALL servir os arquivos estáticos da interface visual de gestão sob `/admin`
(caminhos fora de `/admin/api/`) quando o diretório de build da interface existir no deploy,
com fallback de aplicação de página única (servir o `index.html` para caminhos de navegação
que não sejam de API). Quando o diretório de build não existir, o sistema NÃO SHALL falhar
no boot por causa disso e os endpoints `/admin/api/` SHALL continuar funcionando
normalmente.

#### Scenario: Build presente

- **WHEN** o diretório de build da interface existe e um navegador acessa `/admin` ou uma rota de navegação da interface
- **THEN** o sistema serve os arquivos estáticos e, para rotas de navegação, devolve o `index.html`

#### Scenario: Build ausente

- **WHEN** o diretório de build da interface não existe no deploy
- **THEN** o sistema inicia normalmente e os endpoints sob `/admin/api/` seguem respondendo
