## 1. Dependências

- [x] 1.1 Adicionar `baileys` (versão fixa, não `^`/`latest`), `pino` e `@hapi/boom` como dependências
- [x] 1.2 Confirmar que `qrcode-terminal` continua suficiente para renderizar a string de QR entregue pelo Baileys

## 2. Reimplementar `WhatsAppSession` sobre o Baileys

- [x] 2.1 Definir o tipo `BaileysSocketLike` (fatia da API do socket usada: `ev.on`/`ev.process`, `sendMessage`, `sendPresenceUpdate`, `onWhatsApp`, `logout`, `end`) e trocar a injeção de teste de "client fake" para "factory de socket fake"
- [x] 2.2 Trocar a construção interna: `useMultiFileAuthState('.baileys_auth/<sessionId>')` para credenciais + `makeWASocket({ auth, logger, version })` para o socket, substituindo `Client`/`LocalAuth`
- [x] 2.3 Mapear o evento `connection.update` para os eventos públicos já existentes: `qr` (renderiza com `qrcode-terminal` e emite `qr`), `connection === 'open'` emite `ready`, `connection === 'close'` decide entre reconectar (reaproveitando `scheduleReconnect()`) ou emitir `disconnected` definitivo com base em `DisconnectReason.loggedOut`
- [x] 2.4 Chamar `saveCreds()` a cada evento `creds.update` para persistir a sessão
- [x] 2.5 Reescrever `sendMessage(to, text)`: resolver `to` via `sock.onWhatsApp(...)`, chamar `sock.sendPresenceUpdate('composing', jid)`, aguardar o mesmo delay de digitação já calculado por `typingDelayFor`, e enviar via `sock.sendMessage(jid, { text })`
- [x] 2.6 Atualizar `SessionManager` apenas no que for necessário para continuar compatível com a nova `WhatsAppSession` (a API pública de `SessionManager` não muda)

## 3. Testes automatizados

- [x] 3.1 Reescrever `session.test.ts` para o novo seam de teste (factory de socket fake), cobrindo as mesmas transições de estado, reconexão e presença já testadas hoje
- [x] 3.2 Rodar a suíte completa (`npm test`) e confirmar que tudo passa

## 4. Remoção da stack antiga

- [x] 4.1 Remover a dependência `whatsapp-web.js`, o patch local `patches/whatsapp-web.js+1.34.7.patch` e o hook `postinstall`/dependência `patch-package` associados a ele
- [x] 4.2 Atualizar `.gitignore` (`.wwebjs_auth/`, `.wwebjs_cache/` → `.baileys_auth/`)

## 5. Verificação

- [x] 5.1 Rodar `npm test` uma última vez após a limpeza de dependências e confirmar que a suíte passa
- [x] 5.2 QA manual: parear um número real via QR code (sessão nova, não reaproveita `.wwebjs_auth/`), confirmar `ready`, enviar uma mensagem de teste real pelo `index.ts`, confirmar persistência da sessão após reiniciar o processo, e confirmar reconexão automática após uma queda forçada — espaçando as tentativas de reconexão para não soar como comportamento automatizado suspeito para a conta
- [x] 5.3 Atualizar `README.md` (stack técnica, estrutura do projeto, fluxo do motor anti-ban) para refletir a migração de `whatsapp-web.js` para Baileys
