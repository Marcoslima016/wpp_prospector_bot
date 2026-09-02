# operational-data-store Specification

## Purpose

Fornece um armazenamento SQL embutido para dados operacionais e analíticos do bot, com
esquema versionado por migrations aplicadas no boot e postura fail-fast, disponibilizando
uma conexão preparada aos módulos que persistem dados estruturados (série temporal de
consumo, projeções de leitura). Não é a fonte da verdade das conversas.

## Requirements

### Requirement: Armazenamento SQL embutido preparado no boot

O sistema SHALL manter um único banco SQL embutido, persistido em arquivo, cuja localização
é configurável por variável de ambiente (`DATABASE_PATH`), com default `./data/app.db`. O
banco SHALL ser preparado durante a inicialização do processo, **antes** de o servidor HTTP
aceitar requisições. Subir o processo contra um disco vazio SHALL resultar num banco
plenamente utilizável, com o mesmo esquema que seria obtido em qualquer outro ambiente para
o mesmo conjunto de migrations.

#### Scenario: Boot contra disco vazio

- **WHEN** o processo inicia e o arquivo de banco no caminho configurado não existe
- **THEN** o sistema cria o arquivo, aplica todas as migrations, registra as versões aplicadas e segue o boot

#### Scenario: Boot contra banco já existente

- **WHEN** o processo inicia e o arquivo de banco já existe com um subconjunto das migrations aplicadas
- **THEN** o sistema reaproveita o arquivo e aplica somente as migrations ainda não registradas

#### Scenario: Localização não configurada

- **WHEN** o processo inicia sem `DATABASE_PATH` definido
- **THEN** o sistema usa o caminho default `./data/app.db`

#### Scenario: Caminho configurado inutilizável

- **WHEN** o caminho configurado não pode ser aberto para escrita (diretório inexistente sem permissão de criação, arquivo sem permissão, disco cheio)
- **THEN** o processo não sobe: encerra com código de saída diferente de zero e registra uma mensagem acionável identificando o caminho, e o servidor HTTP nunca passa a escutar

### Requirement: Esquema versionado por migrations forward-only

O sistema SHALL versionar o esquema do banco por meio de migrations numeradas, aplicadas em
ordem lexical, cada uma de forma atômica (tudo ou nada). O sistema SHALL manter um registro
de controle das versões já aplicadas e SHALL usá-lo para aplicar, a cada boot, apenas as
migrations ausentes. A aplicação das migrations SHALL ser idempotente: reexecutar o processo
sem migrations novas não altera o esquema. O sistema NÃO SHALL oferecer migrations
reversíveis (*down*) nem rollback automático de esquema.

#### Scenario: Migrations pendentes são aplicadas em ordem

- **WHEN** existem migrations numeradas ainda não registradas no controle de versões
- **THEN** o sistema as aplica em ordem lexical, cada uma numa transação, e registra cada versão aplicada com o instante de aplicação

#### Scenario: Reexecução sem pendências

- **WHEN** o processo reinicia e todas as migrations já constam no registro de controle
- **THEN** o sistema não executa nenhuma alteração de esquema e o boot prossegue

#### Scenario: Nova migration adicionada entre deploys

- **WHEN** uma nova migration numerada é adicionada e o processo é reiniciado
- **THEN** apenas a nova migration é aplicada e registrada; as anteriores não são reexecutadas

### Requirement: Fail-fast na preparação do banco

Se qualquer migration falhar, se o mecanismo de SQL embutido não estiver disponível no
runtime, ou se o banco não puder ser aberto, o processo NÃO SHALL iniciar: SHALL encerrar
com código de saída diferente de zero, registrar uma mensagem acionável e não deixar o
servidor HTTP passar a escutar. Uma migration que falha no meio NÃO SHALL deixar alterações
parciais nem registrar sua versão como aplicada. Esta é a mesma postura dos demais passos
de boot do sistema (carregamento de configuração e da base de conhecimento).

#### Scenario: Migration inválida

- **WHEN** uma migration pendente falha ao ser aplicada (erro de SQL, violação de constraint)
- **THEN** o processo encerra com código diferente de zero, a mensagem de erro identifica a migration que falhou, e nenhuma alteração daquela migration persiste no banco

#### Scenario: Mecanismo de SQL indisponível no runtime

- **WHEN** o runtime não disponibiliza o mecanismo de SQL embutido exigido
- **THEN** o processo encerra no boot com código diferente de zero e uma mensagem acionável indicando o requisito de runtime não atendido

#### Scenario: Falha interrompe o boot antes do servidor

- **WHEN** a preparação do banco falha por qualquer motivo
- **THEN** o servidor HTTP nunca chega a aceitar requisições nesse processo

### Requirement: Conexão preparada disponível aos módulos de dados estruturados

O sistema SHALL disponibilizar a conexão já preparada (banco aberto, migrations aplicadas,
integridade referencial ativa) aos componentes que persistem dados operacionais e
analíticos, por injeção — esses componentes NÃO SHALL abrir o banco por conta própria. O
sistema SHALL operar com processo único e uma única conexão compartilhada, sem pool. A
conexão SHALL impor integridade referencial (constraints de chave estrangeira em vigor) e
SHALL permitir que leitores consultem o banco concomitantemente a uma escrita em andamento
sem bloqueio indefinido.

#### Scenario: Módulo recebe a conexão pronta

- **WHEN** um módulo de persistência estruturada é montado na composição do sistema
- **THEN** ele recebe a conexão já preparada e não executa abertura de banco nem aplicação de migrations

#### Scenario: Leitura concorrente com escrita

- **WHEN** uma consulta de leitura ocorre enquanto há uma escrita em andamento no banco
- **THEN** a leitura é atendida sem falhar e sem bloquear indefinidamente

#### Scenario: Violação de integridade referencial

- **WHEN** uma escrita tenta inserir uma linha que viola uma constraint de chave estrangeira
- **THEN** a escrita é rejeitada pelo banco

### Requirement: Persistência de conversas inalterada

A introdução do armazenamento SQL embutido NÃO SHALL alterar a forma como o agregado
`Conversation` é persistido (um arquivo JSON por lead) nem torná-lo dependente do banco SQL
como fonte da verdade. Nenhum comportamento observável do motor de conversas ou da
conectividade com o WhatsApp muda em decorrência desta capability, e nenhum endpoint ou
interface nova é exposto por ela.

#### Scenario: Conversa processada após a introdução do banco

- **WHEN** uma mensagem de lead é processada com o armazenamento SQL já preparado no processo
- **THEN** o agregado `Conversation` continua sendo lido e gravado como arquivo JSON por lead, e o banco SQL não é a origem nem o destino do agregado

#### Scenario: Nenhuma superfície nova

- **WHEN** esta capability é entregue
- **THEN** nenhuma rota HTTP, comando ou interface de usuário nova passa a existir por causa dela
