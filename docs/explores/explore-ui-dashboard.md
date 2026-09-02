# Explore — Interface visual de gestão do Bot

> Sessão de discovery (`opsx:explore`). Foco: definir a arquitetura de uma UI web para
> **operar e observar** o Bot — listar/detalhar conversas, estatísticas de consumo
> (LLM + WhatsApp), e ações de operação (assumir conversa, pausar o bot, mensagem
> avulsa, disparo de prospecção). Preferência declarada: **React**.

## Decisões tomadas nesta sessão

| Tema | Decisão |
|---|---|
| Escopo da UI | **Observa e age** — não é só leitura |
| Onde vive a API de gestão | **Mesmo processo Fastify do bot**, plugin sob `/admin` |
| Armazenamento estruturado | **SQLite embutido (`node:sqlite`) entra agora** |
| Conversas (agregado) | **Continuam em arquivo JSON por lead** — SQLite não substitui isso |
| Consumo a rastrear | **LLM (Anthropic) e WhatsApp (Meta) — os dois** |
| Modelo do store de consumo | **Append-only, evento por chamada, com timestamp** (série temporal) |
| Multiusuário | **Não agora.** Auth de usuário único (segredo + cookie assinado). RBAC/OAuth fica para depois |
| Front | **SPA React + Vite**, servida como estático pelo Fastify em produção |
| Deploy | **AWS** — instância única (Lightsail ou EC2 `t4g`), não serverless |
| Quebra em changes | **7 changes** encadeadas, para atacar em partes (ver §6) |

---

## 1. Respostas aos pontos em aberto

### 1.1 Escopo de escrita — a UI age

Ações previstas, agrupadas por risco/complexidade:

| Ação | Precisa de | Change |
|---|---|---|
| Assumir conversa (handoff manual) / retomar o bot | método de domínio + endpoint | `add-management-conversation-actions` |
| Pausar / retomar respostas automáticas de um lead | idem | `add-management-conversation-actions` |
| Enviar mensagem avulsa (janela de 24 h) | delega ao `SendTextMessageUseCase` existente | `add-management-conversation-actions` |
| Disparar a prospecção inicial para novos leads | **feature nova** — não há gatilho HTTP de outbound hoje; cadastro de lead + envio de template aprovado | `add-outbound-prospecting-trigger` |

Toda escrita que toca o estado da conversa **passa pelo processo do bot** — é o único lugar
que respeita a serialização por lead (`InboundBatchCoordinator`) e enxerga o estado vivo
(fila de rajada, sweeper de boot).

### 1.2 Consumo — LLM e Meta

Duas fontes, um mesmo store:

```
LLM (Anthropic)                          WhatsApp (Meta)
  message.usage de cada chamada            objeto `pricing` / `conversation` nos
  (hoje DESCARTADO em AnthropicLlmClient)  eventos de status do webhook
  input / output / cache_read / cache_write   categoria (marketing/utility/service/auth)
  por modelo (sonnet-5 vs haiku extração)  janela de conversa de 24 h (unidade de cobrança)
  por lead / por tipo de chamada           por lead / por conversa
        │                                        │
        └───────────► tabela de eventos SQLite ◄─┘
                      (append-only, timestamp)
                              │
                      queries de agregação (GROUP BY dia/lead/modelo/categoria)
                              │
                      estimativa de custo (tabela de preços versionada em código)
```

### 1.3 SQLite agora

Entra via `node:sqlite` (embutido no Node, experimental, **zero dependência nova** — coerente
com o minimalismo do projeto; `@types/node` já está na v26).

**O que vai para o SQLite:**
- Eventos de consumo LLM e Meta (série temporal).
- Projeção de leitura das conversas para a API de gestão (índice para listar/filtrar/paginar
  sem varrer todos os `*.json` a cada request) — materializada no boot e atualizada a cada
  `save()` do repositório de conversas.
- (Futuro) cadastro de leads / campanhas de prospecção.

**O que NÃO vai para o SQLite:**
- O agregado `Conversation` continua sendo **1 arquivo JSON por lead** (`data/conversations/`).
  É uma escolha deliberada do motor, casada com a invariante de escritor único. O SQLite é
  um **índice derivado**, não a fonte da verdade. Migrar o agregado é um projeto à parte, fora
  deste roadmap.

### 1.4 Multiusuário — não agora

- Autenticação de **usuário único**: um segredo compartilhado (env) + cookie de sessão
  assinado. `/admin/*` nunca exposto publicamente sem isso.
- O modelo de dados e os endpoints não assumem "dono" nem papéis. Quando entrar
  multiusuário (OAuth + RBAC), será uma change própria que adiciona a camada de identidade
  por cima — sem reescrever os endpoints de gestão.

### 1.5 Deploy AWS — avaliação

**Restrições que o app impõe:**
- Processo Node longevo e **stateful de fato**: mantém estado em memória (coordenador de
  rajada, sweeper) e depende do **filesystem local** (`data/conversations/*.json` + arquivo
  SQLite) com **serialização de escritor único**. Escalar horizontalmente quebra a invariante.
- Precisa de **um endpoint HTTPS público e estável** para o webhook da Meta (`/webhooks/*`).
- A UI/admin **não pode** ser pública.
- Tráfego baixo (bot de prospecção): eventos de webhook + poucos usuários no painel.
- Precisa de **disco persistente** (JSON + SQLite).

| Opção AWS | Veredito | Observações |
|---|---|---|
| **Lightsail** (instância + disco) | ✅ **Recomendado p/ começar** | Preço fixo, banda inclusa, menos botões que EC2. Node via `systemd`, disco local para JSON + SQLite. É "EC2 gerenciado" para setup pequeno. |
| **EC2 `t4g.small/medium`** (ARM) + EBS | ✅ Recomendado se quiser controle | Uma caixa, `systemd`, EBS para os dados. Custo previsível, casa com processo/escritor único. |
| **Elastic Beanstalk** (single instance) | ⚠️ Ok | Basicamente EC2 gerenciado. Serve, mas adiciona abstração sem ganho nessa escala. |
| **ECS Fargate** (1 task, `desiredCount=1`, sem autoscaling) | ⚠️ Funciona, mas | Precisa de **EFS** para persistência — e **SQLite sobre EFS é arriscado** (locking de rede). Mais partes móveis sem ganho agora. |
| **App Runner** | ❌ | Orientado a stateless, sem disco persistente → ruim para SQLite/arquivos. |
| **Lambda + API Gateway** | ❌ | Quebra o escritor único, sem coordenador/sweeper quentes em memória, FS efêmero, teto de 15 min. Só com rearquitetura da persistência (DynamoDB/RDS + fila) — não agora. |

**Serviços de apoio recomendados:**

| Necessidade | Recomendação |
|---|---|
| TLS + roteamento | **Caddy** (ou Nginx) na frente: `/webhooks/*` público; `/admin/*` atrás de allowlist de IP / basic-auth / **Tailscale ou Cloudflare Tunnel** (ideal: sem porta pública para o admin) |
| DNS / certificado | Route 53 + (ACM se usar ALB, ou Let's Encrypt no Caddy) |
| Segredos (`META_*`, `ANTHROPIC_API_KEY`) | **SSM Parameter Store** (free tier) ou Secrets Manager |
| Backup dos dados | Snapshot diário do EBS **ou** `litestream` replicando o SQLite para S3 continuamente |
| Front estático | Servido pelo próprio Fastify (`@fastify/static`) — um artefato de deploy. S3 + CloudFront só se quiser separar/CDN. |
| Logs | `journald` no começo; CloudWatch agent quando precisar reter/consultar |

**Recomendação:** Lightsail **ou** uma `t4g` única, Node em `systemd`, Caddy na frente
(TLS automático) roteando `/webhooks/*` público e `/admin/*` fechado (Tailscale de
preferência), segredos no SSM, snapshot diário do disco (ou Litestream → S3). Reavaliar
Fargate/RDS só ao sair de uma caixa (HA, multiusuário, mais throughput).

> Deploy/infra **não vira change OpenSpec** (não é capability de código). Fica registrado
> aqui; quando houver IaC, mora em `docs/` ou repositório próprio.

### 1.6 Retenção / histórico — o ponto que ficou confuso

A dúvida do ponto 5 do explore. A distinção é entre **duas naturezas de número** no painel
de estatísticas:

**a) Contador do "agora" (estado corrente).** Ex.: "quantas conversas ativas", "quantas
aguardando humano", "quantos leads no total". É derivável a qualquer instante varrendo o
estado atual — **não exige guardar histórico**. Se o painel só mostrasse isso, bastaria
contar.

**b) Série temporal (histórico).** Ex.: "quantos tokens gastei ontem", "custo por dia na
última semana", "conversas novas por dia no mês". Isso **exige registrar cada evento com
timestamp e nunca sobrescrever**: cada chamada ao LLM vira uma linha, cada conversa de 24 h
da Meta vira uma linha. O painel **agrega na hora de exibir** (`GROUP BY` dia/semana/mês).

**Consequência de design** (por isso a pergunta importa): o store de consumo é
**append-only e imutável**. Nunca "`UPDATE` no total acumulado"; sempre "`INSERT` de um
evento". Com isso:

- Qualquer recorte temporal (hoje / ontem / 7 d / 30 d / custom) sai da mesma tabela.
- **Retenção** = política de por quanto tempo manter as linhas cruas antes de resumir ou
  descartar. Proposta inicial: manter eventos crus por **90 dias**; manter **agregados
  diários** (uma linha por dia/modelo/categoria) indefinidamente; job de limpeza opcional,
  adicionado depois se o arquivo crescer.
- Decisão registrada: **vamos com série temporal desde o início** (b), porque o painel
  pede recortes "ontem/semana/mês". Os contadores "agora" (a) saem da projeção de leitura
  das conversas.

---

## 2. Arquitetura escolhida

```
┌──────────────────────────────────────────────────────────────┐
│  processo Node (bot)  —  Fastify                              │
│                                                              │
│  ┌───────────────┐   ┌────────────────────────────────────┐   │
│  │ plugin webhook│   │ plugin /admin  (novo)              │   │
│  │ /webhooks/... │   │  módulo "management" (Clean Arch)   │   │
│  │ (público)     │   │  ├─ auth: segredo + cookie assinado │   │
│  └──────┬────────┘   │  ├─ read models (conversas, stats) │   │
│         │            │  ├─ ações → delega a use-cases      │   │
│         ▼            │  └─ /admin/*  estáticos (SPA build) │   │
│  InboundBatchCoordinator ◄──────────┘ (mesma instância)    │   │
│         │                                                    │
│  ┌──────┴──────────────┐     ┌───────────────────────────┐   │
│  │ FileConversationRepo│────►│ data/conversations/*.json │   │
│  │  (fonte da verdade) │     └───────────────────────────┘   │
│  └──────┬──────────────┘                                     │
│         │ a cada save()                                       │
│         ▼                                                     │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ SQLite (node:sqlite)  —  data/app.db                 │    │
│  │  • projeção de leitura de conversas (índice)         │    │
│  │  • eventos de consumo LLM   (append-only)            │    │
│  │  • eventos de consumo Meta  (append-only)            │    │
│  └─────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
                         ▲
                         │  dev: Vite dev server + proxy
                         │  prod: build estático servido pelo Fastify
              ┌──────────┴───────────┐
              │  applications/       │
              │  wpp_prospector_bot_web (React + Vite)
              └──────────────────────┘
```

### Stack do front

| Camada | Escolha | Notas |
|---|---|---|
| Build | **Vite** | primeira toolchain de bundling do repo |
| Framework | **React SPA** (sem Next/SSR) | sem SEO/SSR; um 2º servidor só somaria deploy |
| Estrutura | **npm workspaces** | já usam npm; custo zero, sem dep nova |
| Routing | TanStack Router **ou** React Router 7 | decidir no design da change de UI |
| Dados | **TanStack Query** | polling via `refetchInterval`; SSE depois se incomodar |
| Estilo | **Tailwind + shadcn/ui** | — |
| Charts | Recharts **ou** visx | para o painel de consumo |
| Pacote | `applications/wpp_prospector_bot_web` | espelha `applications/wpp_prospector_bot_server` |

### Tempo real

Começa com **polling** (TanStack Query). **SSE** pelo Fastify quando o polling incomodar.
WebSocket só se surgir interação bidirecional pesada (não previsto).

---

## 3. Roadmap de changes OpenSpec

Sete changes encadeadas. Trilhas 1 e 2 são backend; trilha 3 é a UI. Dentro da trilha 2 a
ordem é estrita.

```
add-embedded-sql-store  (fundação: node:sqlite + migrations + wiring)
   ├── add-llm-usage-tracking            (Anthropic usage → eventos)
   ├── add-whatsapp-messaging-cost-tracking (Meta pricing → eventos)
   └── add-management-api                (plugin /admin, auth 1 usuário, read models)
            └── add-management-conversation-actions (handoff, pausa, msg avulsa)
                     └── add-outbound-prospecting-trigger (disparo de prospecção)

add-management-web-ui   (SPA React; consome a API; entregue por telas conforme
                         as APIs acima ficam prontas)
```

| # | Change | Capability | Depende de | Entrega |
|---|---|---|---|---|
| 1 | `add-embedded-sql-store` | nova: `operational-data-store` | — | `node:sqlite`, runner de migrations, módulo de conexão, `DATABASE_PATH`, fiação no boot. Sem mudança de comportamento observável. Conversas seguem em arquivo (fora de escopo). |
| 2 | `add-llm-usage-tracking` | nova: `consumption-metrics` | 1 | `LlmClientPort` passa a expor `usage`; `UsageRecorderPort`; evento append-only por chamada (lead, tipo, modelo, tokens, cache); estimativa de custo com tabela de preços versionada. |
| 3 | `add-whatsapp-messaging-cost-tracking` | mod: `whatsapp-connectivity`; ext: `consumption-metrics` | 1 | Extrai `pricing`/`conversation` dos eventos de status; evento append-only por conversa de 24 h; agregação por categoria. |
| 4 | `add-management-api` | nova: `management-api` | 1 | Plugin Fastify `/admin/api`; auth usuário único (segredo + cookie assinado); read model de conversas (listar/filtrar/paginar/detalhar) via projeção SQLite quente; endpoints de estatística de consumo; contadores "agora". Só leitura + auth. |
| 5 | `add-management-conversation-actions` | ext: `management-api` (+ mod `conversation-engine`) | 4 | Endpoints de escrita: handoff manual + retomar; pausar/retomar respostas automáticas por lead; enviar mensagem de sessão (24 h). Delega aos use-cases; pode adicionar métodos de domínio. |
| 6 | `add-outbound-prospecting-trigger` | nova: `outbound-prospecting` (+ mod `whatsapp-connectivity`) | 4 (usa 5) | Cadastro de lead(s); disparo HTTP de template aprovado; semear a `Conversation`. Feature nova — hoje não há gatilho de outbound. |
| 7 | `add-management-web-ui` | nova: `management-web-ui` | 4 (telas de leitura); 5/6 destravam telas de ação | npm workspaces; `applications/wpp_prospector_bot_web` (Vite + React + TanStack + Tailwind + shadcn); login; shell; conversas (lista/detalhe); painel de consumo; painéis de ação conforme as APIs. Estático servido por `@fastify/static` em prod. |

Ordem sugerida de ataque: **1 → 2 → 4 → 7** (fatia vertical mínima: consumo LLM visível no
painel) e depois **3, 5, 6** conforme a prioridade.

---

## 4. Fora de escopo / decisões adiadas

| Item | Decisão |
|---|---|
| Migrar o agregado `Conversation` para SQLite | Adiado. SQLite é índice derivado; arquivo JSON continua a fonte da verdade. |
| Multiusuário, OAuth, RBAC | Adiado. Auth de usuário único agora; camada de identidade por cima depois. |
| IaC / automação de deploy AWS | Fora do OpenSpec (não é capability de código). Registrado em §1.5. |
| SSE / WebSocket | Adiado. Polling primeiro. |
| S3 + CloudFront para o front | Adiado. Fastify serve o estático. |
| Job de limpeza/retenção de eventos crus | Adiado. Adicionar quando o arquivo crescer; política inicial em §1.6. |
| Mensagens não-texto no painel | Segue o motor: descartadas em `HandleInboundMessageUseCase`. |
