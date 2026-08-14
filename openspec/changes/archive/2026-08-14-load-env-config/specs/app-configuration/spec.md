## Purpose

Define como o processo carrega a configuração de ambiente (segredos e parâmetros por execução) na inicialização, para que operadores possam fornecê-la via um arquivo local em vez de exportar variáveis manualmente em cada sessão de shell.

## ADDED Requirements

### Requirement: Configuração de ambiente carregada de arquivo .env local
O sistema SHALL carregar variáveis de ambiente a partir de um arquivo `.env` local na inicialização do processo, antes de validar a presença de qualquer configuração obrigatória.

#### Scenario: Arquivo .env presente
- **WHEN** o processo inicia e existe um arquivo `.env` na raiz do projeto
- **THEN** as variáveis definidas nesse arquivo ficam disponíveis como configuração de ambiente para o restante da inicialização

### Requirement: Ausência do .env não impede a inicialização
O sistema SHALL continuar a inicialização normalmente quando não existe um arquivo `.env`, utilizando as variáveis de ambiente já presentes no processo.

#### Scenario: Nenhum arquivo .env existe
- **WHEN** o processo inicia e não existe um arquivo `.env` na raiz do projeto
- **THEN** o sistema segue para validar a configuração obrigatória usando apenas as variáveis já presentes no ambiente do processo

### Requirement: Variáveis já definidas no ambiente têm precedência sobre o .env
O sistema SHALL preservar o valor de uma variável de ambiente já definida no processo (ex.: exportada no shell ou injetada pelo orquestrador) em vez de sobrescrevê-la com o valor equivalente do arquivo `.env`.

#### Scenario: Mesma variável definida no shell e no .env
- **WHEN** uma variável de ambiente já está definida no processo antes da inicialização e o arquivo `.env` também define um valor para essa mesma variável
- **THEN** o sistema utiliza o valor já definido no processo, ignorando o valor equivalente do `.env`

### Requirement: Configuração obrigatória continua falhando rápido quando ausente
O sistema SHALL continuar interrompendo a inicialização com um erro claro quando um valor de configuração obrigatório (ex.: a API key do provedor de LLM) estiver ausente, independentemente de ele ser esperado via `.env` ou via o ambiente do processo.

#### Scenario: API key obrigatória ausente em qualquer lugar
- **WHEN** o processo inicia e a API key exigida pelo motor de raciocínio não está presente nem no arquivo `.env` nem no ambiente do processo
- **THEN** o sistema interrompe a inicialização e reporta um erro claro identificando a configuração ausente
