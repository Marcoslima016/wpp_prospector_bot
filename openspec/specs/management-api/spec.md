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

### Requirement: Handoff manual de uma conversa para atendimento humano

O sistema SHALL expor `POST /admin/api/conversations/:leadPhone/handoff`, protegido pela
sessão de usuário único, que coloca a conversa do lead no estado `awaitingHuman`. A partir
desse ponto o bot NÃO SHALL gerar resposta automática para as mensagens seguintes do lead,
até que a conversa seja retomada. A ação SHALL passar pelo processo do bot e ser serializada
na mesma fila por lead usada para processar mensagens recebidas, de modo a nunca competir
com uma geração de resposta em andamento. Quando não existir conversa para o telefone
informado, o sistema SHALL responder HTTP 404. Chamar o endpoint para uma conversa já em
`awaitingHuman` SHALL ser idempotente (sucesso, sem efeito adicional). A resposta de sucesso
SHALL devolver o estado atualizado da conversa em um contrato tipado.

#### Scenario: Handoff de uma conversa ativa

- **WHEN** um operador autenticado chama `POST /admin/api/conversations/:leadPhone/handoff` para uma conversa no estado `active`
- **THEN** o sistema marca a conversa como `awaitingHuman`, persiste a mudança e responde com sucesso e o estado atualizado

#### Scenario: Handoff idempotente

- **WHEN** o operador chama o endpoint de handoff para uma conversa que já está em `awaitingHuman`
- **THEN** o sistema responde com sucesso sem alterar nada além do que já estava

#### Scenario: Conversa inexistente

- **WHEN** o operador chama o endpoint de handoff para um telefone sem conversa persistida
- **THEN** o sistema responde HTTP 404 e nenhuma conversa é criada

#### Scenario: Sem sessão

- **WHEN** uma requisição chega ao endpoint de handoff sem cookie de sessão válido
- **THEN** o sistema responde HTTP 401 e não altera nenhuma conversa

#### Scenario: Bot para de responder após o handoff

- **WHEN** uma conversa foi colocada em `awaitingHuman` por handoff manual e o lead envia novas mensagens
- **THEN** o sistema registra as mensagens recebidas e não gera resposta automática enquanto o estado for `awaitingHuman`

### Requirement: Retomada de uma conversa pelo operador

O sistema SHALL expor `POST /admin/api/conversations/:leadPhone/resume`, protegido pela
sessão de usuário único, que devolve a conversa do lead ao estado `active`, fazendo o bot
voltar a responder automaticamente às próximas mensagens do lead. A retomada SHALL ser
válida tanto a partir de `awaitingHuman` quanto de `ended` (nesse caso reabrindo a conversa).
A ação SHALL ser serializada na mesma fila por lead das mensagens recebidas. Quando não
existir conversa para o telefone informado, o sistema SHALL responder HTTP 404. Chamar o
endpoint para uma conversa já em `active` SHALL ser idempotente. A resposta de sucesso SHALL
devolver o estado atualizado da conversa em um contrato tipado.

#### Scenario: Retomada a partir de atendimento humano

- **WHEN** um operador autenticado chama `POST /admin/api/conversations/:leadPhone/resume` para uma conversa em `awaitingHuman`
- **THEN** o sistema marca a conversa como `active`, persiste a mudança e o bot volta a responder às próximas mensagens do lead

#### Scenario: Retomada reabre uma conversa encerrada

- **WHEN** o operador chama o endpoint de resume para uma conversa em `ended`
- **THEN** o sistema reabre a conversa para `active` e responde com sucesso e o estado atualizado

#### Scenario: Retomada idempotente

- **WHEN** o operador chama o endpoint de resume para uma conversa que já está em `active`
- **THEN** o sistema responde com sucesso sem alterar nada

#### Scenario: Conversa inexistente

- **WHEN** o operador chama o endpoint de resume para um telefone sem conversa persistida
- **THEN** o sistema responde HTTP 404

#### Scenario: Sem sessão

- **WHEN** uma requisição chega ao endpoint de resume sem cookie de sessão válido
- **THEN** o sistema responde HTTP 401 e não altera nenhuma conversa

### Requirement: Envio de mensagem avulsa pelo operador

O sistema SHALL expor `POST /admin/api/conversations/:leadPhone/messages`, protegido pela
sessão de usuário único, que recebe um texto livre e o envia ao lead como mensagem de
sessão, delegando ao caso de uso de envio de texto já existente na conectividade com o
WhatsApp. O texto SHALL ser obrigatório e não vazio; um corpo inválido SHALL ser recusado
com HTTP 422 sem enviar nada. O envio SHALL exigir a janela de atendimento de 24 h aberta
para o lead: o sistema SHALL considerar a janela aberta quando houver ao menos um turno
recebido do lead nas últimas 24 h e, quando a janela estiver fechada, SHALL responder HTTP
409 com o motivo, sem tentar enviar. Se o gateway ainda assim rejeitar o envio por janela
expirada, o sistema SHALL mapear a falha para HTTP 409 com o motivo. Em caso de sucesso, o
sistema SHALL registrar um turno outbound na conversa marcado com origem de operador
(distinta da origem do bot) e persistir a conversa; o envio manual por si só NÃO SHALL
alterar o estado do ciclo de vida da conversa. A ação SHALL ser serializada na mesma fila
por lead das mensagens recebidas. Quando não existir conversa para o telefone informado, o
sistema SHALL responder HTTP 404. A resposta de sucesso SHALL devolver, em um contrato
tipado, a confirmação do envio e o turno registrado.

#### Scenario: Envio dentro da janela de 24 h

- **WHEN** um operador autenticado chama `POST /admin/api/conversations/:leadPhone/messages` com um texto não vazio e há um turno recebido do lead nas últimas 24 h
- **THEN** o sistema envia a mensagem ao lead, registra um turno outbound com origem de operador, persiste a conversa e responde com sucesso

#### Scenario: Janela de 24 h fechada

- **WHEN** o operador chama o endpoint de envio para um lead cujo último turno recebido é mais antigo que 24 h
- **THEN** o sistema responde HTTP 409 com o motivo e não envia a mensagem nem registra turno

#### Scenario: Gateway rejeita por janela expirada

- **WHEN** o operador chama o endpoint de envio e o gateway do WhatsApp rejeita a mensagem por estar fora da janela de atendimento
- **THEN** o sistema responde HTTP 409 com o motivo e não registra turno outbound

#### Scenario: Texto ausente ou vazio

- **WHEN** o operador chama o endpoint de envio com corpo sem texto ou com texto vazio
- **THEN** o sistema responde HTTP 422 e não envia nada

#### Scenario: Conversa inexistente

- **WHEN** o operador chama o endpoint de envio para um telefone sem conversa persistida
- **THEN** o sistema responde HTTP 404

#### Scenario: Sem sessão

- **WHEN** uma requisição chega ao endpoint de envio sem cookie de sessão válido
- **THEN** o sistema responde HTTP 401 e não envia nada

#### Scenario: Turno manual distinguível no histórico

- **WHEN** uma mensagem avulsa do operador é enviada com sucesso e depois a conversa é consultada pelo detalhe
- **THEN** o turno outbound correspondente aparece marcado com origem de operador, distinguível dos turnos gerados pelo bot

### Requirement: Serialização das ações de operação com o processamento do lead

O sistema SHALL executar toda mutação disparada pelos endpoints de ação sobre conversas
(handoff, retomada e envio de mensagem avulsa) dentro do processo do bot e na mesma fila
serial por lead usada para processar as mensagens recebidas daquele lead. Uma ação de
operação NÃO SHALL ler, mutar e gravar uma conversa em paralelo a uma geração de resposta
em andamento para o mesmo lead; ela SHALL aguardar a sua vez na fila. Ações para leads
diferentes PODEM ocorrer em paralelo.

#### Scenario: Ação enfileirada atrás de uma geração em andamento

- **WHEN** uma geração de resposta para um lead está em andamento e o operador dispara uma ação de operação para o mesmo lead
- **THEN** a ação só é aplicada após a geração em andamento concluir, sobre o estado já atualizado da conversa

#### Scenario: Duas ações de operação para o mesmo lead

- **WHEN** o operador dispara duas ações de operação para o mesmo lead em sequência rápida
- **THEN** o sistema as aplica uma de cada vez, na ordem de chegada, sem perder nenhuma alteração

### Requirement: Auditoria das ações de operação

O sistema SHALL registrar cada ação de operação sobre conversas (handoff, retomada e envio
de mensagem avulsa) como uma entrada append-only de auditoria contendo pelo menos: o autor
da ação (fixo `operator` enquanto não houver múltiplos usuários), o instante em que
ocorreu, o tipo de ação e o telefone do lead afetado. A auditoria SHALL ser best-effort:
uma falha ao gravar a entrada de auditoria NÃO SHALL falhar a ação já aplicada — o erro
SHALL ser registrado em log e a resposta da ação SHALL refletir o resultado da mutação.

#### Scenario: Ação bem-sucedida gera linha de auditoria

- **WHEN** uma ação de operação sobre uma conversa é aplicada com sucesso
- **THEN** o sistema grava uma entrada append-only de auditoria com autor `operator`, instante, tipo da ação e telefone do lead

#### Scenario: Falha de auditoria não desfaz a ação

- **WHEN** a gravação da entrada de auditoria falha após a ação já ter sido aplicada e persistida
- **THEN** o sistema registra o erro em log e responde com o resultado da ação, sem desfazê-la

### Requirement: Contratos de resposta tipados incluem os resultados das ações de operação

O sistema SHALL definir os formatos de resposta dos endpoints de ação sobre conversas
(resultado de handoff, de retomada e de envio de mensagem avulsa) como contratos
versionados e tipados, no mesmo módulo de contratos dos demais endpoints de gestão e
reutilizáveis pelo cliente da interface. Em ambientes de desenvolvimento e teste, essas
respostas SHALL ser validadas contra os contratos antes de serem enviadas.

#### Scenario: Resposta de ação conforme o contrato

- **WHEN** um endpoint de ação sobre conversas produz uma resposta em ambiente de desenvolvimento ou teste
- **THEN** a resposta é validada contra o contrato declarado e enviada quando conforme

#### Scenario: Divergência de formato numa resposta de ação é detectada

- **WHEN** um endpoint de ação tenta responder com um corpo que não bate com o contrato declarado, em desenvolvimento ou teste
- **THEN** a divergência é sinalizada em vez de passar silenciosamente

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
