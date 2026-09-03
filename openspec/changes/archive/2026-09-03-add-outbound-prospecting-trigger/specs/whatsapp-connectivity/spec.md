## MODIFIED Requirements

### Requirement: Envio de Mensagem de Template

O sistema SHALL enviar uma mensagem de template para um número de telefone via WhatsApp Cloud
API, dado o nome do template, o idioma e os parâmetros de substituição.

O envio de template SHALL permanecer disponível como caso de uso chamável em código e SHALL,
adicionalmente, ser **acionável por um gatilho HTTP autenticado** exposto pela API de gestão
(`POST /admin/api/leads/:leadPhone/prospect`, ver a capability `outbound-prospecting`), usado
para o primeiro contato de prospecção. O gatilho HTTP SHALL exigir uma sessão de gestão
válida e SHALL delegar ao mesmo caso de uso de envio de template, sem duplicar a integração
com a Cloud API. Nenhum comportamento do envio em si (formato do payload, propagação de erro
da Cloud API, retorno do `wamid`) muda por causa do gatilho.

#### Scenario: Envio bem-sucedido

- **WHEN** uma mensagem de template válida é enviada para um número de telefone válido
- **THEN** o sistema retorna o identificador da mensagem (wamid) atribuído pela Cloud API

#### Scenario: Falha reportada pela Cloud API

- **WHEN** a Cloud API rejeita o envio (ex.: número inválido, template não aprovado, limite de tier excedido)
- **THEN** o sistema propaga um erro identificável com a causa retornada pela API, sem lançar exceção não tratada

#### Scenario: Envio de template disparado por gatilho HTTP autenticado

- **WHEN** um operador autenticado dispara o primeiro contato de prospecção de um lead pela API de gestão
- **THEN** o sistema envia a mensagem de template pela Cloud API pelo mesmo caso de uso usado em código e retorna o `wamid`

#### Scenario: Gatilho HTTP de template sem sessão

- **WHEN** uma requisição chega ao gatilho HTTP de envio de template de prospecção sem sessão de gestão válida
- **THEN** o sistema responde HTTP 401 e não envia nenhuma mensagem de template
