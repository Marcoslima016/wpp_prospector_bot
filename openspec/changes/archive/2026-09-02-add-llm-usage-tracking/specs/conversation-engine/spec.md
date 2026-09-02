## MODIFIED Requirements

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
