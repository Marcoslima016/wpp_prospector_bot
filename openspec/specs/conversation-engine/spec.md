# conversation-engine Specification

## Purpose

Interpreta mensagens recebidas de leads usando um modelo de linguagem (LLM) guiado por um prompt de prospecção predefinido, mantém o histórico persistido de cada conversa e decide de forma estruturada se e como o bot responde, dando seguimento contínuo ao diálogo.

## Requirements

### Requirement: Interpretação de Mensagem Recebida via LLM

O sistema SHALL, dado o histórico da conversa, uma ou mais mensagens novas de um lead e o
**contexto de negócio recuperado** para essas mensagens, produzir uma decisão estruturada
consultando um LLM com um prompt de prospecção predefinido. A interpretação NÃO SHALL
depender de um provider de LLM concreto — o provider é um detalhe substituível definido na
composição. O contexto de negócio SHALL ser obtido antes da chamada de geração da decisão
e SHALL ser fornecido ao motor por uma abstração substituível (não acoplada a uma técnica
de recuperação específica).

Cada chamada ao LLM feita neste fluxo — tanto a consulta que gera a decisão quanto a
consulta que extrai os sinais de busca — SHALL ter seu consumo de tokens registrado
(ver a capability `consumption-metrics`). O registro é best-effort: NÃO SHALL alterar a
decisão produzida, o texto enviado ao lead, nem o comportamento de nova tentativa e
registro de erro já definidos; uma falha ao registrar o consumo SHALL ser apenas logada.

#### Scenario: Mensagem interpretada com sucesso

- **WHEN** uma mensagem de um lead é processada, o contexto de negócio é recuperado e o LLM responde no formato esperado
- **THEN** o sistema obtém uma decisão estruturada do bot e prossegue para aplicá-la à conversa

#### Scenario: Falha na chamada ao LLM

- **WHEN** a chamada ao LLM de geração da decisão falha (erro de rede, erro da API, timeout)
- **THEN** o sistema tenta novamente uma única vez com backoff; persistindo a falha, registra o erro e não envia resposta, sem lançar exceção não tratada

#### Scenario: Saída do LLM fora do formato esperado

- **WHEN** a resposta do LLM não adere ao formato estruturado exigido
- **THEN** o sistema trata como falha de interpretação (nova tentativa única e, persistindo, registro de erro sem resposta)

#### Scenario: Contexto de negócio indisponível para o turno

- **WHEN** a recuperação do contexto de negócio não retorna nenhum trecho específico para as mensagens do lead
- **THEN** o sistema ainda gera a decisão usando o conhecimento fixo obrigatório (posicionamento, guardrails e planos/preços) e o histórico, sem falhar o turno

#### Scenario: Consumo de cada chamada ao LLM registrado

- **WHEN** o fluxo de interpretação executa a consulta de extração de sinais e a consulta de geração da decisão para um lead
- **THEN** o consumo de tokens de cada uma dessas chamadas é registrado como um evento de consumo, sem alterar a decisão nem o envio da resposta

#### Scenario: Falha ao registrar consumo não afeta a interpretação

- **WHEN** o registro do consumo de uma chamada ao LLM falha
- **THEN** o sistema registra o erro em log e a interpretação e o envio da resposta ao lead seguem normalmente

### Requirement: Formato Estruturado da Decisão do Bot

A decisão do bot SHALL conter: uma lista ordenada de mensagens de resposta (possivelmente
vazia), um indicador de encerramento da conversa, a intenção identificada do lead, a
qualificação comercial do lead (ou ausência dela), um indicador de transferência para
atendimento humano, uma justificativa textual opcional, a lista de módulos que o bot
ofereceu neste turno, a lista de módulos em que o lead demonstrou interesse e o plano
comercial cujo preço foi citado (ou a ausência de citação). A justificativa NUNCA SHALL
ser enviada ao lead.

A intenção do lead SHALL ser um valor entre: interessado, não interessado, precisa de mais
informação, pedido de opt-out, fora de tópico, indefinido.

O plano citado SHALL ser um valor entre: `essencial`, `personalizado` ou nulo (nenhum
preço citado no turno).

As listas de módulos ofertados e de interesse SHALL usar identificadores estáveis de
módulo e SHALL poder ser vazias.

#### Scenario: Decisão sem resposta

- **WHEN** a decisão do bot contém uma lista de mensagens de resposta vazia
- **THEN** o sistema não envia nenhuma mensagem ao lead, mas ainda registra o turno recebido e atualiza o status da conversa

#### Scenario: Decisão com justificativa

- **WHEN** a decisão do bot inclui uma justificativa textual
- **THEN** a justificativa é registrada para auditoria e não aparece em nenhuma mensagem enviada ao lead

#### Scenario: Decisão com módulos e plano citados

- **WHEN** o bot oferece um ou mais módulos e/ou cita o preço de um plano em um turno
- **THEN** o sistema registra no turno os módulos ofertados, os módulos de interesse identificados e o plano cujo preço foi citado, e atualiza esses valores no agregado da conversa

#### Scenario: Conversa persistida antes desta mudança

- **WHEN** o sistema carrega uma conversa cujo histórico foi salvo sem os campos de módulos e plano citado
- **THEN** o sistema a interpreta com listas de módulos vazias e plano citado nulo, sem erro

### Requirement: Base de Conhecimento do Negócio

O sistema SHALL manter uma base de conhecimento comercial versionada no repositório,
contendo o conhecimento sobre o ecossistema Obra na Mão / FluxoDRE (módulos,
funcionalidades, público, mapa dor→solução, posicionamento) e a tabela de planos e preços.
A base SHALL ser organizada em trechos delimitados, cada um com metadados que permitam
distinguir a que módulo pertence, se pertence ao plano base ou ao conjunto adicional, e
qual o tipo de conteúdo (visão, funcionalidades, dor→solução, público, guardrail, objeção,
sondagem, preço).

Na inicialização, o sistema SHALL preparar essa base para consulta local. Se a base não
puder ser preparada — arquivo ausente ou ilegível, formato inválido, trecho sem os
metadados exigidos, ou nenhum trecho reconhecido — o sistema SHALL abortar a inicialização
com um erro claro e NÃO SHALL iniciar o servidor.

#### Scenario: Base preparada com sucesso no boot

- **WHEN** o sistema inicia e a base de conhecimento está presente e bem formada
- **THEN** a base fica disponível para consulta e o servidor sobe normalmente

#### Scenario: Base ausente ou malformada no boot

- **WHEN** o sistema inicia e a base de conhecimento está ausente, ilegível ou com trechos sem os metadados exigidos
- **THEN** o sistema registra um erro descritivo e encerra a inicialização sem começar a atender requisições

### Requirement: Recuperação de Contexto de Negócio para a Interpretação

Para cada lote de mensagens novas de um lead, o sistema SHALL montar um contexto de
negócio combinando: (a) um conjunto fixo e obrigatório de trechos — posicionamento curto,
guardrails de produto e a tabela de planos e preços — sempre incluído; e (b) um conjunto
variável de trechos recuperados por busca léxica local a partir de sinais extraídos das
mensagens do lead.

A extração dos sinais de busca (temas, dores, módulos prováveis) SHALL ser feita por uma
consulta ao LLM anterior à consulta que gera a decisão. Se essa consulta de extração
falhar ou não retornar sinais úteis, o sistema SHALL derivar os sinais de busca localmente
a partir do texto das mensagens (normalização e expansão por sinônimos/jargão) e seguir o
fluxo sem falhar o turno.

O conjunto variável recuperado SHALL ser limitado por uma quantidade máxima de trechos e
por um limite de relevância mínima configuráveis; trechos abaixo do limite de relevância
SHALL ser descartados. A classificação de intenção e a qualificação do lead SHALL
permanecer determinadas apenas pela decisão gerada na consulta final ao LLM, não pela
consulta de extração.

#### Scenario: Mensagem com tema identificável

- **WHEN** o lead descreve uma necessidade ou pergunta sobre um assunto coberto pela base
- **THEN** o sistema recupera os trechos relevantes e os inclui no contexto enviado à consulta de geração da decisão

#### Scenario: Falha na consulta de extração de sinais

- **WHEN** a consulta ao LLM que extrai os sinais de busca falha ou volta sem sinais úteis
- **THEN** o sistema deriva os sinais localmente a partir do texto das mensagens e prossegue com a recuperação e a geração da decisão

#### Scenario: Nenhum trecho acima do limite de relevância

- **WHEN** a busca léxica não encontra trechos com relevância suficiente
- **THEN** o sistema envia apenas o conjunto fixo obrigatório e o histórico à consulta de geração da decisão

#### Scenario: Conteúdo fixo sempre presente

- **WHEN** qualquer decisão é gerada, independentemente do resultado da busca
- **THEN** o posicionamento curto, os guardrails de produto e a tabela de planos e preços estão presentes no contexto enviado ao LLM

### Requirement: Conhecimento de Produto e Planos Comerciais

O bot SHALL apresentar o produto como o ecossistema modular Obra na Mão / FluxoDRE para
construção civil e SHALL conhecer os módulos do plano base (operação de campo, gestão
administrativa e DRE/custos) e os módulos do conjunto adicional (financeiro inteligente,
universidade empresarial, jogos/gamificação e assistente inteligente).

O bot SHALL trabalhar com dois planos comerciais: **Essencial** (plano base, funcionalidades
reduzidas) e **Personalizado** (plano completo, que libera todos os módulos do conjunto
adicional por um valor único acima do base). O bot SHALL informar os valores dos planos
conforme a tabela de preços da base e NÃO SHALL apresentar módulos do conjunto adicional
como contratáveis avulsos.

O bot SHALL usar somente informações presentes na base de conhecimento e NÃO SHALL
inventar funcionalidades, números, prazos ou condições. Negociação de valores, descontos
ou condições especiais SHALL resultar em transferência para atendimento humano.

#### Scenario: Lead pergunta o que o sistema faz

- **WHEN** o lead pede uma explicação geral do produto
- **THEN** o bot responde com a descrição de ecossistema modular para construção civil, no nível curto ou intermediário adequado ao WhatsApp

#### Scenario: Lead pergunta o preço

- **WHEN** o lead pergunta quanto custa
- **THEN** o bot informa o valor mensal do plano Essencial e menciona o plano Personalizado com o valor adicional, conforme a tabela de preços da base

#### Scenario: Lead quer só um módulo do conjunto adicional

- **WHEN** o lead pede para contratar isoladamente um módulo do conjunto adicional
- **THEN** o bot explica que esse módulo está disponível no plano Personalizado, que libera todo o conjunto adicional, e não oferece contratação avulsa

#### Scenario: Lead pede negociação ou condição especial

- **WHEN** o lead quer negociar valor, pedir desconto ou tratar condição comercial especial
- **THEN** o bot transfere a conversa para atendimento humano

#### Scenario: Informação não consta na base

- **WHEN** o lead pergunta algo que não está coberto pela base de conhecimento
- **THEN** o bot diz que vai confirmar com o time e não inventa a resposta

### Requirement: Condução de Venda Consultiva

Antes de apresentar módulos, o bot SHALL procurar identificar a necessidade ou dor do lead,
usando perguntas de sondagem objetivas, uma por mensagem. Identificada a dor, o bot SHALL
apresentar apenas o conjunto mínimo de módulos relacionado a ela, e SHALL enquadrar a
oferta nos dois planos comerciais sem afirmar que o lead precisa contratar todos os
módulos. Integrações entre módulos SHALL ser apresentadas como benefício adicional, nunca
como obrigação.

As respostas SHALL seguir o formato do canal: mensagens curtas (explicação curta ou
intermediária). A ficha estruturada de um módulo (o que é / para quem / resolve /
funcionalidades / funciona separado / integra com) SHALL ser usada apenas quando o lead
pedir explicitamente detalhes daquele módulo.

#### Scenario: Lead genérico sem dor declarada

- **WHEN** o lead inicia com interesse vago ("vi o anúncio", "quero saber mais")
- **THEN** o bot faz uma pergunta de sondagem para entender a operação do lead antes de ofertar módulos

#### Scenario: Dor identificada

- **WHEN** o lead descreve um problema específico (ex.: não sabe o que cada equipe está fazendo)
- **THEN** o bot apresenta apenas o conjunto mínimo de módulos relacionado àquela dor e o situa nos planos

#### Scenario: Pedido explícito de detalhes de um módulo

- **WHEN** o lead pede para detalhar um módulo específico
- **THEN** o bot responde com a ficha estruturada daquele módulo

#### Scenario: Enquadramento modular

- **WHEN** o bot apresenta um módulo ou plano
- **THEN** o bot não afirma que todos os módulos são obrigatórios e apresenta integrações como benefício opcional

### Requirement: Guardrails de Produto e Fidelidade à Base

O bot NÃO SHALL mencionar BIM, CompatibilizaBIM, DWG ou IFC como parte da oferta; NÃO SHALL
apresentar recursos em desenvolvimento como disponíveis; NÃO SHALL prometer economia
financeira específica sem análise; NÃO SHALL afirmar que a inteligência artificial toma
decisões financeiras de forma autônoma; e SHALL sempre diferenciar automação de apoio da
decisão final do usuário. Quando o lead claramente não pertence ao segmento de construção
civil, o bot SHALL qualificá-lo como frio de forma cordial, sem forçar a oferta.

#### Scenario: Lead menciona BIM ou DWG

- **WHEN** o lead pergunta sobre BIM, CompatibilizaBIM, DWG ou IFC
- **THEN** o bot não apresenta esses recursos como parte da oferta e redireciona para as funcionalidades disponíveis

#### Scenario: Lead pede garantia de economia

- **WHEN** o lead pede que o bot garanta um percentual ou valor de economia
- **THEN** o bot não promete números específicos e explica que isso depende de análise do time

#### Scenario: Lead fora do segmento

- **WHEN** fica claro que o lead não atua com execução de obras / construção civil
- **THEN** o bot encerra de forma cordial e qualifica o lead como frio

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

Cada turno outbound SHALL registrar a sua **origem**: gerado pelo bot ou escrito por um operador humano. A origem SHALL ser persistida e exposta no histórico de forma que os dois casos sejam distinguíveis. A serialização SHALL ser retrocompatível: um turno outbound carregado de uma conversa persistida antes desta mudança, sem o campo de origem, SHALL ser interpretado como tendo origem no bot.

#### Scenario: Lead com histórico existente

- **WHEN** uma mensagem chega de um lead que já tem conversa registrada
- **THEN** o sistema carrega o histórico recente e o inclui na interpretação da nova mensagem

#### Scenario: Primeira mensagem de um lead

- **WHEN** uma mensagem chega de um lead sem conversa registrada
- **THEN** o sistema cria uma nova conversa e a persiste com o primeiro turno recebido

#### Scenario: Turno outbound do bot registra a origem

- **WHEN** o sistema aplica uma decisão do bot que produz mensagens de resposta
- **THEN** cada turno outbound resultante é persistido com origem no bot

#### Scenario: Turno outbound manual registra a origem

- **WHEN** um operador registra uma mensagem outbound escrita à mão na conversa
- **THEN** o turno é persistido com origem no operador, distinguível dos turnos gerados pelo bot

#### Scenario: Conversa persistida antes desta mudança

- **WHEN** o sistema carrega uma conversa cujos turnos outbound foram salvos sem o campo de origem
- **THEN** o sistema os interpreta como tendo origem no bot, sem erro

### Requirement: Deduplicação de Mensagens Recebidas

O sistema SHALL ignorar uma mensagem recebida cujo identificador já tenha sido processado para aquela conversa.

#### Scenario: Webhook reentregue

- **WHEN** um evento de webhook é reentregue pela Meta com um identificador de mensagem já processado para a conversa
- **THEN** o sistema ignora a mensagem e não gera uma segunda resposta

### Requirement: Ciclo de Vida da Conversa

Quando a decisão indica encerramento, o sistema SHALL marcar a conversa como encerrada; a próxima mensagem do lead SHALL reabri-la automaticamente e ser processada normalmente.

Quando a decisão indica transferência para atendimento humano, o sistema SHALL enviar as mensagens de resposta do turno, marcar a conversa como aguardando atendimento humano e, a partir daí, registrar as mensagens seguintes do lead SEM gerar resposta automática, até que a marcação seja removida manualmente. A conversa nesse estado NÃO SHALL ser reaberta automaticamente.

O ciclo de vida da conversa SHALL admitir transições **iniciadas por um operador humano**, independentes de uma `BotDecision`:

- Uma transição manual para **aguardando atendimento humano** SHALL colocar a conversa nesse estado a partir de `active` ou `ended`, com o mesmo efeito de uma transferência decidida pelo bot: as mensagens seguintes do lead são registradas sem resposta automática e a conversa não é reaberta automaticamente. Aplicá-la a uma conversa já aguardando atendimento humano SHALL ser idempotente.
- Uma transição manual de **retomada** SHALL devolver a conversa ao estado `active` a partir de `awaitingHuman` ou de `ended` (reabrindo-a), fazendo o bot voltar a responder às próximas mensagens do lead. Aplicá-la a uma conversa já `active` SHALL ser idempotente.

As transições manuais NÃO SHALL exigir uma `BotDecision` nem alterar a intenção ou a qualificação correntes do lead.

#### Scenario: Conversa encerrada e retomada pelo lead

- **WHEN** a decisão encerra a conversa e, depois, o lead envia uma nova mensagem
- **THEN** o sistema reabre a conversa e gera uma nova resposta normalmente

#### Scenario: Conversa transferida para humano

- **WHEN** a decisão marca transferência para humano e, depois, o lead envia novas mensagens
- **THEN** o sistema registra as mensagens e não gera resposta automática enquanto a marcação estiver ativa

#### Scenario: Transição manual para atendimento humano

- **WHEN** um operador coloca manualmente uma conversa `active` em atendimento humano
- **THEN** o sistema marca a conversa como `awaitingHuman`, e as mensagens seguintes do lead são registradas sem resposta automática, sem reabertura automática

#### Scenario: Retomada manual devolve a conversa ao bot

- **WHEN** um operador retoma manualmente uma conversa que estava em `awaitingHuman`
- **THEN** o sistema marca a conversa como `active` e o bot volta a gerar resposta automática para as próximas mensagens do lead

#### Scenario: Retomada manual reabre conversa encerrada

- **WHEN** um operador retoma manualmente uma conversa que estava em `ended`
- **THEN** o sistema marca a conversa como `active` sem depender de uma nova mensagem do lead

#### Scenario: Transição manual redundante é idempotente

- **WHEN** um operador aplica uma transição manual que corresponde ao estado em que a conversa já está
- **THEN** o sistema mantém o estado atual sem erro e sem efeito adicional

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
