<!-- Open Questions do design não afetam o que é construído: identidade visual, o intervalo
     exato de polling (dentro de 10–30 s) e a forma de detecção de disponibilidade das
     telas de ação são ajustáveis sem mexer nas specs nem nesta quebra. -->

## 1. Export de contratos no servidor

- [x] 1.1 Criar `src/management/interface/dto/index.ts` como barrel: reexporta `common.ts`, `conversation.dto.ts`, `consumption.dto.ts`, `overview.dto.ts`, `query.ts` e a constante `MANAGEMENT_CONTRACT_VERSION`
- [x] 1.2 Adicionar ao `package.json` do servidor o campo `exports` com a entrada `"./contracts": { "types"/"import": ... }` apontando para o barrel (via `src/` em dev, `dist/` no build `tsc`); manter o `main` atual
- [x] 1.3 Verificar que `npm run build` (tsc) emite `dist/management/interface/dto/index.js` + `.d.ts` e que o subcaminho resolve; nenhum comportamento de runtime do servidor muda
- [x] 1.4 Nota curta no `README.md` do servidor: `wpp_prospector_bot_server/contracts` é a superfície pública consumida pela SPA; bump de `MANAGEMENT_CONTRACT_VERSION` ao alterar um DTO de forma incompatível

## 2. Scaffolding do pacote da SPA

- [x] 2.1 Criar `applications/wpp_prospector_bot_panel/` (repositório/pasta irmão de `wpp_prospector_bot_server/`) com `package.json` (`"type": "module"`, `engines.node >=24`), `.gitignore` (`node_modules/`, `dist/`), e `README.md`
- [x] 2.2 Adicionar dependências: `react`, `react-dom`, `react-router-dom@7`, `@tanstack/react-query`, `zod`, `recharts`; dev: `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `eslint`, `typescript-eslint`, `eslint-config-prettier`, `prettier`, `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`
- [x] 2.3 Declarar a dependência `"wpp_prospector_bot_server": "file:../wpp_prospector_bot_server"` e instalar; confirmar que `import { conversationListPageSchema, MANAGEMENT_CONTRACT_VERSION } from "wpp_prospector_bot_server/contracts"` resolve
- [x] 2.4 `tsconfig.json` da SPA (`jsx: react-jsx`, `moduleResolution: bundler`, `strict`, `noUncheckedIndexedAccess`, `types: ["vite/client"]`)
- [x] 2.5 `vite.config.ts`: `plugins: [react()]`, `base: "/admin/"`, `server.proxy` mapeando `/admin/api` → `http://localhost:${PORT ?? 3000}` (`changeOrigin: true`), e a config de resolução/transpile necessária para o subcaminho `wpp_prospector_bot_server/contracts`
- [x] 2.6 `index.html` na raiz do pacote com `<div id="root">` e `<script type="module" src="/src/main.tsx">`
- [x] 2.7 ESLint (`eslint.config.js` com `typescript-eslint` + `eslint-config-prettier`), `.prettierrc.json` espelhando o do servidor; scripts `dev`, `build`, `preview`, `lint`, `typecheck`, `test` no `package.json`
- [x] 2.8 Inicializar Tailwind (`tailwind.config.js`, `postcss.config.js`, diretivas no CSS global) e `shadcn/ui` (`components.json`, util `cn`, diretório `src/components/ui/`)
- [x] 2.9 `src/main.tsx` + `src/App.tsx` mínimos renderizando "carregando" para validar o boot com `vite dev` sob `/admin/`

## 3. Camada de dados e cliente HTTP tipado

- [x] 3.1 Criar `src/api/client.ts`: `fetch` wrapper com `credentials: "include"`, base `/admin/api`, JSON, e tratamento central de `401` (dispara um evento/callback "sessão perdida")
- [x] 3.2 Criar `src/api/contracts.ts` reexportando de `wpp_prospector_bot_server/contracts` os schemas e tipos usados pela SPA + `MANAGEMENT_CONTRACT_VERSION` (ponto único de importação do contrato)
- [x] 3.3 Criar `src/api/parse.ts`: `parseWithContract(schema, payload)` que faz `safeParse` e, na falha, lança um `ContractMismatchError` carregando a versão esperada (`MANAGEMENT_CONTRACT_VERSION`)
- [x] 3.4 Criar as funções de endpoint tipadas em `src/api/endpoints.ts`: `listConversations(query)`, `getConversation(leadPhone)`, `getConsumption(query)`, `getOverview()`, `createSession(secret)`, `deleteSession()` — cada leitura valida a resposta com `parseWithContract`
- [x] 3.5 Configurar o `QueryClient` (`src/api/query-client.ts`): defaults com `refetchIntervalInBackground: false`, `retry` moderado, e um `QueryCache.onError` que trata `401`/sessão perdida limpando o cache
- [x] 3.6 Testes (Vitest): `parseWithContract` aceita payload conforme e lança `ContractMismatchError` com a versão esperada em payload divergente; o cliente converte `401` em sessão perdida

## 4. Shell de autenticação e navegação

- [x] 4.1 Criar `src/auth/session.tsx`: contexto/hook que expõe `status: "checking" | "authenticated" | "anonymous"`, `login(secret)`, `logout()`; o probe inicial chama `getOverview()` e mapeia `200`→autenticado, `401`→anônimo
- [x] 4.2 Criar `src/routes/router.tsx` com `createBrowserRouter` e `basename: "/admin"`: rota pública `/login`, layout autenticado protegido (`conversations`, `conversations/:leadPhone`, `consumption`), e redirecionos (anônimo→`/login`, autenticado em `/login`→`/conversations`)
- [x] 4.3 Criar `src/routes/LoginRoute.tsx`: formulário de segredo → `login()`; erro `401` mostra falha inline e permanece na tela; sucesso navega para a rota pretendida (ou `/conversations`)
- [x] 4.4 Criar `src/components/AppShell.tsx`: navegação lateral/superior (Conversas, Consumo), ação de logout (`deleteSession()` → volta a `/login`), e um slot para o aviso global de incompatibilidade de contrato
- [x] 4.5 Ligar o "401 → sessão perdida" do cliente HTTP (3.1/3.5) ao roteador: limpa o cache e navega para `/login` sem exibir dados carregados
- [x] 4.6 Testes: login com segredo aceito revela o shell; segredo recusado (`401`) mantém o login com mensagem; `401` em chamada autenticada volta ao login e some com os dados; logout leva ao login e exige reautenticar

## 5. Tela de Conversas (listagem)

- [x] 5.1 Criar `src/features/conversations/useConversationList.ts`: `useQuery` sobre `listConversations(query)` com `refetchInterval` (10–30 s) e `refetchIntervalInBackground: false`; chave de query inclui os filtros
- [x] 5.2 Criar `src/features/conversations/ConversationsRoute.tsx`: tabela com telefone, estado, intent, qualificação, contagem de turnos, última atividade e marcação de inbound pendente; ordenação vinda da API preservada
- [x] 5.3 Controles de filtro combináveis (estado `active|ended|awaitingHuman`, intent do lead, trecho de telefone, faixa de data de última atividade) refletidos na query; mudança de filtro reinicia a paginação
- [x] 5.4 Paginação por cursor: botão/scroll "carregar próxima página" usando `nextCursor`; desabilitado quando `nextCursor` é `null`
- [x] 5.5 Estado vazio explícito quando a página volta sem itens (não erro); estados de carregamento e de erro de rede distintos
- [x] 5.6 Linha da tabela navega para `conversations/:leadPhone`
- [x] 5.7 Testes (Testing Library + fetch mockado): render da primeira página na ordem da API; filtros combinados repassados na chamada; busca por telefone repassada; "carregar próxima" usa o cursor; resposta vazia mostra estado vazio

## 6. Tela de Detalhe da Conversa

- [x] 6.1 Criar `src/features/conversations/useConversationDetail.ts`: `useQuery` sobre `getConversation(leadPhone)` com o mesmo padrão de polling; `404` tratado como estado "não encontrada", não erro
- [x] 6.2 Criar `src/features/conversations/ConversationDetailRoute.tsx`: linha do tempo dos turnos (inbound/outbound, texto, instante), e painel com intent, qualificação, módulos recomendados/de interesse, plano citado, flags de inbound pendente e de abandono/inatividade
- [x] 6.3 Estado "conversa não encontrada" com caminho de volta para a listagem
- [x] 6.4 Placeholder da área de ações (assumir/retomar/mensagem avulsa) — presente na tela, controles ocultos/desabilitados nesta change (ver seção 9)
- [x] 6.5 Testes: detalhe existente mostra turnos e todos os campos; `404` mostra "não encontrada" com volta para a lista; polling atualiza a linha do tempo sem recarregar

## 7. Tela de Consumo

- [x] 7.1 Criar `src/features/consumption/usePeriod.ts`: seletor de intervalo (hoje, 7 d, 30 d, personalizado) resolvendo `from`/`to` ISO 8601
- [x] 7.2 Criar `src/features/consumption/useConsumption.ts` e `useOverview.ts`: `useQuery` sobre `getConsumption({ from, to, groupBy })` e `getOverview()` com polling; chave inclui intervalo e `groupBy`
- [x] 7.3 Criar `src/features/consumption/ConsumptionRoute.tsx`: alternador de agrupamento (`day|lead|model|category`), gráfico Recharts (barras por dia / por grupo) de tokens e custo, e tabela com tokens somados + custo estimado por grupo e total do intervalo
- [x] 7.4 Exibir o custo de WhatsApp por categoria quando presente na resposta; marcar visualmente grupos com `costPartial: true`
- [x] 7.5 Cartões dos contadores do "agora" (`conversationsByState`, `totalLeads`, `pendingInbound`) a partir de `getOverview()`
- [x] 7.6 Intervalo sem eventos → série vazia / zeros renderizada como estado válido, não erro
- [x] 7.7 Testes: agrupamento por dia renderiza uma entrada por dia + total; alternar `groupBy` refaz a consulta; `costPartial` sinalizado; intervalo vazio mostra zeros; contadores do overview renderizados

## 8. Atualização periódica e aviso de contrato (transversais)

- [x] 8.1 Garantir `refetchIntervalInBackground: false` em todas as queries de dados e confirmar (teste ou verificação manual documentada) que o polling para com a aba oculta (`visibilitychange`) e retoma ao voltar
- [x] 8.2 Criar `src/components/ContractMismatchBanner.tsx`: escuta o `ContractMismatchError` (via `QueryCache.onError` / estado global) e exibe aviso persistente com a versão de contrato esperada; o dado divergente não é renderizado
- [x] 8.3 Testes: uma resposta que falha o `parseWithContract` faz aparecer o banner com a versão esperada e não renderiza aquele dado; respostas conformes não mostram o banner

## 9. Superfície de ações condicionada à API

- [x] 9.1 Criar `src/features/actions/useActionAvailability.ts`: determina, por probing leve (ou mapa de features), se os endpoints de ação (`.../handoff`, `.../resume`, `.../messages`) e de prospecção (`/admin/api/leads...`) existem no deploy; trata rota inexistente/`501` como indisponível
- [x] 9.2 No detalhe da conversa, renderizar os controles de ação apenas quando disponíveis; caso contrário ocultos ou desabilitados com indicação "indisponível neste servidor"
- [x] 9.3 Quando disponível, ao acionar uma ação, chamar o endpoint, refletir o novo estado da conversa na tela e, em recusa com motivo (ex.: `409` janela de 24 h), exibir o motivo devolvido sem descartar a tela
- [x] 9.4 Testes: endpoint ausente → nenhum controle acionável; ação bem-sucedida atualiza o estado exibido; recusa com motivo exibe o motivo e mantém a tela utilizável

## 10. Build, serviço em produção e CI

- [x] 10.1 `npm run build` da SPA gera `dist/` com base `/admin/`; validar abrindo via `vite preview` sob `/admin/`
- [x] 10.2 Verificação de integração ponta a ponta: posicionar o `dist/` em `ADMIN_WEB_DIST_DIR`, subir o servidor, confirmar que `/admin` serve a app, que a recarga em rota profunda cai no `index.html`, e que `/admin/api/*` segue respondendo
- [x] 10.3 Confirmar que, sem o `dist/`, o servidor sobe em modo API-only (comportamento já existente da `management-api`) — nenhuma regressão
- [x] 10.4 CI: job da SPA (instala com o `file:` link, `lint`, `typecheck`, `test`, `build`); documentar a ordem — build/servidor primeiro quando o contrato muda
- [x] 10.5 Documentar no `README.md` da SPA: dev (`vite dev` + servidor do bot em `:3000`), build, e o passo de deploy que posiciona o `dist/` ao lado do servidor; anotar o plano de telas incrementais (ações/prospecção conforme as changes `add-management-conversation-actions` e `add-outbound-prospecting-trigger`)
