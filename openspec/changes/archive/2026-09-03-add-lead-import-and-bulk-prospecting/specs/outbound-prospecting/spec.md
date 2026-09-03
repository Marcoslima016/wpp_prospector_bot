## MODIFIED Requirements

### Requirement: Cadastro de lead para prospecção

O sistema SHALL expor `POST /admin/api/leads`, protegido pela sessão de usuário único da API
de gestão, que registra um lead a partir de um telefone no formato E.164 e de campos
opcionais de contexto (nome, origem, notas, **empresa, segmento, cidade**). O lead SHALL ser
persistido no armazenamento operacional (`operational-data-store`) e SHALL ser deduplicado
por telefone: um segundo cadastro do mesmo telefone NÃO SHALL criar um segundo registro —
SHALL atualizar os campos de contexto informados e responder com sucesso, preservando o
estado de prospecção corrente. Um telefone fora do formato E.164 SHALL ser recusado com HTTP
422 sem persistir nada. A resposta de sucesso SHALL devolver, em um contrato tipado, o lead
registrado com o seu estado de prospecção e com os campos de contexto (incluindo empresa,
segmento e cidade, `null` quando ausentes).

#### Scenario: Lead novo cadastrado

- **WHEN** um operador autenticado envia `POST /admin/api/leads` com um telefone E.164 válido e campos de contexto
- **THEN** o sistema persiste um novo lead com estado de prospecção `pending` e responde com sucesso e o lead registrado, incluindo empresa, segmento e cidade quando informados

#### Scenario: Telefone já cadastrado

- **WHEN** o operador cadastra um telefone que já existe como lead
- **THEN** o sistema não cria um segundo registro, atualiza os campos de contexto informados, mantém o estado de prospecção atual e responde com sucesso

#### Scenario: Telefone em formato inválido

- **WHEN** o operador envia um cadastro cujo telefone não está no formato E.164
- **THEN** o sistema responde HTTP 422 e não persiste nenhum lead

#### Scenario: Sem sessão

- **WHEN** uma requisição chega a `POST /admin/api/leads` sem cookie de sessão válido
- **THEN** o sistema responde HTTP 401 e não persiste nenhum lead

## ADDED Requirements

### Requirement: Importação de leads em lote sem disparo

O sistema SHALL expor `POST /admin/api/leads/import`, protegido pela sessão de usuário
único, que recebe uma coleção de leads já extraídos e normalizados pelo cliente — cada item
com um telefone E.164 e campos opcionais de contexto (`company`, `segment`, `city`,
`displayName`, `source`, `notes`) — e os persiste em lote no armazenamento operacional. A
importação SHALL registrar cada lead com estado de prospecção `pending` quando novo e SHALL
ser deduplicada por telefone; para um telefone já existente ela SHALL **sobrescrever** os
campos de contexto informados com os valores recebidos (o arquivo importado é a fonte da
verdade da importação) e SHALL preservar o estado de prospecção corrente. A importação NÃO
SHALL, em nenhuma hipótese, enviar mensagem de template nem semear conversa.

Itens com telefone ausente ou fora do formato E.164 SHALL ser rejeitados individualmente,
sem abortar o lote; a resposta SHALL devolver, em um contrato tipado, o total de leads
criados, o total atualizados e a lista de itens rejeitados com o índice/linha de origem e um
motivo identificável. Um lote acima do limite máximo configurado de itens SHALL ser recusado
com HTTP 422 sem persistir nada. Duas ocorrências do mesmo telefone dentro do mesmo lote
SHALL resultar em um único lead, com a última ocorrência prevalecendo.

#### Scenario: Lote com leads novos e já existentes

- **WHEN** um operador autenticado envia `POST /admin/api/leads/import` com um telefone novo e um telefone já cadastrado, ambos E.164 válidos
- **THEN** o sistema cria o lead novo com estado `pending`, sobrescreve os campos de contexto do lead existente com os valores do lote, preserva o estado de prospecção do existente e responde com os totais de criados e atualizados

#### Scenario: Linhas inválidas não abortam o lote

- **WHEN** o lote contém itens com telefone vazio e com telefone fora do formato E.164 ao lado de itens válidos
- **THEN** o sistema persiste os itens válidos e devolve os itens inválidos na lista de rejeitados, cada um com a linha de origem e o motivo, sem falhar a requisição

#### Scenario: Importação nunca dispara

- **WHEN** um lote de leads é importado com sucesso
- **THEN** nenhum template é enviado, nenhuma conversa é semeada e todos os leads novos ficam em estado `pending`

#### Scenario: Telefone repetido no mesmo lote

- **WHEN** o lote traz o mesmo telefone em duas linhas com campos de contexto diferentes
- **THEN** o sistema persiste um único lead com os valores da última ocorrência

#### Scenario: Lote acima do limite

- **WHEN** o operador envia um lote com mais itens que o limite máximo configurado
- **THEN** o sistema responde HTTP 422 e não persiste nenhum lead

#### Scenario: Sem sessão

- **WHEN** uma requisição chega a `POST /admin/api/leads/import` sem cookie de sessão válido
- **THEN** o sistema responde HTTP 401 e não persiste nenhum lead

### Requirement: Disparo de prospecção em lote

O sistema SHALL expor `POST /admin/api/leads/prospect`, protegido pela sessão de usuário
único, que recebe uma lista de telefones E.164 e um sinalizador opcional `force`, e dispara
o primeiro contato de prospecção para cada telefone reusando a mesma lógica do disparo
individual (envio de
template aprovado, semeadura/atualização da conversa na fila serial do lead, idempotência
por lead, atualização do estado de prospecção). O processamento SHALL ser **continue-on-error**:
a falha de um telefone (gateway, lead inexistente, telefone inválido) NÃO SHALL interromper
o disparo dos demais.

Sem `force`, apenas leads em estado `pending` ou `failed` SHALL ter o template efetivamente
enviado; um lead em `sent` ou `replied` SHALL ser reportado como `skipped` sem reenviar. A
resposta de sucesso SHALL devolver, em um contrato tipado, um resultado por telefone com o
desfecho (`sent` com `wamid` | `skipped` | `failed` com motivo) e o estado de prospecção
resultante do lead. Uma lista acima do limite máximo configurado SHALL ser recusada com HTTP
422 sem disparar nada. O disparo SHALL respeitar um limite de concorrência entre telefones
distintos, mantendo a serialização por lead.

#### Scenario: Lote disparado com desfechos mistos

- **WHEN** um operador autenticado chama `POST /admin/api/leads/prospect` com quatro telefones: um `pending` cadastrado, um `sent`, um sem lead cadastrado e um cujo gateway rejeita o envio
- **THEN** o sistema envia o template ao lead `pending` (desfecho `sent` com `wamid`), reporta o lead `sent` como `skipped`, reporta o telefone sem lead como `failed` com motivo, reporta o telefone rejeitado pelo gateway como `failed` com motivo, e responde com sucesso e o resultado por telefone

#### Scenario: Falha de um lead não aborta o lote

- **WHEN** o disparo de um dos telefones da lista lança erro
- **THEN** o sistema segue disparando os telefones restantes e inclui o telefone com erro na resposta marcado como `failed` com o motivo

#### Scenario: Redisparo em lote sem force é ignorado por lead

- **WHEN** a lista inclui leads já em `sent` ou `replied` e `force` não é verdadeiro
- **THEN** o sistema não reenvia o template para esses leads, marca-os como `skipped` e dispara normalmente os leads `pending`/`failed`

#### Scenario: Redisparo em lote com force

- **WHEN** o operador chama o disparo em lote com `force` verdadeiro para leads já prospectados
- **THEN** o sistema reenvia o template, registra um novo turno outbound de origem no operador para cada um e atualiza o estado conforme o resultado do envio

#### Scenario: Lista acima do limite

- **WHEN** o operador envia uma lista com mais telefones que o limite máximo configurado
- **THEN** o sistema responde HTTP 422 e não dispara nenhuma mensagem

#### Scenario: Sem sessão

- **WHEN** uma requisição chega ao endpoint de disparo em lote sem cookie de sessão válido
- **THEN** o sistema responde HTTP 401 e não dispara nada

### Requirement: Reset da prospecção de um lead

O sistema SHALL expor `POST /admin/api/leads/:leadPhone/reset`, protegido pela sessão de
usuário único, que devolve um lead ao estado de prospecção `pending` e limpa os carimbos de
primeiro contato do lead (`first_contact_wamid`, `first_contact_at`, `replied_at`),
re-habilitando o lead para um novo disparo de primeiro contato. O reset SHALL agir somente
sobre o registro do lead no armazenamento operacional — NÃO SHALL apagar o agregado
`Conversation` do lead nem os turnos já registrados. Um disparo posterior sobre um lead
resetado SHALL semear/atualizar a conversa normalmente, acrescentando um novo turno de
primeiro contato à conversa existente.

Quando não existir lead cadastrado para o telefone informado, o sistema SHALL responder HTTP
404. Um telefone fora do formato E.164 SHALL ser recusado com HTTP 422. Chamar o reset para
um lead que já está em `pending` SHALL ser idempotente (sucesso, sem efeito adicional além
de garantir os carimbos limpos). A ação SHALL ser registrada na trilha de auditoria de forma
best-effort: uma falha ao auditar NÃO SHALL desfazer o reset já aplicado. A resposta de
sucesso SHALL devolver, em um contrato tipado, o lead com o estado de prospecção atualizado.

#### Scenario: Reset de um lead já contatado

- **WHEN** um operador autenticado chama `POST /admin/api/leads/:leadPhone/reset` para um lead em estado `sent` ou `replied`
- **THEN** o sistema passa o lead para `pending`, limpa os carimbos de primeiro contato, mantém a conversa e os turnos do lead intactos, registra a auditoria best-effort e responde com sucesso e o lead atualizado

#### Scenario: Novo disparo após o reset

- **WHEN** um lead é resetado e em seguida a prospecção é disparada novamente para ele
- **THEN** o sistema envia o template, acrescenta um novo turno de primeiro contato à conversa já existente do lead e passa o lead para `sent`

#### Scenario: Reset idempotente

- **WHEN** o operador chama o reset para um lead que já está em `pending`
- **THEN** o sistema responde com sucesso sem efeito adicional

#### Scenario: Lead inexistente

- **WHEN** o operador chama o reset para um telefone sem lead cadastrado
- **THEN** o sistema responde HTTP 404 e nada é alterado

#### Scenario: Telefone em formato inválido

- **WHEN** o operador chama o reset para um telefone fora do formato E.164
- **THEN** o sistema responde HTTP 422

#### Scenario: Sem sessão

- **WHEN** uma requisição chega ao endpoint de reset sem cookie de sessão válido
- **THEN** o sistema responde HTTP 401 e nada é alterado
