## 1. Webhook schema

- [x] 1.1 In `src/whatsapp-connectivity/infrastructure/webhook/webhook-event.schema.ts`, add an optional `button: z.object({ text: z.string(), payload: z.string().optional() }).optional()` field to `webhookMessageSchema`, alongside the existing `text` field.

## 2. Use case

- [x] 2.1 In `src/whatsapp-connectivity/application/use-cases/handle-inbound-message.use-case.ts`, add `button?: { text: string; payload?: string }` to the `RawInboundMessage` interface.
- [x] 2.2 Update `HandleInboundMessageUseCase.execute` to accept both `type: "text"` (using `raw.text.body`) and `type: "button"` (using `raw.button.text`) as the source of the message's text content; any other type (or a missing `text`/`button` payload for the declared type) keeps logging `"Mensagem inbound de tipo não suportado ignorada"` and returning early, unchanged.
- [x] 2.3 Verify `InboundMessage.create`, `inboundMessagePort.receive`, and the info/error log calls need no changes — they already operate on the resolved `text` string regardless of source.

## 3. Tests

- [x] 3.1 In `handle-inbound-message.use-case.test.ts`, add a test: a `type: "button"` raw message with `button: { text, payload }` produces the same `InboundMessage`/port call as an equivalent `type: "text"` message.
- [x] 3.2 Add a test for a `type: "button"` raw message missing `button` (or with empty `button.text`): logs the unsupported-type warning and does not call the port, mirroring existing text-missing coverage.
- [x] 3.3 Confirm the existing "tipo ainda não suportado" test keeps using a genuinely unsupported type (e.g. `image`) now that `button` is supported — update its description/comment if it currently implies `button` would also be dropped.

## 4. Manual verification

- [x] 4.1 Trigger the real flow end-to-end: send the prospecting opening template to a test number, tap the "Tenho interesse em saber mais" button, and confirm the server logs `"Mensagem inbound recebida"` (not the unsupported-type warning) and the conversation engine receives the button's text.
- [x] 4.2 Confirm the lead's `ProspectingReplyTracker` status advances from `sent` to `replied` after the tap, with no code changes needed there.
