## Why

O projeto vai ganhar uma interface de gestão que precisa de **dados estruturados e
consultáveis** que hoje não existem: série temporal de consumo (LLM e WhatsApp) e uma
projeção de leitura das conversas para listar/filtrar/paginar sem varrer todos os
`data/conversations/*.json` a cada request. A persistência atual — 1 arquivo JSON por lead,
sem índice — não atende a nenhum dos dois. Antes de construir qualquer feature de gestão,
o sistema precisa de um armazenamento estruturado embutido.

Ver o explore em `docs/explores/explore-ui-dashboard.md` (§1.3, §2).

## What Changes

- **Armazenamento SQL embutido via `node:sqlite`** (módulo nativo do Node, experimental —
  **nenhuma dependência de runtime nova**). Um único arquivo de banco (`DATABASE_PATH`,
  default `./data/app.db`).
- **Runner de migrations versionadas**: arquivos SQL numerados aplicados em ordem no boot,
  com tabela de controle (`schema_migrations`). Idempotente. Fail-fast — se uma migration
  falhar, o processo não sobe (mesma postura dos loaders de env e da base de conhecimento).
- **Módulo de conexão único** (`infrastructure/persistence/sqlite/`): abre o banco, aplica
  `PRAGMA` (`journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout`), roda as migrations,
  expõe a conexão para os adapters. Processo único — sem pool.
- **Fiação no `main.ts`**: o banco é preparado antes de subir o servidor Fastify.
- **Migration inicial vazia de domínio** (só `schema_migrations`) — as tabelas de negócio
  chegam nas changes seguintes (`add-llm-usage-tracking`, `add-whatsapp-messaging-cost-tracking`,
  `add-management-api`).
- **Sem mudança de comportamento observável** nesta change. O agregado `Conversation`
  **continua** persistido em arquivo JSON por lead — SQLite é armazenamento de dados
  operacionais/analíticos e de índices derivados, **não** substitui o repositório de
  conversas.
- `.env` de exemplo e testes de env atualizados com `DATABASE_PATH`.

## Capabilities

### New Capabilities
- `operational-data-store`: o sistema mantém um armazenamento SQL embutido para dados
  operacionais e analíticos, com esquema versionado por migrations aplicadas no boot e
  postura fail-fast. Cobre a preparação do banco, o controle de versão do esquema e a
  disponibilização da conexão para os módulos que persistem dados estruturados.

### Modified Capabilities
<!-- Nenhuma. Nenhum requisito de comportamento existente muda; o repositório de conversas
     em arquivo permanece a fonte da verdade e não é tocado. -->

## Impact

- **Dependências**: nenhuma nova de runtime (`node:sqlite` é nativo). Node precisa suportar
  `node:sqlite` (verificar a versão mínima no `engines` do `package.json` e no ambiente de
  deploy). Flag `--experimental-sqlite` pode ser necessária conforme a versão do Node.
- **Código**:
  - novo `src/**/infrastructure/persistence/sqlite/` — módulo de conexão + runner de
    migrations + diretório `migrations/` com os `.sql` numerados;
  - `src/main.ts` — preparar o banco no boot, antes do `app.listen`;
  - config de env (novo `DATABASE_PATH`) no(s) loader(s) apropriado(s) + `.env` + testes.
- **Dados**: novo arquivo `data/app.db` (+ `-wal`/`-shm` no modo WAL). Precisa entrar no
  `.gitignore` e na estratégia de backup do deploy (snapshot de disco ou Litestream — ver
  explore §1.5).
- **Fora de escopo**: qualquer tabela de negócio; migração do agregado `Conversation`;
  qualquer endpoint ou UI.
