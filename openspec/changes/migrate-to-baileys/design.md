## Context

Ver `proposal.md` - Why. `WhatsAppSession`/`SessionManager` hoje envolvem `whatsapp-web.js` (`Client` + `LocalAuth`), que abre um Chromium via Puppeteer e raspa o HTML/JS minificado do WhatsApp Web. `SendQueue`, `PerSessionWarmupGate`, `DailyVolumeLimiter` e `WarmupTracker` (capability `anti-ban-warmup`) só dependem do contrato público de `WhatsAppSession` (eventos `qr`/`ready`/`disconnected`, `sendMessage(to, text)`, `getStatus()`, `start()`/`stop()`) — nunca do `whatsapp-web.js` diretamente.

Pesquisa no código-fonte e no exemplo oficial do Baileys (`WhiskeySockets/Baileys`, `Example/example.ts`, verificado nesta investigação) confirma a forma atual da API:
- Socket criado via `makeWASocket({ auth, logger, version })` (função, não `new Client()`).
- Autenticação/sessão via `useMultiFileAuthState(dir)` → `{ state, saveCreds }`; `saveCreds()` deve ser chamado a cada evento `creds.update`.
- Estado de conexão via `sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => ...)`: `qr` traz a string do QR (Baileys não renderiza, só entrega a string — continuamos precisando de algo como `qrcode-terminal`); `connection === 'open'` é o equivalente ao `ready` atual; `connection === 'close'` traz `lastDisconnect.error` (um erro do `@hapi/boom`) cujo `.output?.statusCode` comparado a `DisconnectReason.loggedOut` diz se deve reconectar ou não.
- Resolução de número/JID via `sock.onWhatsApp(phoneJid)` → `[{ jid, exists }]`, onde `jid` já vem na forma canônica que a conta usa (pode ser `@s.whatsapp.net` ou `@lid`) — o equivalente nativo do `getNumberId` que usamos hoje, mas mantido pela própria lib multi-device em vez de raspagem.
- Presença "digitando" via `sock.sendPresenceUpdate('composing', jid)`.
- Envio via `sock.sendMessage(jid, { text })` — sem precisar abrir/criar um objeto de chat antes (elimina estruturalmente a classe de bug que travou o `orchestrate-whatsapp-messaging`: lá, `getChatById`/`getChat` falhavam ao tentar localizar/criar um `Chat` local antes de poder mandar a mensagem; no Baileys, `sendMessage` não depende desse passo).

## Goals / Non-Goals

**Goals:**
- Preservar o contrato público de `WhatsAppSession`/`SessionManager` (mesmos eventos, mesma assinatura de `sendMessage`), para que `SendQueue`, os gates de `anti-ban-warmup` e `src/index.ts` não precisem mudar.
- Eliminar a dependência de Puppeteer/Chromium do processo.
- Resolver de forma nativa o endereçamento `@lid`, sem depender de patches locais em bibliotecas de terceiros.

**Non-Goals:**
- Não é objetivo aproveitar a sessão já pareada em `.wwebjs_auth/` — o formato de credenciais do Baileys (chaves Signal multi-device) é incompatível com o perfil de navegador do `whatsapp-web.js`. Um novo pareamento via QR é esperado e aceito como custo único.
- Não é objetivo usar recursos do Baileys além do necessário para enviar mensagens de texto com simulação de presença (ex.: sincronização de histórico, mídia, grupos, `store` em memória) — fora do escopo atual do projeto (só envio outbound 1:1).
- Não é objetivo mudar `SendQueue`, `PerSessionWarmupGate`, `DailyVolumeLimiter` ou `WarmupTracker` — eles não conhecem o cliente WhatsApp por baixo.

## Decisions

### Decision: manter `WhatsAppSession`/`SessionManager` como a fronteira pública, reimplementar só por dentro
Nenhuma mudança de assinatura pública. Internamente, `WhatsAppSession` passa a envolver um socket criado por `makeWASocket(...)` em vez de um `whatsapp-web.js` `Client`. O construtor passa a receber (via uma factory injetável, para manter a testabilidade que hoje existe com `WhatsAppClientLike`) algo equivalente a um `BaileysSocketLike` — a fatia da API do socket que usamos (`ev.on`, `sendMessage`, `sendPresenceUpdate`, `onWhatsApp`, `logout`, `end`) — em vez de subclassar/injetar uma instância de `Client` como hoje. Como `makeWASocket` é uma função de fábrica (não uma classe instanciável), o seam de teste muda de "injetar um client fake" para "injetar uma factory de socket fake"; os testes existentes em `session.test.ts` precisam ser reescritos para esse novo formato, mas a cobertura comportamental (transições de estado, reconexão, presença) é a mesma.

### Decision: persistência via `useMultiFileAuthState`, um diretório por sessão
Troca `.wwebjs_auth/session-<id>/` (perfil completo de Chromium) por `.baileys_auth/<id>/` (arquivos JSON pequenos de credenciais/chaves Signal, sem navegador). `saveCreds()` é chamado a cada evento `creds.update` do socket. Muito mais leve; elimina os arquivos de lock/perfil de Chromium que já causaram problemas operacionais nesta investigação (`SingletonLock` preso após kill forçado).

### Decision: mapear `connection.update` para os eventos já existentes (`qr`/`ready`/`disconnected`)
- `qr` (string) no update → emitir nosso `qr` (mesma assinatura de hoje), renderizando via `qrcode-terminal` como já fazemos.
- `connection === 'open'` → emitir `ready`.
- `connection === 'close'` → inspecionar `(lastDisconnect?.error as Boom)?.output?.statusCode`: se for `DisconnectReason.loggedOut`, tratar como desconexão intencional/definitiva (emitir `disconnected`, não reconectar, mesmo comportamento de hoje quando `stop()` foi chamado); caso contrário, reaproveitar a lógica de backoff exponencial já existente em `scheduleReconnect()` (não precisa reescrever esse algoritmo, só trocar o que ele chama para recriar o socket).

### Decision: `sendMessage` resolve via `onWhatsApp`, sem etapa de "abrir chat"
Troca o fluxo atual (`getNumberId` → `getChatById` → `chat.sendStateTyping()` → `sendMessage`) por: `sock.onWhatsApp(phoneJid)` → `sock.sendPresenceUpdate('composing', jid)` → delay (reaproveita `typingDelayFor`) → `sock.sendMessage(jid, { text })`. Sem "chat" intermediário — remove estruturalmente o ponto exato onde o `whatsapp-web.js` quebrou (criação/busca de um objeto `Chat` local antes de poder enviar).

### Decision: dependências trocadas, não acumuladas
Adiciona `baileys`, `pino` (logger exigido pela lib), `@hapi/boom` (checar `DisconnectReason` tipado). Mantém `qrcode-terminal` (Baileys só entrega a string do QR). Remove `whatsapp-web.js`, o patch local (`patches/whatsapp-web.js+1.34.7.patch`) e o hook `postinstall`/dependência `patch-package` associados a ele (aplicados no change `orchestrate-whatsapp-messaging` para contornar bugs do `whatsapp-web.js` que deixam de existir nesta migração). Sem Puppeteer, elimina também as vulnerabilidades de alta severidade herdadas da árvore do Chromium já documentadas no README.

## Risks / Trade-offs

- [Risk] Baileys também é uma conexão não-oficial (mesmo risco de ToS que já foi aceito na decisão original de `whatsapp-connectivity`) — não piora nem resolve esse risco, só troca a implementação. → [Mitigation] Nenhuma ação nova necessária; risco já documentado e aceito no change arquivado `define-whatsapp-connection-strategy`.
- [Risk] Sessão pareada hoje (`.wwebjs_auth/`) não é reaproveitável; será necessário escanear um novo QR code uma vez. → [Mitigation] Custo único, aceito.
- [Risk] O Baileys anunciou mudanças estruturais grandes na v7.0.0 (nota de "BREAKING CHANGE" visível no próprio README no momento desta pesquisa) — API pode ainda estar em transição. → [Mitigation] Fixar uma versão específica no `package.json` (não usar `^`/`latest` sem revisão) e revisar `https://whiskey.so/migrate-latest` antes de qualquer upgrade futuro.
- [Risk] `sendPresenceUpdate('composing', jid)` para um `jid` que o socket ainda não "viu" localmente (sem chat/contato sincronizado) pode se comportar diferente do `chat.sendStateTyping()` atual, que dependia de um objeto `Chat` já resolvido. → [Mitigation] Validar explicitamente no QA manual da task de implementação (mesmo processo usado em `orchestrate-whatsapp-messaging`), com atenção redobrada para não fazer reconexões repetidas em sequência (lição aprendida nesta mesma investigação: reconexões rápidas demais pareceram deixar o pareamento mais lento, possível sinal de suspeita da conta).
- [Risk] Baileys não mantém um "chat store" por padrão (é orientado a eventos, não stateful como o `whatsapp-web.js`) — se o projeto precisar de histórico/lista de chats no futuro, exigirá adicionar um store separado. → [Mitigation] Não necessário para o escopo atual (só envio outbound); documentado aqui para não ser esquecido se isso mudar.

## Migration Plan

1. Adicionar dependências (`baileys`, `pino`, `@hapi/boom`); fixar versão exata do `baileys` no `package.json`.
2. Reimplementar o interior de `WhatsAppSession` (novo `BaileysSocketLike`, `makeWASocket`, `useMultiFileAuthState`, mapeamento de `connection.update`) mantendo a API pública.
3. Reescrever `session.test.ts` para o novo seam de teste (factory de socket fake em vez de client fake).
4. Remover `whatsapp-web.js`, `patches/whatsapp-web.js+1.34.7.patch`, o hook `postinstall`/`patch-package` do `package.json`, e atualizar `.gitignore` (`.wwebjs_auth/` → `.baileys_auth/`).
5. QA manual: novo pareamento via QR, confirmar `ready`, enviar mensagem de teste real, confirmar persistência entre reinícios e reconexão automática após queda forçada — espaçando as tentativas para não soar como comportamento automatizado suspeito para a conta.
6. Atualizar menções a `whatsapp-web.js` no `README.md` (stack técnica, estrutura do projeto, fluxo do motor anti-ban) para refletir o Baileys.

Sem plano de rollback formal além de reverter o commit: como a sessão pareada não é compatível entre as duas bibliotecas de qualquer forma, não há estado de produção em uso hoje que dependa da versão antiga.

## Open Questions

- Nome/local exato do diretório de auth state por sessão (`.baileys_auth/<sessionId>/` é a convenção sugerida, espelhando `.wwebjs_auth/session-<id>/`) — trivial, decidir na implementação.
- Se vale manter `qrcode-terminal` ou usar outra forma de exibir o QR — não afeta specs/abordagem, decidir na implementação.
