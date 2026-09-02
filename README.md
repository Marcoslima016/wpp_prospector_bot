# wpp_prospector_bot_server

Bot de WhatsApp para prospecção de clientes via WhatsApp Cloud API (Meta). Node + TypeScript,
Clean Architecture / DDD, desenvolvimento conduzido por specs (OpenSpec — ver `openspec/`).

## Requisitos de runtime

- **Node.js >= 24.0.0** (`engines.node`). O armazenamento estruturado usa o módulo nativo
  `node:sqlite`, disponível **sem flag** a partir do Node 24 (também em 22.13+/23.4+ — em
  versões anteriores exigia `--experimental-sqlite`). O boot falha com mensagem acionável se
  o runtime não expuser `node:sqlite`.
- TS executado nativamente pelo Node (`--experimental-transform-types`), ESM.

## Configuração

Copie `.env.example` para `.env` e preencha. Os scripts `dev`/`start` carregam `.env` se
existir. Variáveis relevantes:

| Variável | Default | Descrição |
|---|---|---|
| `META_*` | — | Credenciais e tokens da WhatsApp Cloud API (obrigatórias) |
| `ANTHROPIC_API_KEY` | — | Chave da API Anthropic (obrigatória) |
| `PORT` | `3000` | Porta do servidor Fastify |
| `CONVERSATIONS_DIR` | `./data/conversations` | Um arquivo JSON por lead — **fonte da verdade** das conversas |
| `DATABASE_PATH` | `./data/app.db` | Arquivo do armazenamento SQL embutido (`node:sqlite`) |

## Scripts

- `npm run dev` — servidor com `--watch`
- `npm run build` / `npm start` — compila para `dist/` e roda
- `npm test` — Vitest
- `npm run lint` / `npm run format`

## Armazenamento

Dois mecanismos, propositalmente separados:

1. **Conversas** — um arquivo JSON por lead em `CONVERSATIONS_DIR`, escrita atômica, processo
   único. É a fonte da verdade do agregado `Conversation`.
2. **Armazenamento SQL embutido** (`DATABASE_PATH`, `node:sqlite`) — dados operacionais/
   analíticos e índices derivados (série temporal de consumo, projeção de leitura de
   conversas). **Não** substitui o repositório de conversas.

### Esquema e migrations

Migrations são arquivos `.sql` numerados em `src/shared/persistence/sqlite/migrations/`,
aplicados em ordem lexical no boot, cada um numa transação, registrados em
`schema_migrations`. Só forward — não há *down*/rollback de esquema; reverter = restaurar
backup. Se uma migration falhar, o processo não sobe.

### Modo WAL e backup

O banco abre em `journal_mode = WAL`, então convivem `app.db`, `app.db-wal` e `app.db-shm`.
Um backup consistente precisa capturar os três juntos **ou** executar
`PRAGMA wal_checkpoint(TRUNCATE)` antes do snapshot (alternativa: replicação contínua com
Litestream). `data/` está no `.gitignore`.
