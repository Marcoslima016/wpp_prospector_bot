## Why

As capabilities `whatsapp-connectivity` e `anti-ban-warmup` já foram implementadas e testadas isoladamente, mas nunca conectadas: `SessionManager`, `WarmupSchedule`/`WarmupTracker`, `SendQueue` e `DailyVolumeLimiter` existem como peças independentes, e `src/index.ts` continua sendo um placeholder que não faz nada. Sem essa ligação, nenhum requisito já especificado (rampa de aquecimento, teto diário, envio real) roda de fato — e não há como testar manualmente o pareamento real de um número via QR code.

## What Changes

- Adicionar uma nova classe `PerSessionWarmupGate`, que aplica por número o volume permitido calculado por `WarmupSchedule`/`WarmupTracker` (hoje um cálculo isolado, nunca consultado antes de um envio).
- Generalizar `SendQueue` para aceitar múltiplos "gates" de capacidade (em vez de um único `dailyLimiter`), permitindo compor o teto por sessão (`PerSessionWarmupGate`) com o teto global (`DailyVolumeLimiter`) na mesma fila, sem descartar mensagens — apenas adiando quando qualquer um dos dois está saturado.
- Ligar `SessionManager` ao `WarmupTracker`: ao uma sessão atingir o estado `ready` pela primeira vez, registrar a ativação (início da contagem da rampa de aquecimento).
- Reescrever `src/index.ts` como um CLI mínimo: pareia um número configurado, aguarda ficar pronto, e aceita um comando simples para enfileirar uma mensagem de teste — o suficiente para validar manualmente pareamento via QR, rampa, jitter e teto diário funcionando juntos. **Não** inclui importação de leads, campanhas ou API HTTP (fora do escopo — RF-01/RF-02 do PRD ainda não existem).

## Capabilities

### New Capabilities
_Nenhuma._

### Modified Capabilities
_Nenhuma — os requisitos de `whatsapp-connectivity` e `anti-ban-warmup` já descrevem esse comportamento no nível de sistema (ver `openspec/specs/anti-ban-warmup/spec.md`, requisitos "Gradual warmup ramp for new numbers" e "Daily volume ceiling enforcement"). Este change apenas termina de implementar o que já estava especificado — não introduz nem altera contrato de comportamento observável. `skip_specs: true` está declarado em `.openspec.yaml`._

## Impact

- **Código:** `src/outbound/sendQueue.ts` (mudança de forma na API — `dailyLimiter` singular vira uma lista de gates; também passa a tolerar falha de envio sem derrubar o processo), novo `src/warmup/perSessionWarmupGate.ts`, `src/whatsapp/sessionManager.ts` (hook no evento `ready`), `src/whatsapp/session.ts` (`sendMessage` resolve o ID real via `getNumberId` antes de enviar — bug encontrado no QA manual), `src/index.ts` (reescrito).
- **Sem mudança de dependências externas.**
- **Sem mudança de especificação** — apenas implementação de comportamento já contratado.
