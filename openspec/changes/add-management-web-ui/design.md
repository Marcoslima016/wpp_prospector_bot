## Context

Ver `proposal.md` — Why / What Changes, e o explore em `docs/explores/explore-ui-dashboard.md`
(§2 "Arquitetura escolhida", §3 "Roadmap de changes").

Estado atual relevante:

- O repositório Git é o próprio `wpp_prospector_bot_server/` (o `openspec/` vive aqui). Não
  há toolchain de frontend nem bundler; o `tsc` compila só `src/` do servidor.
- A `management-api` (arquivada) já entregou: plugin Fastify sob `/admin`, sessão de usuário
  único por cookie assinado (`POST`/`DELETE /admin/api/session`), endpoints de leitura
  (`GET /admin/api/conversations`, `.../:leadPhone`, `GET /admin/api/stats/consumption`,
  `.../overview`), os DTOs zod versionados em `src/management/interface/dto/*` com a
  constante `MANAGEMENT_CONTRACT_VERSION`, e o servir de estáticos com fallback de SPA em
  `src/management/infrastructure/http/admin-static.ts`, condicionado à existência do
  diretório apontado por `ADMIN_WEB_DIST_DIR` (default `../wpp_prospector_bot_panel/dist`).
- O cookie de sessão é `HttpOnly`, `SameSite=Strict`, `Secure`, `Path=/admin`.
- Deploy alvo (explore §1.5): uma única instância (Lightsail ou `t4g`), Node em `systemd`,
  proxy TLS na frente, `/admin` atrás de rede fechada. Um único artefato de deploy é
  desejável.

## Goals / Non-Goals

**Goals:**

- Uma app React (Vite) que roda sob o caminho base `/admin`, servida como estático pelo
  servidor em produção e por dev server com proxy em desenvolvimento.
- Cliente HTTP cujos tipos vêm dos DTOs zod já publicados pela `management-api`, sem
  duplicar contrato e sem geração de código.
- Telas de leitura (login/shell, conversas lista+detalhe, painel de consumo) prontas contra
  a API já existente; ganchos para as telas de ação/prospecção sem retrabalho quando as
  changes `add-management-conversation-actions` e `add-outbound-prospecting-trigger`
  chegarem.
- Nenhuma mudança de código obrigatória no servidor (o servir de estáticos já existe).

**Non-Goals:**

- SSR/Next, app mobile/desktop, SSE/WebSocket, i18n, multiusuário/RBAC na UI (proposal —
  "Fora de escopo").
- npm workspaces cruzando repositórios Git (decidido: a SPA é um repositório irmão).
- IaC / automação de deploy (fora do OpenSpec — explore §1.5).
- Um sistema de design próprio: usa os componentes de `shadcn/ui` como vêm.

## Decisions

### D1. A SPA vive em `applications/wpp_prospector_bot_panel/`, repositório Git próprio

O `env.ts` da `management-api` já fixou `ADMIN_WEB_DIST_DIR=../wpp_prospector_bot_panel/dist`
— um diretório irmão de `wpp_prospector_bot_server/`. A SPA nasce nesse caminho, com seu
próprio `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/`, e seu
próprio Git.

- **Por que não npm workspaces na raiz**: o Git deste projeto está enraizado em
  `wpp_prospector_bot_server/`; um `package.json` com `workspaces` teria de morar em
  `applications/`, fora de qualquer repositório. Não há ganho que pague essa inversão agora.
- **Por que não uma subpasta deste repo** (`web/` + `workspaces` aqui): misturaria a
  toolchain de bundler do front com o pacote do servidor (ESLint, `tsc`, Vitest) e obrigaria
  a mudar o default já shippado de `ADMIN_WEB_DIST_DIR`. Mantido o default; a SPA é um
  artefato separado que o pipeline de deploy posiciona ao lado do servidor.
- **Trade-off aceito**: dois repositórios a versionar e liberar de forma coordenada. Mitigado
  por D5 (checagem de versão de contrato) e por documentar a ordem de release.

### D2. React SPA + Vite, sem SSR

Decisão do explore (§2). `/admin` é interno, sem SEO; um segundo processo (Next) só somaria
deploy. Vite é a primeira toolchain de bundler do projeto e o padrão atual para SPA React.

### D3. Roteamento: React Router 7 (`createBrowserRouter`)

- **Alternativa considerada**: TanStack Router (rotas/params type-safe, loaders integrados).
  Mais garantias de tipo, porém mais setup e uma curva a mais sobre um app de ~6 telas.
- **Escolhido**: React Router 7 — maduro, declarativo, mínimo setup, familiar. `basename="/admin"`
  para casar com o caminho base. As garantias de tipo que importam aqui (forma das respostas)
  vêm dos DTOs zod (D5), não do roteador.

### D4. Dados: TanStack Query com polling

- `@tanstack/react-query` para cache, estados de carregamento/erro e revalidação.
- Atualização periódica via `refetchInterval` (conservador: 10–30 s por tela) com
  `refetchIntervalInBackground: false` — atende ao requisito de suspender o polling com a
  aba oculta e poupa o processo único do bot.
- SSE fica para depois "se o polling incomodar" (explore §2 "Tempo real").

### D5. Cliente HTTP tipado pelos DTOs zod da `management-api` (sem codegen)

O cliente importa os schemas zod já definidos em
`src/management/interface/dto/*` do pacote do servidor e deriva os tipos com `z.infer`,
**e** usa os mesmos schemas para validar as respostas em runtime (satisfaz o requisito
"Consumo dos contratos versionados da API" da spec).

Mecanismo de acoplamento entre os dois repositórios:

- O pacote do servidor passa a declarar um export de subcaminho estável — `"./contracts"` —
  no seu `package.json`, apontando para o barrel dos DTOs (`dto/index.ts` reexportando
  `common`, `conversation.dto`, `consumption.dto`, `overview.dto`, `query`, e a constante
  `MANAGEMENT_CONTRACT_VERSION`). É o único acréscimo ao servidor e não altera nenhuma
  capability.
- A SPA declara uma dependência `file:../wpp_prospector_bot_server` e importa de
  `wpp_prospector_bot_server/contracts`. O Vite transpila o TS desse subcaminho (via
  `optimizeDeps.exclude` + `resolve` ou `server.fs.allow` conforme necessário); `zod` já é
  dependência transitiva e é bundlada no cliente.
- **Alternativa considerada**: um pacote publicável `management-contracts` consumido pelos
  dois lados. Mais isolamento, porém exige publicar/registrar um terceiro pacote para dois
  consumidores num monólito de deploy. Adiado; o export `./contracts` é o ponto de extração
  se isso mudar.
- **Alternativa considerada**: tipos gerados a partir de um schema OpenAPI. O servidor não
  expõe OpenAPI; os DTOs zod já são a fonte da verdade. Codegen só somaria um passo.

Checagem de versão: a interface fixa em build a `MANAGEMENT_CONTRACT_VERSION` que importou.
Como a API não ecoa a versão numa resposta hoje (e isso é fora de escopo), a detecção de
incompatibilidade é feita **validando cada resposta com o schema zod correspondente**: uma
divergência de forma faz o `safeParse` falhar e a interface troca a renderização daquele
dado por um aviso de incompatibilidade que mostra a versão esperada. Sem mudança no
servidor.

### D6. Estilo: Tailwind + shadcn/ui

Decisão do explore (§2). `shadcn/ui` entra por CLI e gera componentes no próprio `src/`
(sem dependência de runtime de biblioteca de componentes). Tailwind como camada de utilidade.

### D7. Gráficos: Recharts

- **Alternativa considerada**: visx — mais flexível, porém mais código para cada gráfico.
- **Escolhido**: Recharts — cobre barras/linhas por dia e por grupo do painel de consumo com
  pouco código; suficiente para o escopo.

### D8. Autenticação no cliente sem ler o cookie

O cookie é `HttpOnly` — o JS não o enxerga. O estado "autenticado" é inferido:

- No boot da app (rota protegida), dispara uma chamada leve autenticada
  (`GET /admin/api/stats/overview`). `200` → sessão válida, monta o shell; `401` → redireciona
  para `/admin/login`.
- Login: `POST /admin/api/session` com `{ secret }`; em `200`, invalida as queries e segue
  para a rota pretendida.
- Logout: `DELETE /admin/api/session`; limpa o cache do TanStack Query e vai para `/admin/login`.
- Um interceptor global no cliente HTTP converte qualquer `401` em "sessão perdida":
  limpa o cache e navega para o login (atende ao cenário "sessão expirada durante o uso").
- `credentials: "include"` em todas as chamadas (mesmo sendo mesma origem sob `/admin`, deixa
  explícito o envio do cookie).

### D9. Caminho base `/admin` em build e roteamento

- Vite: `base: "/admin/"`.
- React Router: `basename: "/admin"`.
- Consequência: em dev a app também roda sob `/admin` (o dev server serve em `/admin/` e
  o proxy cobre `/admin/api`).

### D10. Dev server com proxy para o processo do bot

`vite.config.ts` → `server.proxy` mapeia `/admin/api` para `http://localhost:<PORT do bot>`
(default `3000`), com `changeOrigin` e `cookieDomainRewrite` conforme necessário. O cookie
`Secure` é aceito em `http://localhost` pelos navegadores atuais (exceção de localhost); se
um navegador recusar, o proxy pode terminar TLS local — registrado como mitigação, não como
requisito.

### D11. Pipeline de build/deploy

- `npm run build` na SPA gera `dist/` (estáticos com base `/admin/`).
- O deploy constrói a SPA **antes** de empacotar/subir o servidor e posiciona o `dist/` no
  caminho de `ADMIN_WEB_DIST_DIR` ao lado do servidor. Com o diretório presente, o
  `admin-static.ts` da `management-api` já serve os arquivos; ausente, o servidor sobe só com
  a API (comportamento já existente).
- CI: um job para a SPA (instala, `lint`, `typecheck`, `build`). Rollback = não publicar o
  `dist/` (servidor volta a modo API-only sem mudança de código).

### D12. Entrega incremental das telas de ação

As telas de ação (handoff/retomar/mensagem avulsa) e de prospecção dependem de endpoints que
ainda não existem. A spec ("Superfície de ações condicionada à disponibilidade da API")
exige que os controles fiquem ocultos/desabilitados quando o endpoint responde como
inexistente/não implementado. Implementação: uma checagem de capacidade por probing leve
(ou um mapa de features derivado da resposta) que habilita cada afordância. Quando
`add-management-conversation-actions` e `add-outbound-prospecting-trigger` forem arquivadas,
elas acrescentam deltas a esta capability e as telas correspondentes são ligadas.

### D13. Tooling da SPA isolado

ESLint + Prettier + `tsconfig` próprios no pacote da SPA, espelhando as convenções do
servidor (`.prettierrc.json`, regras `typescript-eslint`), sem tentar estender a config do
outro repositório. Vitest + Testing Library para os testes de componente/hook; Vite já
provê o ambiente.

## Risks / Trade-offs

- **Acoplamento por `file:` entre dois repositórios Git** → O servidor expõe um export
  estável `./contracts` (superfície mínima e versionada); a SPA importa só desse subcaminho.
  Documentar a ordem de release (servidor primeiro quando o contrato muda). Ponto de
  extração para um pacote publicável já identificado (D5).
- **Releases fora de sincronia servidor/SPA** → Validação de resposta por schema zod no
  cliente (D5); ao divergir, aviso de incompatibilidade com a versão esperada em vez de tela
  quebrada.
- **Cookie `Secure` em dev sobre HTTP** → Exceção de `localhost` nos navegadores atuais;
  mitigação disponível terminando TLS no dev server/proxy se algum navegador recusar.
- **Polling somando carga no processo único do bot** → Intervalos conservadores (10–30 s),
  `refetchIntervalInBackground: false`, deduplicação do TanStack Query. SSE como evolução.
- **`shadcn/ui` gera muitos arquivos no `src/`** → Aceito; são componentes versionados no
  próprio repo, sem dependência de runtime.
- **Primeira toolchain de bundler no projeto** → Contida no repositório da SPA; não toca o
  build/lint/test do servidor.

## Migration Plan

Mudança aditiva. Sem migração de dados. Passos de implantação:

1. Servidor: adicionar o export `./contracts` no `package.json` e o barrel `dto/index.ts`
   (reexports + `MANAGEMENT_CONTRACT_VERSION`). Sem mudança de comportamento.
2. Criar o repositório/pasta `applications/wpp_prospector_bot_panel/` com a toolchain e as
   telas.
3. Pipeline: build da SPA → `dist/` posicionado em `ADMIN_WEB_DIST_DIR` ao lado do servidor.
4. Deploy do servidor: com o `dist/` presente, `/admin` passa a servir a interface;
   `/admin/api` inalterado.

Rollback: remover/não publicar o `dist/` — o servidor volta a modo API-only sem alteração de
código (comportamento já coberto pela `management-api`).

## Open Questions

- Identidade visual (paleta, logotipo) do painel — decidível depois, não afeta specs nem
  tarefas.
- Intervalo exato de polling por tela dentro da faixa 10–30 s — ajustável sem mexer em spec.
- Se as telas de ação/prospecção detectam disponibilidade por probing por endpoint ou por um
  único endpoint de "capabilities" — a definir junto com as changes que expõem esses
  endpoints; não bloqueia as telas de leitura.
