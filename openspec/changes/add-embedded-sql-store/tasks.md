## 1. Pré-requisitos de runtime

- [ ] 1.1 Verificar no ambiente de deploy alvo a versão de Node que expõe `node:sqlite` e se `--experimental-sqlite` é necessária nela; registrar a conclusão no `design.md` (Open Questions) e nas notas de deploy
- [ ] 1.2 Fixar `engines.node` no `package.json` com a versão mínima confirmada em 1.1
- [ ] 1.3 Se a flag for necessária, adicioná-la aos scripts `dev` e `start` do `package.json` (junto às flags já existentes)

## 2. Configuração de ambiente

- [ ] 2.1 Adicionar `DATABASE_PATH` ao schema zod em `src/conversation-engine/infrastructure/config/env.ts` — `z.string().min(1).default("./data/app.db")`
- [ ] 2.2 Criar/atualizar `.env.example` na raiz do pacote com `DATABASE_PATH=./data/app.db` e um comentário curto
- [ ] 2.3 Atualizar `src/conversation-engine/infrastructure/config/env.test.ts`: default aplicado quando ausente; valor custom respeitado

## 3. Módulo de conexão SQLite

- [ ] 3.1 Criar o diretório transversal de persistência (decidir entre `src/shared/persistence/sqlite/` e `src/platform/persistence/sqlite/` — cosmético, ver `design.md` Open Questions) e registrar a escolha
- [ ] 3.2 Implementar `openDatabase(path): DatabaseSync` — abre o banco via `node:sqlite`, criando o diretório pai se necessário
- [ ] 3.3 Aplicar os PRAGMAs na abertura: `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout = 5000`, `synchronous = NORMAL`
- [ ] 3.4 `openDatabase` roda o runner de migrations (seção 4) antes de retornar a conexão
- [ ] 3.5 Erro de import de `node:sqlite` (mecanismo indisponível no runtime) lança com mensagem acionável indicando o requisito de runtime não atendido
- [ ] 3.6 Erro ao abrir o arquivo (permissão, diretório, disco) propaga com o caminho na mensagem

## 4. Runner de migrations

- [ ] 4.1 Criar o diretório `migrations/` junto ao módulo de conexão, com os `.sql` numerados (`0001_*.sql`, …)
- [ ] 4.2 Implementar o runner: lista os arquivos `.sql`, ordena lexicalmente, lê o conteúdo
- [ ] 4.3 Garantir a tabela de controle `schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT)` (idempotente — `CREATE TABLE IF NOT EXISTS`)
- [ ] 4.4 Para cada arquivo ausente no `schema_migrations`: aplicar dentro de uma transação e inserir a linha de controle na mesma transação (atômico — falha não deixa versão registrada nem alteração parcial)
- [ ] 4.5 Aplicar em ordem lexical e parar no primeiro erro, propagando com a `version` da migration que falhou na mensagem
- [ ] 4.6 Não executar nada quando não há migrations pendentes (idempotência entre boots)

## 5. Migration inicial

- [ ] 5.1 Criar `migrations/0001_init.sql` contendo apenas a criação de `schema_migrations` (nenhuma tabela de negócio)

## 6. Fiação no boot

- [ ] 6.1 Em `src/main.ts`, adicionar um passo `openDatabase(conversationEnv.DATABASE_PATH)` no mesmo estilo do bloco `loadKnowledge` (try/catch com `console.error` + `process.exit(1)`), **antes** de montar os use-cases e **antes** de `app.listen`
- [ ] 6.2 Logar sucesso da preparação do banco (ex.: caminho + nº de migrations aplicadas neste boot)
- [ ] 6.3 Garantir que a conexão fica disponível para injeção nos adapters das changes seguintes (exportar/manter a referência no escopo de composição; nenhum adapter novo consome nesta change)
- [ ] 6.4 Confirmar que uma falha na preparação impede o `app.listen` (o servidor nunca passa a escutar)

## 7. Testes

- [ ] 7.1 Runner de migrations contra `openDatabase(":memory:")` / arquivo em `os.tmpdir()`: aplica pendentes e registra as versões
- [ ] 7.2 Idempotência: rodar o runner duas vezes não altera o esquema nem duplica linhas de controle
- [ ] 7.3 Migration inválida lança, a mensagem identifica a `version`, e nada daquela migration persiste
- [ ] 7.4 PRAGMAs em vigor: `foreign_keys` ativo (violação de FK é rejeitada) e `journal_mode` é WAL
- [ ] 7.5 Abertura com caminho inutilizável falha com o caminho na mensagem

## 8. Documentação e housekeeping

- [ ] 8.1 Confirmar que `data/` já está no `.gitignore` cobrindo `app.db`/`-wal`/`-shm` (está — validar e não duplicar)
- [ ] 8.2 Documentar no README: `DATABASE_PATH`, requisito de versão de Node / flag `--experimental-sqlite`, e a nota de backup do WAL (`app.db` + `-wal` + `-shm` consistentes ou `wal_checkpoint(TRUNCATE)` antes do snapshot)
- [ ] 8.3 Rodar `npm run lint` e `npm test` e garantir verde

## 9. Verificação da spec

- [ ] 9.1 Boot contra disco vazio cria o arquivo, aplica `0001_init.sql` e o servidor sobe (cenário "Boot contra disco vazio")
- [ ] 9.2 Boot subsequente não reaplica migrations (cenário "Reexecução sem pendências")
- [ ] 9.3 Processamento de mensagem de lead continua lendo/gravando `Conversation` como arquivo JSON por lead, sem tocar o banco SQL (cenário "Persistência de conversas inalterada")
- [ ] 9.4 `openspec validate add-embedded-sql-store --strict` passa
