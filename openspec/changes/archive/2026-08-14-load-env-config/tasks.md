## 1. Setup

- [x] 1.1 Adicionar `dotenv` às dependências do `package.json`
- [x] 1.2 Adicionar `.env` ao `.gitignore`
- [x] 1.3 Criar `.env.example` versionado documentando `ANTHROPIC_API_KEY` e `SESSION_ID`

## 2. Carregamento em `src/index.ts`

- [x] 2.1 Chamar `dotenv.config()` no topo de `src/index.ts`, antes de qualquer leitura de `process.env` em `main()`
- [x] 2.2 Confirmar que uma variável já definida no ambiente do processo continua tendo precedência sobre o valor equivalente no `.env` (comportamento padrão do `dotenv`, sem código adicional)
- [x] 2.3 Confirmar que a ausência de `.env` não interrompe a inicialização, e que a falha rápida por `ANTHROPIC_API_KEY`/`SESSION_ID` ausentes continua funcionando como hoje

## 3. Ajuste da task do VSCode

- [x] 3.1 Atualizar `.vscode/tasks.json`/documentação da task para não exigir mais que o usuário exporte `ANTHROPIC_API_KEY` manualmente, já que passa a vir do `.env`

## 4. Verificação

- [x] 4.1 Rodar a suíte automatizada (`npm test`) e confirmar que nada quebrou
- [x] 4.2 QA manual: criar um `.env` local a partir do `.env.example`, rodar `npm run dev` sem exportar `ANTHROPIC_API_KEY` no shell, e confirmar que a sessão inicia normalmente
- [x] 4.3 QA manual: remover/renomear o `.env` e confirmar que a aplicação falha rápido com a mensagem de erro já existente para `ANTHROPIC_API_KEY` ausente
