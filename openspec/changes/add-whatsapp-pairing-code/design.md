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

## Risks / Trade-offs

- **[Trade-off] `registered` como booleano solto em vez de um objeto de estado mais rico** — suficiente para a única decisão que `WhatsAppSession` precisa tomar hoje (pedir ou não pairing code). Se no futuro surgir mais lógica dependente de estado de credenciais, pode exigir revisão do formato de retorno de `BaileysConnect`.
- **[Risco operacional, não de código] WhatsApp rejeita a tentativa de pairing com `<failure reason="401" location="atn">`** — confirmado empiricamente em duas rodadas de teste (logs de debug temporários, depois removidos), com 2 dias de intervalo entre elas: a sessão emite o pairing code normalmente, mas segundos depois o servidor fecha a conexão (`statusCode: 428`, "Connection Terminated"); na reconexão automática seguinte (que dispara corretamente, dentro do delay esperado - não é bug na lógica de reconexão da decisão 5), o servidor rejeita de cara com uma stanza `<failure reason="401" location="atn">` (`statusCode: 401`, "Connection Failure", `data: {"reason":"401","location":"atn"}`). Como `401` mapeia para `DisconnectReason.loggedOut` no Baileys, a sessão trata isso como definitivo e para de tentar reconectar - o processo Node.js então encerra sozinho por falta de handles/timers pendentes (não é crash; no VS Code isso aparece como "Press any key to close the terminal" no painel da task).
  - Reproduzido de forma idêntica com dois números diferentes (o temporário da yesim e um número pessoal confirmado não bloqueado pela Meta), rodando da mesma máquina/rede - isso desloca a suspeita de "número/conta específica bloqueada" para "IP/rede de onde o bot roda malvista pelo WhatsApp" (comum em IPs de datacenter, VPN, ou faixas de operadora com reputação ruim por abuso de terceiros).
  - → Mitigação: nenhuma no código - é decisão do servidor do WhatsApp. Testar rodando de uma rede diferente (ex.: hotspot do celular) é o diagnóstico mais informativo disponível sem acesso a mais contexto do lado do WhatsApp.
  - Confirmado depois que o bloqueio **não é específico do pairing code**: o mesmo `<failure reason="401">` (`location` variando entre tentativas - "atn", "odn") acontece igual no fluxo de QR code (`WA_PAIRING_NUMBER` não definido), inclusive antes de o QR chegar a ser impresso. Ou seja, é uma rejeição geral do WhatsApp para qualquer tentativa de vincular um dispositivo novo a partir dessa rede - reforça a hipótese de IP/rede em vez de algo ligado ao protocolo de pairing code em si.

## Open Questions (resolvidas durante a implementação)

A suspeita original era que o identificador de `browser` default do Baileys pudesse ser rejeitado especificamente no fluxo de pairing code. Testando com um número real (`baileys@6.7.24`), essa não era a causa de nenhum dos dois problemas encontrados - ambos vieram de timing/reconexão (decisões 6 e 7 acima), não de identidade de browser. Nenhum override de `browser` foi necessário.
