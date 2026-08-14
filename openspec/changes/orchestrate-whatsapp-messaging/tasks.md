## 1. Gate por sessão (rampa de aquecimento aplicada)

- [x] 1.1 Criar `src/warmup/perSessionWarmupGate.ts`: classe `PerSessionWarmupGate` com `hasCapacity()`, `recordSend()`, `msUntilReset()`, usando `WarmupSchedule` + `WarmupTracker` para calcular o limite do dia dinamicamente (recalculado a cada chamada, não fixo na construção)
- [x] 1.2 Testes automatizados de `PerSessionWarmupGate` (dia 0 limita a fração inicial, dia >= warmupDays libera o alotamento pleno, persiste contagem entre reinícios, reseta na virada do dia)

## 2. Generalizar a fila de envio

- [x] 2.1 Introduzir a interface `VolumeGate` (`hasCapacity()`, `recordSend()`, `msUntilReset()`) em `src/outbound/sendQueue.ts`
- [x] 2.2 Trocar a opção `dailyLimiter?: DailyVolumeLimiter` de `SendQueue` por `gates?: VolumeGate[]`; o loop de processamento passa a checar todos os gates antes de desenfileirar e chamar `recordSend()` em todos após um envio bem-sucedido
- [x] 2.3 Atualizar/estender os testes existentes de `SendQueue` para cobrir múltiplos gates (um saturado segura a fila; todos com capacidade permite o envio)
- [x] 2.4 Tratar falha de envio em `SendQueue.processQueue()`: capturar erro de `send()`, logar e seguir para a próxima mensagem sem derrubar o processo, sem chamar `recordSend()` para a mensagem que falhou (descoberto durante o QA manual da task 5.2)

## 3. Ligar ativação da rampa ao ciclo de vida da sessão

- [x] 3.1 `SessionManager` (ou o orquestrador em `index.ts`) escuta o evento `ready` de cada `WhatsAppSession` e chama `warmupTracker.recordActivation(sessionId)`

## 4. CLI mínimo em `index.ts`

- [x] 4.1 Reescrever `src/index.ts`: parear um número configurado (variável de ambiente `SESSION_ID`), aguardar o evento `ready`
- [x] 4.2 Montar, para essa sessão, uma `SendQueue` com os dois gates compostos (`PerSessionWarmupGate` da sessão + `DailyVolumeLimiter` global compartilhado) e `send` apontando para `WhatsAppSession.sendMessage`
- [x] 4.3 Aceitar uma linha simples via stdin (`<numeroDestino> <texto>`) para enfileirar uma mensagem de teste manualmente

## 5. Verificação

- [x] 5.1 Rodar a suíte automatizada completa (`npm test`) e confirmar que tudo passa após as mudanças de forma em `SendQueue`
- [x] 5.2a Corrigir `WhatsAppSession.sendMessage` para resolver o ID real via `client.getNumberId(to)` antes de `getChatById`/`sendMessage` (bug encontrado no QA manual: `getChatById` falhava mesmo para número já contato)
- [x] 5.2b Aplicar patch local (`patch-package`) no `whatsapp-web.js` para o bug conhecido `_serialized`/`$1` (issues #201838/#201845, PR #201871 — não publicado no npm ainda)
- [x] 5.2c Diagnosticar e confirmar (via QA manual real) que `getChatById` ainda falha sistemicamente para IDs `@lid`, mesmo com o patch — bloqueio externo à biblioteca, sem fix disponível no momento
- [ ] 5.2 QA manual: parear um número real via QR code pelo novo `index.ts`, confirmar que a sessão persiste após reiniciar o processo, e enviar uma mensagem de teste pelo stdin — **bloqueado** pelo bug `@lid` do `whatsapp-web.js` (ver design.md); pareamento e persistência de sessão já confirmados, envio de mensagem real ainda não. Também fecha a verificação pendente da task 4.1 do change `define-whatsapp-connection-strategy` (arquivado)
