## Why

The prospecting opening message is sent as an approved WhatsApp **template** with a quick-reply button ("Tenho interesse em saber mais"). When a lead taps it, Meta's Cloud API sends an inbound webhook message with `type: "button"` (carrying `button.text`/`button.payload`) — not `type: "text"`. The inbound pipeline currently recognizes only `type: "text"` at every layer (webhook schema, `RawInboundMessage`, `HandleInboundMessageUseCase`), so every button tap is logged as `"Mensagem inbound de tipo não suportado ignorada"` and silently dropped. This breaks the core prospecting loop: a lead expressing interest never reaches the conversation engine, never gets a reply, and never gets promoted from `sent` to `replied` by `ProspectingReplyTracker`.

## What Changes

- Extend the inbound webhook schema to capture the `button` payload shape (`button.text`, `button.payload`) alongside the existing `text` shape.
- Extend `HandleInboundMessageUseCase` (and `RawInboundMessage`) to accept `type: "button"` messages and map `button.text` into the same inbound-text path already used for `type: "text"`, so `InboundMessage`, `InboundMessagePort`, `InboundBatchCoordinator`, and the conversation engine require no changes downstream.
- Update the `whatsapp-connectivity` spec's "Recebimento de Mensagem Inbound" requirement with a new scenario covering template quick-reply button taps.
- Out of scope: general WhatsApp **interactive** message support (`type: "interactive"`, `button_reply`). Nothing in this codebase sends interactive messages today (only templates and session text), so there is no inbound `interactive` payload to handle yet. Revisit if/when outbound interactive sends are introduced.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `whatsapp-connectivity`: "Recebimento de Mensagem Inbound" gains a scenario for inbound `type: "button"` messages produced by a template quick-reply tap, extracting `button.text` the same way `text.body` is extracted today.

## Impact

- `src/whatsapp-connectivity/infrastructure/webhook/webhook-event.schema.ts` — add optional `button: { text, payload }` field to `webhookMessageSchema`.
- `src/whatsapp-connectivity/application/use-cases/handle-inbound-message.use-case.ts` — extend the type guard and `RawInboundMessage` to accept `"button"`, extracting `button.text` in place of `text.body`.
- `src/whatsapp-connectivity/application/use-cases/handle-inbound-message.use-case.test.ts` — add coverage for the button-tap path; the existing "unsupported type" test should switch its example away from a type this change now supports (e.g. keep `"image"` as the still-unsupported case).
- `openspec/specs/whatsapp-connectivity/spec.md` — new scenario under "Recebimento de Mensagem Inbound".
- No changes expected to `InboundMessage` (domain), `InboundMessagePort`, `InboundBatchCoordinator`, or `ProspectingReplyTracker` — they are content-shape agnostic once a `text` value is produced.
