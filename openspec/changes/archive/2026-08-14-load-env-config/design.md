## Context

Hoje `src/index.ts` lê `process.env.SESSION_ID` e `process.env.ANTHROPIC_API_KEY` diretamente, sem nenhum carregamento de arquivo — essas variáveis só existem se foram exportadas manualmente no shell antes de `npm start`/`npm run dev`. Ver proposal.md - Why para a motivação (fricção manual, incompatibilidade com a nova task do VSCode).

## Goals / Non-Goals

**Goals:**
- Permitir fornecer `ANTHROPIC_API_KEY`/`SESSION_ID` (e futuras variáveis) via um arquivo `.env` local, não versionado.
- Preservar o comportamento de falha rápida já existente para variáveis obrigatórias ausentes.
- Não alterar a precedência esperada por quem já define essas variáveis via ambiente do processo (shell, orquestrador, CI).

**Non-Goals:**
- Não é objetivo construir um schema/validador de configuração genérico — a validação de obrigatoriedade já existe pontualmente em `src/index.ts` e em `reasoningConfig.ts` e continua como está.
- Não é objetivo dar suporte a múltiplos arquivos `.env` por ambiente (ex.: `.env.production`) — apenas um `.env` local de desenvolvimento.
- Não é objetivo criptografar ou gerenciar segredos remotamente (ex.: vault) — fora do escopo deste ajuste.

## Decisions

- **Usar a biblioteca `dotenv`** em vez de parsing manual do arquivo. É a implementação padrão de fato no ecossistema Node para esse problema, já lida com casos de borda (aspas, comentários, valores multi-linha) que um parser caseiro reimplementaria sem necessidade.
- **Chamar `dotenv.config()` no topo de `src/index.ts`**, antes de qualquer leitura de `process.env` dentro de `main()`. Isso garante que a ordem seja determinística independentemente de onde novas leituras de variáveis forem adicionadas no futuro. `loadReasoningConfig()` (em `reasoningConfig.ts`) lê `process.env.REASONING_CONFIG_PATH` apenas como valor default de parâmetro — avaliado no momento da chamada, que já ocorre depois do carregamento do `.env` — então nenhuma outra mudança é necessária ali.
- **Não sobrescrever variáveis já definidas no ambiente**: esse é o comportamento padrão de `dotenv.config()` (não substitui uma variável já presente em `process.env`), e é o comportamento desejado — quem já define as variáveis via shell/orquestrador continua tendo precedência sobre o `.env`.
- **`.env` ausente não é erro**: `dotenv.config()` retorna um erro no valor de retorno quando o arquivo não existe, mas não lança exceção — o carregamento é best-effort, e a validação de obrigatoriedade continua sendo feita explicitamente logo em seguida em `main()`.
- **`.env.example` versionado** documentando `ANTHROPIC_API_KEY` e `SESSION_ID` com valores de exemplo/comentários curtos, no mesmo espírito de documentação já usado em `config/reasoning.json`.

## Risks / Trade-offs

- [Um `.env` esquecido no diretório de trabalho pode mascarar silenciosamente de onde vem um valor, se o desenvolvedor achava que a variável vinha do shell] → Mitigado por `.env` nunca sobrescrever uma variável já exportada no processo (precedência do shell é preservada) e por manter `.env.example` como a fonte documentada das variáveis esperadas.
- [Vazamento acidental do `.env` no versionamento] → Mitigado por já nascer coberto no `.gitignore` desde o primeiro commit que o introduz; não há `.env` pré-existente no repositório hoje, então não há necessidade de `git rm --cached`.
