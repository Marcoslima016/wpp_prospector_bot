## ADDED Requirements

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
