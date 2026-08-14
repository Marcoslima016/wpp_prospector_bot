## Context

See proposal.md - Why. No code exists yet in this project; this is the first architectural decision for the messaging engine. The product's definitive volume target is 100 disparos/dia (not an MVP-only figure — see proposal.md).

## Goals / Non-Goals

**Goals:**
- Pin the connection library and session model for the WhatsApp integration.
- Size the anti-ban/warmup engine for a 100 disparos/dia target, not a mass-scale target.
- Keep the architecture simple given the low concurrency need this target implies.

**Non-Goals:**
- Multi-number rotation as a load-bearing scaling mechanism — descoped for now; revisit only if the volume target changes upward.
- Dedicated proxy infrastructure per session — descoped for v1.
- Official WhatsApp Cloud API support — explicitly rejected in this change.

## Decisions

### Decision: whatsapp-web.js as the connection library
Chosen over Baileys, Evolution API, and WPPConnect.

Rationale: whatsapp-web.js's main drawback — one Chromium/Puppeteer process per session — is only a liability at high concurrency (dozens/hundreds of numbers). At this product's actual scale (a small number of concurrently connected sessions sustaining 100 disparos/dia), that overhead is a non-issue. In exchange, whatsapp-web.js offers a mature, well-documented API surface, trading some resource overhead for lower implementation complexity versus building directly on a lower-level protocol library.

Alternatives considered:
- **Baileys** (raw WebSocket protocol implementation, no browser): more resource-efficient at scale, but more implementation work to reach feature parity with what whatsapp-web.js provides out of the box. The efficiency advantage doesn't matter at this concurrency level.
- **Evolution API / WPPConnect** (Baileys-based wrappers with REST/webhook layers): would reduce integration work further, but add an extra service/dependency to operate for no scale benefit at this volume. Worth revisiting if the platform later needs to manage many more concurrent numbers.

### Decision: single / few concurrent session model
Given the 100 disparos/dia target, the operation is sized for one or a handful of concurrently connected numbers, not a large pool. Instance orchestration stays minimal — no dedicated worker-pool/queue-based session orchestrator is needed; a small number of long-running session processes is sufficient.

### Decision: warmup ramp is per-number, but the daily ceiling is platform-wide
Each connected number ramps up its own send volume gradually from pairing (see `anti-ban-warmup` spec), but the hard daily ceiling of 100 disparos/dia is enforced across the whole platform, not per number individually. This keeps the product's volume promise invariant even as the number of connected numbers changes.

## Risks / Trade-offs

- [Risk] whatsapp-web.js depends on WhatsApp Web's client behavior, which Meta can change without notice, potentially breaking the connection layer. → [Mitigation] Pin dependency versions, monitor the upstream project's activity/releases, budget maintenance time for updates.
- [Risk] Automating a personal-style WhatsApp session is a ToS violation and carries residual ban risk even at low volume. → [Mitigation] The `anti-ban-warmup` capability (jitter, presence simulation, daily ceiling) is the primary mitigation; skipping dedicated proxy infrastructure in v1 is an accepted trade-off given the small number of sessions involved (a much smaller anomaly surface than a datacenter running hundreds of sessions).
- [Risk] Descoping multi-number rotation means a single number's ban directly threatens the whole operation's ability to hit 100/dia. → [Mitigation] Accepted at this scale/target; if the target changes upward later, rotation should be reconsidered (see Non-Goals).
