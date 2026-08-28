# conversation-engine Specification

## Purpose

Interpreta mensagens recebidas de leads usando um modelo de linguagem (LLM) guiado por um prompt de prospecção predefinido, mantém o histórico persistido de cada conversa e decide de forma estruturada se e como o bot responde, dando seguimento contínuo ao diálogo.

## Requirements

### Requirement: Interpretação de Mensagem Recebida via LLM

O sistema SHALL, dado o histórico da conversa e uma ou mais mensagens novas de um lead, produzir uma decisão estruturada consultando um LLM com um prompt de prospecção predefinido. A interpretação NÃO SHALL depender de um provider de LLM concreto — o provider é um detalhe substituível definido na composição.

#### Scenario: Mensagem interpretada com sucesso

- **WHEN** uma mensagem de um lead é processada e o LLM responde no formato esperado
- **THEN** o sistema obtém uma decisão estruturada do bot e prossegue para aplicá-la à conversa

#### Scenario: Falha na chamada ao LLM

- **WHEN** a chamada ao LLM falha (erro de rede, erro da API, timeout)
- **THEN** o sistema tenta novamente uma única vez com backoff; persistindo a falha, registra o erro e não envia resposta, sem lançar exceção não tratada

#### Scenario: Saída do LLM fora do formato esperado

- **WHEN** a resposta do LLM não adere ao formato estruturado exigido
- **THEN** o sistema trata como falha de interpretação (nova tentativa única e, persistindo, registro de erro sem resposta)

### Requirement: Formato Estruturado da Decisão do Bot

A decisão do bot SHALL conter: uma lista ordenada de mensagens de resposta (possivelmente vazia), um indicador de encerramento da conversa, a intenção identificada do lead, a qualificação comercial do lead (ou ausência dela), um indicador de transferência para atendimento humano e uma justificativa textual opcional. A justificativa NUNCA SHALL ser enviada ao lead.

A intenção do lead SHALL ser um valor entre: interessado, não interessado, precisa de mais informação, pedido de opt-out, fora de tópico, indefinido.

#### Scenario: Decisão sem resposta

- **WHEN** a decisão do bot contém uma lista de mensagens de resposta vazia
- **THEN** o sistema não envia nenhuma mensagem ao lead, mas ainda registra o turno recebido e atualiza o status da conversa

#### Scenario: Decisão com justificativa

- **WHEN** a decisão do bot inclui uma justificativa textual
- **THEN** a justificativa é registrada para auditoria e não aparece em nenhuma mensagem enviada ao lead

### Requirement: Agrupamento de Mensagens em Rajada

O sistema SHALL agrupar as mensagens de um mesmo lead recebidas dentro de uma janela de tempo configurável (padrão 8 segundos, contada a partir da primeira mensagem ainda não processada) e interpretá-las em conjunto. O sistema SHALL responder com uma única mensagem quando as mensagens agrupadas tratam do mesmo assunto, e com múltiplas mensagens ordenadas apenas quando pontos distintos levantados pelo lead exigem respostas separadas.

#### Scenario: Rajada sobre o mesmo assunto

- **WHEN** um lead envia três mensagens sobre o mesmo assunto dentro da janela
- **THEN** o sistema as interpreta como um todo e envia uma única mensagem de resposta

#### Scenario: Rajada com assuntos distintos

- **WHEN** um lead envia, dentro da janela, mensagens sobre assuntos distintos que exigem respostas separadas
- **THEN** o sistema envia múltiplas mensagens de resposta, na ordem definida pela decisão

#### Scenario: Nova mensagem durante o processamento

- **WHEN** uma nova mensagem do mesmo lead chega enquanto o grupo anterior ainda está sendo processado
- **THEN** ela entra em um novo grupo, processado somente após a conclusão do grupo anterior, preservando a ordem

### Requirement: Envio Sequencial das Respostas

O sistema SHALL enviar cada mensagem de resposta da decisão na ordem definida. Uma falha de envio de uma mensagem, após uma tentativa adicional, SHALL ser registrada e NÃO SHALL impedir o envio das mensagens restantes do lote.

#### Scenario: Envio de múltiplas mensagens

- **WHEN** a decisão contém três mensagens de resposta e a janela de atendimento está aberta
- **THEN** o sistema envia as três na ordem definida

#### Scenario: Falha no envio de uma das mensagens

- **WHEN** o envio de uma das mensagens do lote falha mesmo após a nova tentativa
- **THEN** o sistema registra o erro e segue enviando as mensagens seguintes do lote

### Requirement: Histórico Persistido da Conversa

O sistema SHALL persistir cada conversa, identificada pelo número de telefone do lead, incluindo os turnos recebidos e enviados, a intenção e a qualificação correntes do lead e o estado do ciclo de vida. O sistema SHALL carregar o histórico existente antes de interpretar novas mensagens e SHALL incluir no prompt do LLM no máximo os N turnos mais recentes (padrão 20, configurável).

#### Scenario: Lead com histórico existente

- **WHEN** uma mensagem chega de um lead que já tem conversa registrada
- **THEN** o sistema carrega o histórico recente e o inclui na interpretação da nova mensagem

#### Scenario: Primeira mensagem de um lead

- **WHEN** uma mensagem chega de um lead sem conversa registrada
- **THEN** o sistema cria uma nova conversa e a persiste com o primeiro turno recebido

### Requirement: Deduplicação de Mensagens Recebidas

O sistema SHALL ignorar uma mensagem recebida cujo identificador já tenha sido processado para aquela conversa.

#### Scenario: Webhook reentregue

- **WHEN** um evento de webhook é reentregue pela Meta com um identificador de mensagem já processado para a conversa
- **THEN** o sistema ignora a mensagem e não gera uma segunda resposta

### Requirement: Ciclo de Vida da Conversa

Quando a decisão indica encerramento, o sistema SHALL marcar a conversa como encerrada; a próxima mensagem do lead SHALL reabri-la automaticamente e ser processada normalmente.

Quando a decisão indica transferência para atendimento humano, o sistema SHALL enviar as mensagens de resposta do turno, marcar a conversa como aguardando atendimento humano e, a partir daí, registrar as mensagens seguintes do lead SEM gerar resposta automática, até que a marcação seja removida manualmente. A conversa nesse estado NÃO SHALL ser reaberta automaticamente.

#### Scenario: Conversa encerrada e retomada pelo lead

- **WHEN** a decisão encerra a conversa e, depois, o lead envia uma nova mensagem
- **THEN** o sistema reabre a conversa e gera uma nova resposta normalmente

#### Scenario: Conversa transferida para humano

- **WHEN** a decisão marca transferência para humano e, depois, o lead envia novas mensagens
- **THEN** o sistema registra as mensagens e não gera resposta automática enquanto a marcação estiver ativa

### Requirement: Recuperação de Mensagens Não Processadas no Boot

Na inicialização, o sistema SHALL reprocessar as mensagens recebidas que foram persistidas mas nunca produziram uma decisão de resposta, desde que a mais recente dessas mensagens para o lead esteja dentro de um limite de recência configurável (padrão 1 hora). Mensagens pendentes mais antigas que o limite SHALL ser marcadas como abandonadas e registradas, sem serem respondidas.

#### Scenario: Reinício com pendência recente

- **WHEN** o sistema reinicia e há uma mensagem recebida pendente cuja mais recente para o lead está dentro do limite de recência
- **THEN** o sistema a reenfileira e a processa

#### Scenario: Reinício com pendência antiga

- **WHEN** o sistema reinicia e a mensagem recebida pendente mais recente do lead está além do limite de recência
- **THEN** o sistema marca a pendência como abandonada, registra o fato e não envia resposta

### Requirement: Seleção Configurável do Modelo de LLM

O sistema SHALL usar um modelo de LLM identificado por configuração, com um valor padrão, substituível sem alteração de código.

#### Scenario: Sem override de configuração

- **WHEN** nenhum modelo é informado por configuração
- **THEN** o sistema usa o modelo padrão

#### Scenario: Modelo informado por configuração

- **WHEN** um modelo é informado por variável de ambiente
- **THEN** o sistema usa o modelo informado nas chamadas ao LLM
