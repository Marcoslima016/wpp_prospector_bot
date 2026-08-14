## Why

Hoje a `ANTHROPIC_API_KEY` (e qualquer outra variável de ambiente necessária, como `SESSION_ID`) só pode ser fornecida exportando-a manualmente no shell antes de rodar `npm start`/`npm run dev`, o que é fácil de esquecer, difícil de compartilhar entre desenvolvedores de forma segura, e incompatível com a nova task do VSCode que facilita subir uma sessão (ela não deveria precisar que o usuário exporte segredos manualmente no terminal antes de rodar a task). Carregar a configuração de um arquivo `.env` local, não versionado, resolve isso mantendo o comportamento de falha rápida já existente.

## What Changes

- Nova dependência `dotenv` para carregar variáveis de um arquivo `.env` na raiz do projeto.
- `src/index.ts` passa a carregar o `.env` (se existir) no início do `main()`, antes de qualquer leitura de `process.env.ANTHROPIC_API_KEY`/`process.env.SESSION_ID` — sem alterar as mensagens de erro de falha rápida já existentes para essas variáveis quando ausentes.
- Novo `.env.example` versionado, documentando `ANTHROPIC_API_KEY` e `SESSION_ID` como variáveis esperadas.
- `.gitignore` passa a ignorar `.env`, para que segredos nunca sejam versionados.
- A task do VSCode criada para rodar sessões (`.vscode/tasks.json`) não precisa mais solicitar a API key ao usuário — ela é resolvida via `.env`.

## Capabilities

### New Capabilities
- `app-configuration`: o processo carrega segredos/configuração de ambiente a partir de um arquivo `.env` local no bootstrap, antes de validar a presença das variáveis obrigatórias, preservando a falha rápida quando algo obrigatório está ausente.

### Modified Capabilities
(nenhuma — nenhum requisito já publicado em `whatsapp-connectivity` ou `anti-ban-warmup` muda de comportamento; a forma de fornecer `ANTHROPIC_API_KEY`/`SESSION_ID` nunca foi especificada como requisito nessas capabilities, apenas implementada via `process.env` diretamente)

## Impact

- **Código afetado**: `src/index.ts` (carregamento do `.env` no início do `main()`).
- **Dependências novas**: `dotenv`.
- **Arquivos novos**: `.env.example` (versionado).
- **Configuração**: `.gitignore` ganha entrada para `.env`.
- **Sem impacto** em `warmup/`, `outbound/`, `whatsapp/`, `reasoning/` — nenhuma dessas camadas muda de contrato, apenas a origem das variáveis de ambiente lidas no bootstrap.
