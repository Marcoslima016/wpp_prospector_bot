## Why

A interface visual de gestão (change `add-management-web-ui`) precisa de um backend HTTP
que hoje não existe: o servidor Fastify só expõe as rotas de webhook do WhatsApp. É preciso
uma API própria para **listar e detalhar conversas** e **consultar as estatísticas de
consumo**, protegida por autenticação (a UI executa ações e não pode ser pública).

Ver o explore em `docs/explores/explore-ui-dashboard.md` (§1.1, §1.4, §2).

## What Changes

- **Novo plugin Fastify sob `/admin`**, registrado ao lado do plugin de webhook no mesmo
  processo — é o único lugar que enxerga o estado vivo (coordenador de rajada, sweeper) e
  respeita a serialização por lead.
- **Autenticação de usuário único**: um segredo compartilhado (env, ex.
  `ADMIN_ACCESS_SECRET`) trocado por um **cookie de sessão assinado** (`ADMIN_SESSION_SECRET`).
  Endpoints `POST /admin/api/session` (login) e `DELETE /admin/api/session` (logout). Todo
  `/admin/api/*` exige o cookie; sem ele → `401`. Sem modelo de papéis/dono (multiusuário é
  change futura).
- **Projeção de leitura de conversas** em `operational-data-store`: tabela derivada
  (`conversation_index`) materializada no boot (varrendo `data/conversations/*.json` uma
  vez) e **atualizada a cada `save()`** do `FileConversationRepository`. O arquivo JSON
  continua a fonte da verdade; a tabela é só índice para busca/paginação.
- **Endpoints de leitura** (JSON):
  - `GET /admin/api/conversations` — lista paginada, com filtro por `state`
    (`active|ended|awaitingHuman`), `leadIntent`, texto no telefone, faixa de data;
    ordenação por última atividade;
  - `GET /admin/api/conversations/:leadPhone` — detalhe completo (turnos, intent,
    qualificação, módulos, plano citado, flags de pendência/abandono);
  - `GET /admin/api/stats/consumption` — agregações de `consumption-metrics` (LLM + Meta)
    por período (`from`/`to`, `groupBy=day|lead|model|category`) com custo estimado;
  - `GET /admin/api/stats/overview` — **contadores do "agora"** (conversas por estado,
    total de leads, pendências) derivados da projeção.
- **Contratos de resposta versionados com zod** (DTOs), reaproveitáveis para tipar o front.
- **Servir o build da SPA**: `/admin` (sem `/api`) serve os estáticos do
  `applications/wpp_prospector_bot_web` via `@fastify/static` — ligado só quando o diretório
  de build existe (a UI chega na change `add-management-web-ui`).
- `.env` de exemplo + testes de env com `ADMIN_ACCESS_SECRET`, `ADMIN_SESSION_SECRET` e
  (opcional) `ADMIN_ENABLED`.

## Capabilities

### New Capabilities
- `management-api`: o sistema expõe uma API HTTP autenticada de gestão, separada do webhook
  público, para observar o estado operacional do bot — autenticação de usuário único por
  sessão assinada, listagem/filtragem/paginação e detalhe de conversas a partir de uma
  projeção de leitura mantida em sincronia com o repositório de conversas, e consulta às
  estatísticas de consumo por período. Somente leitura nesta change; ações de escrita vêm em
  `add-management-conversation-actions` e `add-outbound-prospecting-trigger`.

### Modified Capabilities
<!-- Nenhum requisito de comportamento existente muda. O repositório de conversas ganha um
     observador para manter a projeção, sem alterar sua semântica (detalhar no design). -->

## Impact

- **Dependências novas**: `@fastify/cookie` (+ `@fastify/static` para servir a SPA). Assinatura
  de sessão pode usar `node:crypto` (HMAC) sem lib de sessão dedicada.
- **Código**:
  - novo módulo `src/management/` (Clean Architecture: `domain`/`application`/`infrastructure`)
    ou `src/whatsapp-connectivity/infrastructure/http/` estendido — decidir no design;
  - novo plugin de rotas `/admin/api/*` + guard de sessão;
  - adapter de projeção `conversation_index` + gancho no `FileConversationRepository`
    (observer/decorator, sem acoplar o motor) + migration;
  - read models sobre `consumption-metrics`;
  - `src/main.ts` — registrar o plugin, fiar a projeção, condicionar ao `ADMIN_ENABLED`;
  - config de env + `.env` + testes.
- **Dependência de change**: `add-embedded-sql-store` (projeção + conexão);
  `add-llm-usage-tracking` e/ou `add-whatsapp-messaging-cost-tracking` para os endpoints de
  consumo terem dados (a API pode subir antes, retornando zeros).
- **Segurança/deploy**: `/admin/*` **nunca** exposto publicamente sem o gate de sessão;
  recomendação de rede (Tailscale / allowlist) no explore §1.5.
- **Fora de escopo**: qualquer ação de escrita; multiusuário/RBAC; a SPA em si; SSE (polling
  no cliente por enquanto).
