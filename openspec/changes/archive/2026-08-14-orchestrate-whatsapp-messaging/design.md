## Context

See proposal.md - Why. `SessionManager`, `WarmupSchedule`/`WarmupTracker`, `SendQueue` e `DailyVolumeLimiter` já existem e têm cobertura de teste (ver `openspec/changes/archive/2026-08-13-define-whatsapp-connection-strategy/`), mas nunca foram conectados. `src/index.ts` é hoje um placeholder.

## Goals / Non-Goals

**Goals:**
- Fazer o teto por número (rampa de aquecimento) ser realmente aplicado antes de um envio, não só calculado.
- Compor o teto por sessão com o teto global (100/dia) na mesma fila, sem duplicar a lógica de persistência/reset de dia.
- Dar um jeito manual e mínimo de validar pareamento real via QR code + o pipeline de anti-ban funcionando junto.

**Non-Goals:**
- API HTTP ou qualquer superfície voltada a integração externa — não há RF-01 (importação de leads) nem RF-02 (campanhas) implementados ainda para consumir isso.
- Orquestração de múltiplos processos/instâncias — o design assume um único processo Node.js (mesma suposição já usada por `DailyVolumeLimiter`, que persiste em arquivo local).
- Motor de conversa/IA (RF-03) — fora de escopo, tratado em change futuro.

## Decisions

### Decision: nova classe `PerSessionWarmupGate`, não generalizar `DailyVolumeLimiter`
`DailyVolumeLimiter` mantém seu único propósito (teto global fixo, persistido, com reset diário). `PerSessionWarmupGate` é uma classe própria, com a mesma forma pública (`hasCapacity()`, `recordSend()`, `msUntilReset()`) mas com uma diferença importante: seu limite diário não é fixo — é recalculado a cada chamada a partir de `warmupSchedule.allowedVolume(tracker.daysSinceActivation(sessionId), fullAllotment)`, já que a rampa avança dia após dia. Internamente reaproveita o mesmo padrão de persistência em arquivo (contagem do dia + rollover na virada) já usado por `DailyVolumeLimiter`, só que com o limite dinâmico em vez de constante.

`fullAllotment` de cada sessão é o próprio teto global (100), não uma fração dividida entre números — ver próxima decisão.

### Decision: `fullAllotment` por sessão = teto global (100), não dividido entre números
Cada número, uma vez aquecido, pode em tese tentar mandar até 100/dia sozinho. Quem garante que a soma de todos os números não ultrapasse 100/dia é o `DailyVolumeLimiter` compartilhado, verificado na mesma fila. Isso evita ter que redistribuir cotas manualmente conforme números são adicionados/removidos — os dois limitadores compostos já resolvem isso: no início, a rampa por número é o fator limitante; depois de aquecido, o teto global assume esse papel.

### Decision: `SendQueue` aceita uma lista de `VolumeGate`, não um único `dailyLimiter`
Nova interface estrutural:
```
interface VolumeGate {
  hasCapacity(): boolean;
  recordSend(): void;
  msUntilReset(): number;
}
```
`DailyVolumeLimiter` já satisfaz essa forma sem alteração. `PerSessionWarmupGate` também a implementa. A opção `dailyLimiter?: DailyVolumeLimiter` de `SendQueue` vira `gates?: VolumeGate[]`; o loop de processamento passa a checar `hasCapacity()` de todos os gates antes de desenfileirar, e chama `recordSend()` em todos após um envio bem-sucedido. Se qualquer gate estiver saturado, a fila espera pelo maior `msUntilReset()` entre os que estão sem capacidade, e reavalia.

Isso é uma mudança de forma na API pública de `SendQueue` — aceitável porque nada além dos testes já escritos depende dela hoje (nunca foi usada em `index.ts`).

### Decision: ativação da rampa é registrada no evento `ready` da sessão
`SessionManager.addSession()` (ou o orquestrador em `index.ts`) escuta o evento `ready` de cada `WhatsAppSession` e chama `warmupTracker.recordActivation(sessionId)`. Como `recordActivation` já é idempotente (só grava na primeira vez), é seguro registrar o listener sempre, sem checar se é a primeira conexão.

### Decision: `index.ts` vira um CLI mínimo, não uma API
Ao rodar `npm run dev`: pareia um número configurado (ex.: via variável de ambiente `SESSION_ID`), aguarda o evento `ready`, cria a `SendQueue` composta (per-session gate + daily limiter) apontando pro `WhatsAppSession.sendMessage`, e aceita uma linha simples via stdin (`<numeroDestino> <texto>`) para enfileirar uma mensagem de teste. Suficiente para validar manualmente QR + rampa + jitter + teto — sem inventar uma superfície de API que nada mais consome ainda.

### Decision: falha de envio é logada e a fila segue adiante, sem derrubar o processo
Descoberto durante o QA manual (task 5.2): `send()` pode rejeitar (ex.: `whatsapp-web.js` falhando ao raspar internamente o WhatsApp Web — risco já aceito da conectividade não-oficial) e, sem tratamento, essa rejeição não tratada derrubava o processo Node inteiro, perdendo a sessão pareada e a fila. `SendQueue.processQueue()` passa a envolver `this.send(message)` num try/catch: em caso de erro, loga via `console.error` e segue para a próxima mensagem, sem chamar `recordSend()` nos gates para essa mensagem (ela não foi entregue, não deve contar contra o teto) e sem re-enfileirar automaticamente — retry com backoff é uma política que ainda não foi desenhada, fica para um change futuro se necessário.

### Decision: resolver o ID real do WhatsApp antes de `getChatById`/`sendMessage`
Descoberto durante o QA manual (task 5.2): `WhatsAppSession.sendMessage(to, text)` chamava `client.getChatById(to)` direto com o `to` montado à mão (`<numero>@c.us`), e isso falhava (`r: r`, erro minificado vindo de dentro do `whatsapp-web.js`) mesmo para um número que já era contato existente. Causa: o ID serializado que o `getChatById`/`sendMessage` do WhatsApp Web realmente espera nem sempre é o `<numero>@c.us` construído manualmente (ex.: contatos com endereçamento `@lid`). `WhatsAppSession.sendMessage` passa a chamar `client.getNumberId(to)` primeiro — que resolve e valida o ID real junto ao WhatsApp — e usa o `_serialized` retornado tanto no `getChatById` quanto no `sendMessage`; se o número não estiver registrado no WhatsApp, lança um erro claro em vez de deixar a chamada falhar com um erro minificado sem contexto.

### Decision: patch local no `whatsapp-web.js` para o bug `_serialized`/`$1` (via `patch-package`)
Mesmo com a resolução de ID acima, o `getChatById` continuava falhando com `r: r` — investigação (ver GitHub [issue #201838](https://github.com/wwebjs/whatsapp-web.js/issues/201838) e [#201845](https://github.com/wwebjs/whatsapp-web.js/issues/201845), ambas abertas e não confirmadas pelos mantenedores) confirmou que é um bug conhecido do `whatsapp-web.js@1.34.7`: uma atualização do WhatsApp Web em julho/2026 renomeou a propriedade interna `_serialized` para `$1` nos objetos de ID, quebrando `getChat`/`getChatById`/`sendMessage` na própria biblioteca — não é um bug do código deste projeto. Existe um [PR aberto (#201871)](https://github.com/wwebjs/whatsapp-web.js/pull/201871), ainda não mergeado nem publicado no npm, com um fallback `$1 → _serialized`. O diff (4 arquivos, ~76 linhas) foi revisado manualmente e aplicado como patch local via `patch-package` (`patches/whatsapp-web.js+1.34.7.patch` + hook `postinstall`), para sobreviver a um `npm install` futuro. Quando a correção for lançada oficialmente no npm, este patch deve ser removido.

### Bloqueio conhecido: `getChatById`/`getChat` ainda falham para IDs `@lid`
Mesmo com o patch acima, `getChatById` passou a retornar `undefined` (em vez de lançar) para qualquer chat cujo ID resolvido pelo `getNumberId` seja um endereço `@lid` (o novo sistema de "Linked ID" do WhatsApp, que está substituindo o `@c.us` baseado no número de telefone). Confirmado como falha **sistêmica e não específica de contato**: até o self-chat (mandar para o próprio número da sessão) falha da mesma forma. `WhatsAppSession.sendMessage` agora lança um erro claro (`Could not open a WhatsApp chat for: ...`) nesse caso em vez de estourar um `TypeError` obscuro, mas o envio real continua bloqueado até a comunidade do `whatsapp-web.js` cobrir esse caso (não encontrado nenhum patch/PR aberto para isso no momento desta investigação). Task 5.2 (QA manual) permanece bloqueada por essa causa externa ao projeto.

Testada e descartada a hipótese de fixar `webVersionCache` numa build mais antiga do WhatsApp Web (via o cache remoto mantido por `wppconnect-team/wa-version`) para tentar escapar do `@lid`: o mesmo ID `@lid` foi resolvido pelo servidor do WhatsApp independentemente da versão do cliente web usada, confirmando que a atribuição `@lid` é decidida do lado do servidor/conta, não do cliente. Não vale a pena revisitar essa via.

## Risks / Trade-offs

- [Risk] Persistência em arquivo JSON local (usada tanto por `DailyVolumeLimiter` quanto por `PerSessionWarmupGate`) não é segura sob múltiplos processos concorrentes. → [Mitigation] Aceito por ora — o CLI é single-process; revisitar se a aplicação virar um serviço distribuído/multi-processo.
- [Risk] Mudar a API pública de `SendQueue` (`dailyLimiter` → `gates`) quebra qualquer código que já a use. → [Mitigation] Nenhum código além dos testes existentes depende dela hoje; mudança é segura agora e ficaria bem mais cara depois que `index.ts` já estivesse em uso real.
- [Risk] CLI mínimo não é um teste automatizado — ainda depende de um humano com celular para validar o pareamento real. → [Mitigation] Aceito conscientemente: esse é exatamente o propósito (destravar a verificação manual pendente da task 4.1 do change anterior), não uma automação completa.
