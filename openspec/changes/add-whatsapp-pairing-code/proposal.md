## Why

Números temporários/virtuais (ex.: eSIMs de serviços como yesim.app) nem sempre oferecem uma forma prática de escanear o QR code hoje exigido para parear uma sessão — o único mecanismo implementado em `WhatsAppSession`. O Baileys já expõe um fluxo alternativo, o pairing code (um código de 8 caracteres digitado diretamente no app do WhatsApp), que a spec `whatsapp-connectivity` já previa como equivalente ("QR code or pairing code") mas nunca chegou a ser implementado.

## What Changes

- `WhatsAppSession` passa a suportar pareamento via pairing code como alternativa ao QR code, usando `sock.requestPairingCode(numero)` do Baileys.
- Nova env var opcional `WA_PAIRING_NUMBER`: quando definida, a sessão solicita um pairing code para esse número em vez de esperar passivamente o evento `qr`; quando ausente, o comportamento atual (QR code) é preservado sem alteração.
- Novo evento `pairing_code` em `WhatsAppSessionEvents`, emitido com o código retornado pelo Baileys, espelhando o evento `qr` já existente.
- O seam de teste `BaileysConnect`/`BaileysSocketLike` é ampliado (novo campo `registered` no retorno de `BaileysConnect`, novo método `requestPairingCode` em `BaileysSocketLike`) para permitir que a sessão decida, sem se acoplar à API completa do `WASocket`, se deve pedir um pairing code ou não — evitando pedir de novo em sessões já registradas ao reiniciar o processo.
- `index.ts` passa a logar o pairing code (quando emitido) da mesma forma que hoje loga a instrução de escanear o QR code.
- `.env.example` documenta a nova variável.

## Capabilities

### New Capabilities
(nenhuma)

### Modified Capabilities
- `whatsapp-connectivity`: o requirement "Unofficial session-based WhatsApp connection" passa a ter pairing code como fluxo de pareamento efetivamente implementado (não apenas citado como equivalente hipotético), com um novo cenário cobrindo esse caminho.

## Impact

- Código: `src/whatsapp/session.ts` (tipos `BaileysConnect`/`BaileysSocketLike`/`WhatsAppSessionEvents`, `defaultConnect`, `connectSocket`/`registerEventHandlers`), `src/whatsapp/session.test.ts` (FakeSocket ganha `requestPairingCode` e cenários de `registered`/pairing code), `src/index.ts` (leitura de `WA_PAIRING_NUMBER` e log do código), `.env.example`.
- Dependências: nenhuma nova — usa API já presente em `baileys@6.7.24`.
- Sem impacto em sessões já pareadas (fluxo QR permanece o padrão quando `WA_PAIRING_NUMBER` não é definida).
