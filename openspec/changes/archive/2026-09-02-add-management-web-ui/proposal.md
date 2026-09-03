## Why

Toda a série `add-management-*` entrega apenas API JSON. O objetivo do explore
(`docs/explores/explore-ui-dashboard.md`) é uma **interface visual** para operar e observar
o bot: listar/detalhar conversas, ver estatísticas de consumo e executar ações. Falta o
cliente — e o repositório ainda não tem nenhuma aplicação de frontend nem toolchain de
bundling.

## What Changes

- **Monorepo com npm workspaces**: raiz ganha `workspaces`; nova app em
  `applications/wpp_prospector_bot_panel/`, espelhando `applications/wpp_prospector_bot_server/`.
- **SPA React + Vite** (primeira toolchain de bundling do repo):
  - React + TypeScript, **TanStack Query** (dados, polling via `refetchInterval`) e
    **TanStack Router** ou **React Router 7** (decidir no design);
  - **Tailwind + shadcn/ui**; **Recharts** (ou visx) para o painel de consumo;
  - cliente HTTP tipado a partir dos DTOs zod de `management-api` (pacote compartilhado ou
    tipos gerados — decidir no design).
- **Telas** (entregues incrementalmente conforme as APIs existem):
  1. **Login** + shell autenticado (consome `POST/DELETE /admin/api/session`);
  2. **Conversas** — lista com filtros (estado, intent, telefone, data) e paginação;
     detalhe com a timeline de turnos, intent/qualificação, módulos, plano citado,
     pendências;
  3. **Consumo** — visão por período (hoje/7 d/30 d/custom) de tokens e custo LLM + custo
     WhatsApp por categoria; contadores do "agora";
  4. **Ações** (quando `add-management-conversation-actions` estiver pronta) — handoff /
     retomar / enviar mensagem avulsa, a partir do detalhe;
  5. **Prospecção** (quando `add-outbound-prospecting-trigger` estiver pronta) — cadastrar
     lead e disparar template.
- **Entrega em produção**: `npm run build` gera estáticos que o Fastify serve em `/admin`
  via `@fastify/static` (um único artefato de deploy). Em dev, Vite dev server com `proxy`
  para `/admin/api`.
- **Tooling**: ESLint/Prettier estendidos para o workspace do front; scripts na raiz
  (`dev:web`, `build:web`); ajuste de CI se houver.

## Capabilities

### New Capabilities
- `management-web-ui`: o sistema oferece uma aplicação web autenticada para gestão do bot —
  autenticação por sessão contra a `management-api`, navegação e filtragem de conversas com
  visão de detalhe, painel de estatísticas de consumo por período, e disparo das ações de
  operação e de prospecção expostas pela API. Servida como estático pelo próprio servidor em
  produção.

### Modified Capabilities
<!-- Nenhuma capability de backend muda; a UI é cliente da management-api. O servir do
     estático já está previsto na proposta da add-management-api. -->

## Impact

- **Estrutura**: `package.json` raiz vira workspace; novo diretório
  `applications/wpp_prospector_bot_panel/` com seu próprio `package.json`, `vite.config.ts`,
  `tsconfig.json`, `index.html`, `src/`.
- **Dependências novas** (no workspace do front): `react`, `react-dom`, `vite`,
  `@vitejs/plugin-react`, `@tanstack/react-query`, router, `tailwindcss`, libs do shadcn,
  `recharts`. Nenhuma nova no servidor além do `@fastify/static` já previsto.
- **Servidor**: nenhuma mudança de código obrigatória se `add-management-api` já condiciona
  o `@fastify/static` à existência do diretório de build; caso contrário, um ajuste pequeno
  no registro do estático.
- **Dependência de change**: `add-management-api` (telas 1–3); `add-management-conversation-actions`
  (tela 4); `add-outbound-prospecting-trigger` (tela 5). Pode começar assim que a
  `add-management-api` expõe leitura + sessão.
- **Deploy**: build do front no pipeline antes do empacotamento do servidor; `/admin`
  atrás do gate de sessão e, idealmente, de rede fechada (explore §1.5).
- **Fora de escopo**: SSR/Next; app mobile/desktop; SSE (polling por enquanto);
  internacionalização; multiusuário/RBAC na UI.
