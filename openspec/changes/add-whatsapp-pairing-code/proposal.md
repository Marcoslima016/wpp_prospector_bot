## Why

Números temporários/virtuais (ex.: eSIMs de serviços como yesim.app) nem sempre oferecem uma forma prática de escanear o QR code hoje exigido para parear uma sessão — o único mecanismo implementado em `WhatsAppSession`. O Baileys já expõe um fluxo alternativo, o pairing code (um código de 8 caracteres digitado diretamente no app do WhatsApp), que a spec `whatsapp-connectivity` já previa como equivalente ("QR code or pairing code") mas nunca chegou a ser implementado.

## What Changes

- `WhatsAppSession` passa a suportar pareamento via pairing code como alternativa ao QR code, usando `sock.requestPairingCode(numero)` do Baileys.
- `index.ts` passa a mostrar um **menu interativo** ao iniciar o processo, perguntando ao operador qual método de pareamento usar (QR ou pairing code) em vez de decidir isso implicitamente por uma env var. Ao escolher pairing code, o número vem de `WA_PAIRING_NUMBER` (se definida) ou é pedido interativamente.
- Nova env var opcional `WA_PAIRING_NUMBER`: valor padrão/pré-preenchido para o número de telefone quando o operador escolhe pairing code no menu.
- Novo evento `pairing_code` em `WhatsAppSessionEvents`, emitido com o código retornado pelo Baileys, espelhando o evento `qr` já existente.
- O evento `disconnected` (já existia, mas nada o consumia) passa a carregar uma descrição rica da desconexão (status code, mensagem, payload cru do servidor) em vez de só o código numérico; `index.ts` escuta e imprime isso automaticamente com `console.error`, tanto pro fluxo de QR quanto pairing code.
- O seam de teste `BaileysConnect`/`BaileysSocketLike` é ampliado (novo campo `registered` no retorno de `BaileysConnect`, novo método `requestPairingCode`/`waitForSocketOpen` em `BaileysSocketLike`) para permitir que a sessão decida, sem se acoplar à API completa do `WASocket`, se deve pedir um pairing code ou não — evitando pedir de novo em sessões já registradas ao reiniciar o processo. O cálculo de `registered` combina `creds.registered` e `creds.account`, já que o Baileys só preenche o primeiro no fluxo de pairing code (ver design.md, decisão 9).
- `SessionManager.addSession` ganha um parâmetro `options` e um callback `onSessionCreated`, chamado de forma síncrona antes de `start()` ser aguardado — necessário pra `index.ts` conseguir escutar `pairing_code`/`disconnected` antes desses eventos poderem disparar.
- `.vscode/tasks.json`: removido o prompt de `sessionId` que sobrescrevia `SESSION_ID` do `.env` — a task agora sempre respeita o `.env`.
- `.env.example` documenta a nova variável.

## Capabilities

### New Capabilities
(nenhuma)

### Modified Capabilities
- `whatsapp-connectivity`: o requirement "Unofficial session-based WhatsApp connection" passa a ter pairing code como fluxo de pareamento efetivamente implementado (não apenas citado como equivalente hipotético), com um novo cenário cobrindo esse caminho.

## Impact

- Código: `src/whatsapp/session.ts` (tipos `BaileysConnect`/`BaileysSocketLike`/`WhatsAppSessionEvents`, `defaultConnect`, `connectSocket`/`registerEventHandlers`/`describeDisconnect`), `src/whatsapp/session.test.ts` (FakeSocket ganha `requestPairingCode`/`waitForSocketOpen` e cenários de `registered`/pairing code/desconexão), `src/whatsapp/sessionManager.ts` (`addSession` ganha `options`/`onSessionCreated`), `src/index.ts` (menu interativo, listener de `disconnected`), `.vscode/tasks.json`, `.env.example`.
- Dependências: nenhuma nova — usa API já presente em `baileys@6.7.24`.
- Sem impacto em sessões já pareadas (o menu não afeta reconexões de uma sessão já registrada, via QR ou pairing code).
- **Limitação conhecida, fora do nosso controle**: o fluxo de pairing code do Baileys tem uma falha de conexão em nível de TCP ~200ms depois de emitir o código, documentada há anos em issues abertas do próprio Baileys (não é algo que este change consiga corrigir - ver design.md, Risks/Trade-offs). QR continua sendo o caminho confiável nesse ambiente.
