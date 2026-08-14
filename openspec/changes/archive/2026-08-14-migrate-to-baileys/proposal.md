## Why

Durante o QA manual do change `orchestrate-whatsapp-messaging`, confirmamos que `whatsapp-web.js@1.34.7` (a biblioteca por trás da capability `whatsapp-connectivity`) está bloqueado por um bug ainda sem correção: `getChatById`/`getChat` falham sistemicamente para qualquer chat cujo ID resolvido pelo WhatsApp seja do novo endereçamento `@lid` — confirmado como falha geral da conta (até mandar mensagem para o próprio número falha), não algo específico de um contato. Isso impede qualquer envio real de mensagem hoje. `whatsapp-web.js` funciona raspando o HTML/JS minificado do WhatsApp Web via Puppeteer/Chromium, o que o deixa estruturalmente exposto a quebras assim toda vez que o WhatsApp atualiza o front-end — já são duas quebras desse tipo encontradas nesta única sessão de QA.

`Baileys` é uma alternativa que implementa o protocolo multi-device do WhatsApp diretamente via WebSocket, sem depender de um navegador raspando HTML, e trata `@lid` como identificador canônico de forma nativa e ativamente mantida. Este change avalia e desenha a migração da capability `whatsapp-connectivity` de `whatsapp-web.js` para `Baileys`.

## What Changes

- Substituir a implementação interna de `WhatsAppSession`/`SessionManager` (hoje baseada em `whatsapp-web.js` + Puppeteer/`LocalAuth`) por uma baseada em `Baileys`, mantendo a mesma superfície pública já consumida por `src/index.ts`, `SendQueue` e `PerSessionWarmupGate` (eventos `qr`/`ready`/`disconnected`, `sendMessage(to, text)`, `getStatus()`, `start()`/`stop()`).
- Trocar o mecanismo de persistência de sessão: de `LocalAuth` (perfil completo de navegador em `.wwebjs_auth/`) para o estado de autenticação multi-device do Baileys (chaves Signal/credenciais, tipicamente bem menores e sem Chromium).
- Remover a dependência de Puppeteer/Chromium do processo (Baileys não abre navegador).
- **BREAKING**: `whatsapp-web.js` e `qrcode-terminal`'s uso atual (se aplicável) saem das dependências; a forma de exibir o QR/pairing code muda de acordo com o que o Baileys expõe.
- Reavaliar se a simulação de presença ("digitando...", marcar como lido) descrita em `anti-ban-warmup` continua viável com as primitivas do Baileys, e como fica o formato do ID de destino (`to`) usado por quem chama `sendMessage` hoje (`<numero>@c.us`).

## Capabilities

### New Capabilities
_Nenhuma._

### Modified Capabilities
_Nenhuma — o objetivo desta migração é preservar o comportamento já especificado em `whatsapp-connectivity` (pareamento via QR, persistência de sessão, reconexão automática, número reduzido de sessões concorrentes) e em `anti-ban-warmup` (simulação de presença, jitter, tetos), apenas trocando a biblioteca de transporte por baixo. Nenhum requisito de comportamento observável muda. Se o design revelar que algum requisito não é sustentável com o Baileys (ex.: a simulação de presença), isso será sinalizado explicitamente antes de a implementação prosseguir, e as specs serão revisadas nesse momento — não nesta proposta. `skip_specs: true` está declarado em `.openspec.yaml`._

## Impact

- **Código:** `src/whatsapp/session.ts` e `src/whatsapp/sessionManager.ts` (reimplementação interna), possivelmente `src/index.ts` (formato de exibição do QR/pairing code), testes de `session.test.ts` (o "fake client" de teste muda de forma).
- **Dependências:** remove `whatsapp-web.js`, `qrcode-terminal` (se o Baileys expuser sua própria exibição de QR) e o patch local (`patches/whatsapp-web.js+1.34.7.patch`, `patch-package`) aplicados no change `orchestrate-whatsapp-messaging`; adiciona `baileys` (e possivelmente `@whiskeysockets/baileys`'s dependências, como `qrcode-terminal` ou `pino` para logging).
- **Ambiente:** elimina a necessidade de baixar/rodar Chromium (`puppeteer`), reduzindo footprint de memória/disco do processo.
- **Sem mudança de especificação pretendida** — ver seção Capabilities.
