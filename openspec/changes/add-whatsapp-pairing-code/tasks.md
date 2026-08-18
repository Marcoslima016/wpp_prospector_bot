## 1. Seam de conexão (session.ts)

- [x] 1.1 Adicionar `registered: boolean` ao tipo de retorno de `BaileysConnect` e calcular esse valor em `defaultConnect` a partir de `state.creds.registered`
- [x] 1.2 Adicionar `'requestPairingCode'` ao `Pick<WASocket, ...>` de `BaileysSocketLike`
- [x] 1.3 Adicionar `pairing_code: [code: string]` a `WhatsAppSessionEvents`
- [x] 1.4 Adicionar `pairingNumber?: string` a `WhatsAppSessionOptions` e armazenar em `WhatsAppSession`

## 2. Fluxo de pairing code na sessão

- [x] 2.1 Em `connectSocket()`, quando `pairingNumber` estiver definido e `registered` vier `false`, chamar `sock.requestPairingCode(pairingNumber)` e emitir `pairing_code` com o código retornado
- [x] 2.2 Confirmar que, quando `pairingNumber` não está definido ou `registered` vem `true`, o comportamento permanece idêntico ao atual (sem chamar `requestPairingCode`)

## 3. Bootstrap (index.ts e .env.example)

- [x] 3.1 Ler `process.env.WA_PAIRING_NUMBER` (opcional) em `index.ts` e repassar como `pairingNumber` ao construir a sessão
- [x] 3.2 Logar o código recebido via evento `pairing_code`, com uma mensagem equivalente à atual de "escaneie o QR code"
- [x] 3.3 Documentar `WA_PAIRING_NUMBER` em `.env.example` (formato esperado: dígitos com DDI, sem `+`/espaços)

## 4. Testes

- [x] 4.1 Adicionar `requestPairingCode` ao `FakeSocket` de `session.test.ts`
- [x] 4.2 Ajustar o `BaileysConnect` fake usado nos testes para retornar `registered` (parametrizável por teste)
- [x] 4.3 Teste: com `pairingNumber` definido e `registered: false`, a sessão chama `requestPairingCode` e emite `pairing_code` com o código retornado
- [x] 4.4 Teste: com `pairingNumber` definido e `registered: true` (reconexão de sessão já pareada), a sessão NÃO chama `requestPairingCode`
- [x] 4.5 Teste: sem `pairingNumber` definido, comportamento de QR permanece inalterado (regressão)

## 5. Validação manual

- [x] 5.1 Testar o fluxo ponta a ponta com um número real (número temporário da yesim.app). `browser` default do Baileys não precisou de override - a Open Question original não era a causa real. Dois bugs reais foram encontrados e corrigidos (ver design.md, decisões 6 e 7): (a) `requestPairingCode` chamado antes do WebSocket abrir (`Boom 428 Connection Closed`) - corrigido aguardando `sock.waitForSocketOpen()`; (b) reconexões automáticas pediam um código novo a cada ~5s, invalidando o anterior - corrigido com a guarda `pairingCodeRequested`. Após as correções, o código é gerado de forma confiável (confirmado por múltiplas execuções reais, sem exceções, sem repetição). O passo final de digitar o código no WhatsApp do número da yesim para chegar a `ready` depende de ação humana e não foi executado por mim.
