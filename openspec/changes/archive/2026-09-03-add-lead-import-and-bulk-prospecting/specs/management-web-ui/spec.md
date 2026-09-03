## ADDED Requirements

### Requirement: Tela de leads com listagem filtrável

A interface SHALL apresentar uma tela de leads, acessível por um item de navegação próprio
na navegação autenticada, que consome `GET /admin/api/leads` e exibe, por linha, ao menos o
nome/empresa do lead, o telefone, o segmento, a cidade, o estado de prospecção e o instante
do primeiro contato/última atividade de prospecção quando houver. A tela SHALL oferecer
filtros combináveis por estado de prospecção, por trecho de telefone e por segmento,
repassando-os como query à API, e SHALL permitir avançar as páginas usando o cursor da
resposta. A listagem SHALL se manter atualizada por consulta periódica enquanto visível,
suspensa quando a aba não está visível, no mesmo padrão das demais telas. Uma consulta sem
resultados SHALL mostrar um estado vazio explícito que orienta a importar uma planilha, não
um erro.

#### Scenario: Página inicial de leads

- **WHEN** o operador abre a tela de leads sem aplicar filtros
- **THEN** a interface exibe a primeira página de leads na ordem devolvida pela API e um controle para carregar a próxima página quando houver cursor

#### Scenario: Filtro por estado de prospecção

- **WHEN** o operador filtra a tela de leads pelo estado `pending`
- **THEN** a interface repassa o filtro na chamada e lista apenas os leads nesse estado

#### Scenario: Nenhum lead cadastrado

- **WHEN** a tela de leads é aberta e não há nenhum lead
- **THEN** a interface mostra um estado vazio que orienta a importar uma planilha, sem erro

### Requirement: Importação de leads a partir de uma planilha

A interface SHALL permitir importar leads a partir de um arquivo de planilha (`.xlsx`)
selecionado na máquina do operador. A interface SHALL ler o arquivo localmente, reconhecer a
aba de leads da planilha de trabalho (`03_Leads_CRM`) e extrair apenas as colunas úteis —
nome/empresa, telefone, segmento, cidade — ignorando as demais colunas e as demais abas.
Cada telefone SHALL ser normalizado para o formato E.164 brasileiro (DDI 55); linhas sem
telefone, com telefone malformado ou com telefone que não seja de celular SHALL ser tratadas
como rejeitadas. Antes de qualquer gravação, a interface SHALL exibir um preview com a
contagem de leads válidos e a lista de linhas rejeitadas com o motivo de cada uma. A
importação só SHALL enviar `POST /admin/api/leads/import` com os leads válidos após
confirmação explícita do operador, e a importação NÃO SHALL disparar nenhuma mensagem. Ao
concluir, a interface SHALL informar quantos leads foram criados e atualizados e recarregar
a listagem.

#### Scenario: Preview antes de importar

- **WHEN** o operador seleciona uma planilha com linhas válidas e linhas sem telefone ou com telefone inválido
- **THEN** a interface exibe a contagem de leads válidos e a lista de linhas rejeitadas com o motivo, sem ter gravado nada ainda

#### Scenario: Confirmação grava apenas os válidos

- **WHEN** o operador confirma a importação a partir do preview
- **THEN** a interface envia `POST /admin/api/leads/import` apenas com os leads válidos, exibe os totais de criados e atualizados devolvidos pela API e recarrega a listagem

#### Scenario: Planilha sem a aba de leads reconhecível

- **WHEN** o operador seleciona um arquivo em que a aba/colunas de leads não podem ser reconhecidas
- **THEN** a interface exibe uma mensagem de erro explicando o formato esperado e não envia nada

#### Scenario: Importar não dispara

- **WHEN** uma importação é concluída com sucesso
- **THEN** nenhuma mensagem de abertura é enviada e os leads novos aparecem na listagem em estado `pending`

### Requirement: Seleção e disparo da mensagem de abertura em lote

A tela de leads SHALL oferecer, por linha, um checkbox de seleção habilitado apenas para
leads em estado `pending` ou `failed`; leads em `sent` ou `replied` SHALL aparecer com o
checkbox desabilitado. A interface SHALL oferecer uma ação de disparar a mensagem de abertura
para os leads selecionados que, após uma confirmação explícita indicando quantos leads serão
contatados, chama `POST /admin/api/leads/prospect` com os telefones selecionados. A interface
SHALL exibir o resultado por lead devolvido pela API (enviado, ignorado, falhou com motivo)
sem descartar o restante da tela, e SHALL refletir os novos estados de prospecção na
listagem pela consulta periódica. A ação de disparo SHALL ser uma afordância acoplada ao
endpoint: quando o deploy não expõe a prospecção (`GET /admin/api/capabilities` indica
indisponível, ou a rota responde como inexistente), a ação SHALL ficar oculta ou
desabilitada como indisponível.

#### Scenario: Disparo em lote a partir da seleção

- **WHEN** o operador seleciona dois leads `pending`, aciona a ação de disparar a abertura e confirma
- **THEN** a interface chama `POST /admin/api/leads/prospect` com os dois telefones, exibe o resultado por lead e passa a refletir os estados atualizados na listagem

#### Scenario: Leads já contatados não são selecionáveis

- **WHEN** a listagem contém leads em estado `sent` ou `replied`
- **THEN** a interface exibe esses leads com o checkbox de seleção desabilitado

#### Scenario: Resultado parcial é exibido

- **WHEN** o disparo em lote retorna alguns leads como enviados e outros como falhos com motivo
- **THEN** a interface exibe o desfecho de cada lead e mantém o restante da tela utilizável

#### Scenario: Prospecção indisponível no deploy

- **WHEN** a interface roda contra um deploy que não expõe os endpoints de prospecção
- **THEN** a interface não apresenta uma ação de disparo acionável (oculta ou desabilitada como indisponível)

### Requirement: Reset da prospecção de um lead pela interface

A tela de leads SHALL oferecer, por linha de um lead já contatado (`sent` ou `replied`), uma
ação de resetar a prospecção que, após uma confirmação explícita, chama `POST
/admin/api/leads/:leadPhone/reset`. Ao concluir, a interface SHALL refletir o lead de volta
ao estado `pending` na listagem, tornando-o novamente selecionável para disparo. Uma recusa
da API (por exemplo, lead inexistente) SHALL ser exibida sem descartar o restante da tela.

#### Scenario: Reset de um lead contatado

- **WHEN** o operador aciona a ação de resetar a prospecção de um lead em `sent` e confirma
- **THEN** a interface chama `POST /admin/api/leads/:leadPhone/reset` e passa a exibir o lead em `pending`, novamente selecionável para disparo

#### Scenario: Reset recusado pela API

- **WHEN** o operador aciona o reset e a API recusa a operação com um motivo
- **THEN** a interface exibe o motivo devolvido e mantém o restante da tela utilizável
