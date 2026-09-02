## Context

Ver `proposal.md — Why`. Estado atual relevante:

- **Sem banco.** Persistência = `FileConversationRepository`, 1 JSON por lead em
  `CONVERSATIONS_DIR`, escrita atômica (tmp + `rename`), assume **processo único** com
  serialização por lead garantida pelo `InboundBatchCoordinator`.
- Config por zod com **fail-fast** em `infrastructure/config/env.ts` (dois loaders:
  `whatsapp-connectivity` e `conversation-engine`).
- `main.ts` faz boot sequencial: carrega env → carrega base de conhecimento (fail-fast) →
  monta use-cases → roda o sweeper → `app.listen`.
- Node com `--experimental-transform-types`; TS nativo, ESM, `type: module`.
  `@types/node` v26. Sem `engines` no `package.json`.
- Runtime deps hoje: `fastify`, `zod`, `@anthropic-ai/sdk`. Minimalismo é valor do projeto.

## Goals / Non-Goals

**Goals:**

- Um armazenamento SQL local, **sem dependência de runtime nova**, disponível para os
  módulos que virão (consumo, projeção de conversas).
- Esquema **versionado e reproduzível**: subir o processo num disco vazio resulta no mesmo
  esquema, sempre.
- Mesma postura **fail-fast** do resto do boot.
- Ponto único de acesso à conexão, injetável nos adapters (testes usam banco em memória ou
  arquivo temporário).

**Non-Goals:**

- Qualquer tabela de negócio (chegam nas changes seguintes).
- ORM / query builder.
- Migrations *down* / rollback automático de esquema.
- Suporte a múltiplos processos ou acesso concorrente ao arquivo por outro serviço.
- Substituir o `FileConversationRepository`.

## Decisions

### D1 — `node:sqlite` em vez de `better-sqlite3`

`node:sqlite` é nativo (zero dep, coerente com o projeto), síncrono (casa com o modelo de
escritor único, sem `async` desnecessário), e suficiente para o volume (um bot de
prospecção). `better-sqlite3` seria mais maduro e sem flag experimental, mas é dependência
nativa com build por plataforma — atrito no deploy ARM da AWS.

**Trade-off:** `node:sqlite` é experimental e pode exigir `--experimental-sqlite` conforme
a versão do Node. Mitigação: fixar `engines.node` no `package.json`, documentar a flag no
`.env`/README e nas notas de deploy, e um teste de fumaça no boot que falha com mensagem
clara se `node:sqlite` não estiver disponível.

**Alternativa considerada:** adiar o SQLite e usar JSONL append-only para consumo + índice
em memória para conversas. Rejeitada no explore (§1.3) — agregação temporal e filtro/paginação
pedem SQL; dois mecanismos ad-hoc dariam mais manutenção que um SQLite.

### D2 — Migrations: arquivos `.sql` numerados + tabela de controle

Diretório `migrations/` com `0001_init.sql`, `0002_*.sql`, … aplicados em ordem lexical
dentro de uma transação cada. Tabela `schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT)`
registra o que já rodou. No boot: lista arquivos, aplica os ausentes, para no primeiro erro
(processo não sobe).

- **SQL puro, não JS**: migrations são dados, não código; legíveis no diff; sem risco de
  drift entre "o que o código faz" e "o que o banco tem".
- **Só forward**: rollback de esquema em produção com um único operador não paga o custo;
  reverter = restaurar snapshot (a estratégia de backup já existe no explore §1.5).
- `0001_init.sql` cria apenas `schema_migrations` (as tabelas de negócio vêm nas próximas
  changes, cada uma com sua migration).

**Alternativa:** biblioteca de migration (`node-pg-migrate`-like). Rejeitada: dependência
nova para resolver um problema de ~40 linhas.

### D3 — Módulo de conexão único, síncrono, compartilhado entre bounded contexts

`src/shared/persistence/sqlite/` (novo diretório `shared/` — hoje os dois contextos não
compartilham código, mas o banco é infra transversal por natureza; a alternativa de duplicar
em cada contexto é pior). Expõe:

```
openDatabase(path): DatabaseSync        // aplica PRAGMAs, roda migrations, retorna a conexão
```

PRAGMAs: `journal_mode = WAL` (leitura concorrente com a escrita — a API de gestão lê
enquanto o webhook escreve), `foreign_keys = ON`, `busy_timeout = 5000`,
`synchronous = NORMAL` (seguro com WAL, mais rápido).

Uma conexão para todo o processo. Sem pool (`node:sqlite` é síncrono; o modelo de escritor
único já serializa). Adapters recebem a conexão por injeção — não a abrem.

### D4 — Fiação no boot

Em `main.ts`, novo passo **antes** de montar os use-cases e antes do `app.listen`, no mesmo
estilo do `loadKnowledge`:

```
env → openDatabase(env.DATABASE_PATH)  // fail-fast: migration quebrada = process.exit(1)
    → (conexão injetada nos adapters das próximas changes)
    → sweeper → app.listen
```

`DATABASE_PATH` entra no loader de env do `conversation-engine` (onde já vive
`CONVERSATIONS_DIR` e o resto da config de persistência), default `./data/app.db`.

### D5 — Testes

Adapters e o runner de migrations testam contra `openDatabase(":memory:")` ou um arquivo em
diretório temporário (`node:test`/vitest + `os.tmpdir()`). Um teste garante que rodar o
runner duas vezes é idempotente e que uma migration inválida lança.

## Risks / Trade-offs

- **[Flag experimental do `node:sqlite`]** → `engines.node` fixo + teste de fumaça no boot
  com mensagem acionável + nota no README/deploy. Reavaliar `better-sqlite3` só se a flag
  sair de "experimental" tarde demais ou o ambiente de deploy não permitir a flag.
- **[Arquivo WAL em backup]** → snapshot precisa capturar `app.db` + `-wal` + `-shm`
  consistentes; ou usar `PRAGMA wal_checkpoint(TRUNCATE)` antes do snapshot, ou Litestream
  (explore §1.5). Documentar na change de deploy.
- **[`data/app.db` versionado por engano]** → entra no `.gitignore` junto com
  `data/conversations/`.
- **[Corrupção por queda no meio da escrita]** → WAL + escrita transacional cobrem o caso
  normal; recuperação = restaurar snapshot. Aceitável para o volume/estágio.
- **[`shared/` vira depósito]** → restringir a infra genuinamente transversal (persistência,
  e no futuro logging); revisar em review.

## Migration Plan

1. Deploy normal — no primeiro boot com esta versão, `0001_init.sql` cria
   `schema_migrations` num `app.db` novo. Nada a migrar (sem dados legados).
2. Rollback: `app.db` é aditivo e não lido por nada ainda; reverter o binário do app basta.
   Se necessário, apagar `app.db*` recria do zero no próximo boot.
3. Ambiente de deploy: garantir versão do Node com `node:sqlite` e a flag, se aplicável, no
   `ExecStart`/entrypoint.

## Open Questions

- Versão mínima exata do Node a fixar em `engines` e se a flag `--experimental-sqlite` é
  necessária nela — verificar no ambiente alvo antes de escrever a task de config. Não afeta
  specs nem o desenho.
- `shared/persistence/sqlite/` vs `src/platform/` como nome do diretório transversal —
  cosmético, decidir na implementação.
