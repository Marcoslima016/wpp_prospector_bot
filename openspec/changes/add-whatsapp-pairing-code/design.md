## Context

`WhatsAppSession` (`src/whatsapp/session.ts`) hoje só sabe pairing via QR: `registerEventHandlers` escuta `connection.update` e reage ao campo `qr` quando o Baileys o emite espontaneamente (ver proposal.md - Why). Dois detalhes do código atual moldam esta decisão:

- `BaileysConnect`/`BaileysSocketLike` (`session.ts:51-66`) formam um seam de teste deliberadamente estreito — um `Pick<WASocket, ...>` — que permite ao `FakeSocket` de `session.test.ts` simular um socket real sem implementar a API inteira do Baileys.
- `defaultConnect` (`session.ts:74-83`) carrega `useMultiFileAuthState` e descarta `state` depois de construir o socket; só `sock`/`saveCreds` saem dessa função.

Pairing code é um fluxo ativo (`sock.requestPairingCode(numero)`), não reativo como o QR, e só faz sentido pedir quando a sessão ainda não está registrada — daí a necessidade de expor esse estado para fora de `defaultConnect`.

## Goals / Non-Goals

**Goals:**
- Pairing code como alternativa ao QR, sem alterar o comportamento default (QR) quando não configurado.
- Manter o seam de teste estreito e determinístico — sem exigir que `FakeSocket` implemente a `WASocket` inteira.
- Não repetir a solicitação de pairing code em uma sessão já registrada que apenas reconecta.

**Non-Goals:**
- Suportar pairing code por sessão quando múltiplas sessões sobem no mesmo processo — hoje `index.ts` só inicializa uma sessão a partir de env vars no boot; isso não muda aqui.
- Código de pairing customizado (Baileys aceita um segundo argumento para isso) — sem caso de uso identificado.
- Qualquer normalização/validação sofisticada do número (ex.: aceitar `+55 11...` e normalizar) — a variável de ambiente espera o formato que o Baileys exige (dígitos, com DDI, sem `+`/espaços), documentado no `.env.example`.

## Decisions

### 1. `BaileysConnect` passa a retornar `registered: boolean`
`defaultConnect` já tem acesso a `state.creds.registered` antes de descartar `state`. Em vez de expor o `state` inteiro (o que vazaria detalhes internos do Baileys pro resto de `WhatsAppSession`), o retorno de `BaileysConnect` ganha um terceiro campo:

```ts
export type BaileysConnect = (authDataPath: string) => Promise<{
  sock: BaileysSocketLike;
  saveCreds: () => Promise<void>;
  registered: boolean;
}>;
```

`connectSocket()` usa esse campo para decidir se chama `requestPairingCode`. Alternativa considerada: expor `sock.authState.creds.registered` via `BaileysSocketLike`. Rejeitada porque acopla o seam de teste a mais uma estrutura aninhada do `WASocket` real (`authState.creds`), quando um booleano simples já resolve.

### 2. `BaileysSocketLike` ganha `requestPairingCode`
Ampliar o `Pick<WASocket, ...>` existente com `'requestPairingCode'`. `FakeSocket` em `session.test.ts` ganha um método correspondente (retorna um código fixo nos testes), preservando o padrão já usado para os outros métodos do fake.

### 3. Opt-in via env var `WA_PAIRING_NUMBER`, lida em `index.ts`
Segue o padrão já estabelecido por `SESSION_ID`/`ANTHROPIC_API_KEY` (var opcional simples, sem parsing) e a spec `app-configuration` (nenhuma requirement lá muda — a var é só mais uma leitura opcional de `process.env`, comportamento já coberto genericamente). Passada para `WhatsAppSession` via `WhatsAppSessionOptions` (novo campo `pairingNumber?: string`).

Alternativa considerada: reaproveitar `SESSION_ID` como o número de telefone (a mensagem de erro em `index.ts:31` já sugeria isso). Rejeitada — `SESSION_ID` nomeia a pasta de credenciais (`.baileys_auth/<sessionId>`), um conceito diferente de "número real formatado para o Baileys"; misturar os dois impede, por exemplo, nomear sessões de forma não numérica.

### 4. Novo evento `pairing_code` em `WhatsAppSessionEvents`
Espelha o `qr` existente (`qr: [qr: string]` → `pairing_code: [code: string]`). `connectSocket()` chama `requestPairingCode` logo após criar o socket (quando `pairingNumber` está definido e `registered` é `false`) e emite o evento com o código retornado. `index.ts` loga esse código do mesmo jeito que hoje loga a instrução de escanear o QR.

### 5. Guarda contra repetição em reconexões
`connectSocket()` só chama `requestPairingCode` quando `registered === false`. Em reconexões (`scheduleReconnect` → `connectSocket`) de uma sessão já pareada, `registered` vem `true` do `defaultConnect` (credenciais já persistidas em disco) e o código não é solicitado de novo — mesmo comportamento que o QR já tem hoje (o Baileys não emite mais `qr` uma vez registrado).

### 6. Esperar `sock.waitForSocketOpen()` antes de `requestPairingCode`
Descoberto ao testar com um número real (ver Risks/Trade-offs): `requestPairingCode()` envia uma stanza imediatamente e o Baileys lança `Boom('Connection Closed', { statusCode: 428 })` se o WebSocket ainda não terminou o handshake (`ws.isOpen === false`), o que é o caso logo após `makeWASocket()` retornar. `WASocket` já expõe `waitForSocketOpen(): Promise<void>` publicamente (`node_modules/baileys/lib/Socket/socket.d.ts:30`) - `connectSocket()` aguarda essa promise antes de chamar `requestPairingCode`. `BaileysSocketLike` ganhou esse método no `Pick`.

### 7. Solicitar o pairing code no máximo uma vez por sessão não pareada
Também descoberto testando com um número real: o WhatsApp fecha o socket logo depois de emitir um pairing code (comportamento normal do protocolo, não um erro), o que disparava o `scheduleReconnect` já existente - e cada reconexão chamava `requestPairingCode` de novo, gerando um código novo (invalidando o anterior) a cada ~5s. Um novo campo `pairingCodeRequested: boolean` na instância marca que o código já foi pedido; `connectSocket()` só chama `requestPairingCode` quando `pairingNumber && !registered && !pairingCodeRequested`. O código pedido na primeira tentativa continua válido durante as reconexões seguintes - é assim que o operador consegue digitá-lo no WhatsApp enquanto o Baileys reconecta em segundo plano.

### 8. Diagnóstico de desconexão visível no terminal por padrão
Depois da rodada de troubleshooting acima, ficou claro que descobrir a causa de uma desconexão (`statusCode`, mensagem, e o payload cru que o WhatsApp manda, ex.: `{"reason":"401","location":"atn"}`) exigia adicionar `console.error` manualmente toda vez. Isso virou parte permanente da implementação: `describeDisconnect()` monta essa string a partir do `Boom` de `lastDisconnect.error`, o evento `disconnected` (que já existia, mas ninguém escutava) passa a carregar essa descrição rica em vez de só o código numérico, e `index.ts` escuta esse evento (no mesmo callback `onSessionCreated` do `pairing_code`, pelo mesmo motivo de timing) e imprime com `console.error`. Vale tanto pro fluxo de QR quanto pairing code, já que a causa (rejeição do servidor) não é exclusiva de nenhum dos dois.

### 9. `registered` combina `creds.registered` com `creds.account`, não só o primeiro
Depois que um pareamento via QR finalmente teve sucesso (confirmado por artefatos que só existem após um `CB:success` completo - pré-chaves enviadas, `app-state-sync-key-*`, arquivo de sessão criptográfica com o número), o `creds.json` dessa sessão continuava com `registered: false`. Investigando o código-fonte do Baileys: `creds.registered = true` só é setado dentro do fluxo de **pairing code** (`messages-recv.js`, stage `companion_finish`); o handler de sucesso do **QR** (`configureSuccessfulPairing`, em `validate-connection.js`, chamado a partir de `CB:iq,,pair-success` em `socket.js`) nunca escreve `registered`, só `account`/`me`/`signalIdentities`/`platform`. Ou seja, `creds.registered` sozinho é um sinal confiável só pra sessões pareadas via pairing code - fica `false` pra sempre em sessões pareadas via QR, mesmo com o vínculo 100% funcional.

Isso importava porque `defaultConnect` usava só `state.creds.registered` pra decidir o campo `registered` que `connectSocket()` usa pra não pedir um pairing code de novo em sessões já pareadas. Uma sessão pareada via QR e reiniciada depois com `pairingNumber` definido (ex.: usuário escolhe "2) pairing code" no menu numa sessão que já foi pareada via QR) pediria um pairing code desnecessário. Corrigido calculando `registered` como `Boolean(state.creds.registered) || Boolean(state.creds.account)` - cobre os dois métodos, já que cada um só popula um dos dois campos de forma confiável.

### 10. Menu interativo de método de pareamento, em vez de decidir por env var sozinha
`WA_PAIRING_NUMBER` definida-ou-não deixou de ser o único jeito de escolher QR vs. pairing code - alternar entre os dois exigia editar o `.env` a cada troca, o que ficou repetitivo durante o troubleshooting real com o usuário. `index.ts` ganhou um prompt (`readline`) no início de `main()`, perguntando "1) QR Code / 2) Código de pareamento"; a resposta "2" usa `WA_PAIRING_NUMBER` do `.env` como valor padrão, ou pergunta o número interativamente se a variável não estiver definida. A interface `readline` criada pra esse prompt é a mesma reaproveitada depois para a fila de mensagens de teste (`rl.on('line', ...)`), evitando duas interfaces concorrentes no mesmo `stdin`.

Efeito colateral necessário: `SessionManager.addSession` precisou ganhar um parâmetro `options` (repassado ao construtor de `WhatsAppSession`) e um callback `onSessionCreated`, chamado de forma síncrona logo após a sessão ser criada e registrada no mapa interno, mas antes de `start()` ser aguardado - sem isso, `index.ts` não teria como anexar os listeners de `pairing_code`/`disconnected` a tempo de capturar eventos que podem disparar muito cedo dentro do próprio `start()`.

### 11. `defaultConnect` limpa `creds.me` obsoleto quando a sessão ainda não pareou
A causa raiz do `<failure reason="401">` que aparecia consistentemente ao reconectar durante o fluxo de pairing code (ver Risks/Trade-offs para o histórico completo da investigação): `requestPairingCode()` seta `creds.me` de forma especulativa, antes do pareamento realmente ter sucesso, e isso é persistido em disco via `creds.update`. O handshake do Baileys (`validateConnection()`, em `socket.js`) decide entre enviar um node de **registro** (`generateRegistrationNode`, quando `!creds.me`) ou de **login** (`generateLoginNode`, quando `creds.me` já existe) logo na abertura do socket. Como o WhatsApp fecha a conexão pouco depois de emitir um pairing code (ver decisão 7) e nosso `scheduleReconnect` reconecta usando o `creds.me` já persistido da tentativa anterior, a reconexão enviava incorretamente um node de **login** para um dispositivo que nunca terminou de se registrar - e o servidor rejeitava com `401`.

Corrigido em `defaultConnect`: quando `!registered` (nem `creds.registered` nem `creds.account` indicam pareamento concluído) e `state.creds.me` está presente, ele é apagado antes de `makeWASocket()` ser chamado - forçando toda reconexão dentro do fluxo de pairing code a repetir o handshake de registro (igual ao que o QR já faz naturalmente, já que QR nunca seta `creds.me` antes do sucesso). Isso elimina o `401` de forma reproduzível (confirmado ao vivo, reconectando a mesma sessão que antes falhava).

## Risks / Trade-offs

- **[Trade-off] `registered` como booleano solto em vez de um objeto de estado mais rico** — suficiente para a única decisão que `WhatsAppSession` precisa tomar hoje (pedir ou não pairing code). Se no futuro surgir mais lógica dependente de estado de credenciais, pode exigir revisão do formato de retorno de `BaileysConnect`.

- **[Histórico da investigação do `401`] O diagnóstico evoluiu bastante ao longo do troubleshooting real com o usuário - registrado aqui porque a conclusão inicial estava errada e vale não repetir os mesmos passos no futuro:**
  1. Observação inicial: a sessão emite o pairing code normalmente, mas segundos depois o servidor fecha a conexão (`statusCode: 428`, "Connection Terminated"); na reconexão automática seguinte, o servidor rejeitava de cara com `<failure reason="401" location="atn">` (`data: {"reason":"401","location":"atn"}`). Como `401` mapeia para `DisconnectReason.loggedOut` no Baileys, a sessão tratava isso como definitivo e parava de reconectar - o processo Node.js encerrava sozinho por falta de handles/timers pendentes (não é crash; no VS Code aparece como "Press any key to close the terminal").
  2. Hipótese descartada - **número específico bloqueado**: reproduzido de forma idêntica com dois números diferentes (o temporário da yesim e um número pessoal confirmado não bloqueado pela Meta).
  3. Hipótese descartada - **IP/rede bloqueado**: o mesmo `401` acontecia também no fluxo de QR code (antes de o QR nunca ter sido testado até o fim com sucesso) e persistia mesmo trocando de rede (Wi-Fi de casa e dados móveis do celular).
  4. Hipótese descartada - **identidade de dispositivo "queimada"**: persistia mesmo com um `SESSION_ID` totalmente novo (chaves criptográficas nunca usadas antes).
  5. Hipótese descartada - **versão do Baileys**: persistia idêntico em `6.7.24` (legacy) e `7.0.0-rc14` (a mais nova disponível).
  6. **Causa raiz real, encontrada**: QR finalmente foi testado até o fim e pareou com sucesso, no mesmo número/rede/máquina onde pairing code continuava falhando - isolando o problema pro código do pairing code especificamente, não pra rede/conta. Investigando o código-fonte do Baileys, a causa era o bug de `creds.me` obsoleto descrito na decisão 11 acima. **Esse bug foi corrigido e o `401` não ocorre mais.**

- **[Risco operacional, não de código - AINDA NÃO RESOLVIDO] Baileys fecha a conexão em nível de TCP ~200ms depois de `requestPairingCode()`, antes de qualquer chance de digitar o código** — depois da correção do `401` (decisão 11), o `428`/"Connection Terminated" inicial continua acontecendo, e é anterior ao bug do `creds.me` (não é causado por ele). Investigado com logging de timestamp em milissegundos: o WebSocket é derrubado (`TLSSocket.socketOnClose` → `WebSocket.emitClose`, fechamento de TCP puro, não uma resposta de protocolo do WhatsApp) cerca de 177ms depois de `requestPairingCode()` retornar o código - consistentemente, e **só** na conexão em que esse método é chamado (a reconexão seguinte, que não o chama de novo, fica estável). Isso é curto demais pra qualquer humano digitar o código a tempo.
  - Confirmado via busca externa: é um problema crônico, amplamente documentado em issues abertas do repositório oficial do Baileys (`WhiskeySockets/Baileys`) ao longo de vários anos (relatos de 2024 até fevereiro de 2026), com o mesmo padrão - QR funciona, pairing code fecha a conexão logo após `link_code_companion_reg`. Não é algo específico deste projeto nem corrigível no nosso código.
  - → Mitigação: nenhuma disponível no momento. QR é o caminho confiável neste ambiente. Pairing code pode voltar a ser viável se uma versão futura do Baileys corrigir isso - vale checar de novo periodicamente.

## Open Questions (resolvidas durante a implementação)

A suspeita original era que o identificador de `browser` default do Baileys pudesse ser rejeitado especificamente no fluxo de pairing code. Testando com um número real (`baileys@6.7.24`), essa não era a causa de nenhum dos problemas encontrados - vieram de timing/reconexão (decisões 6, 7 e 11) e de um bug crônico do próprio Baileys, sem relação com identidade de browser. Nenhum override de `browser` foi necessário.
