## Context

See proposal.md - Why. The current inbound pipeline (webhook schema → `RawInboundMessage` → `HandleInboundMessageUseCase` → `InboundMessage` domain VO) recognizes only `type: "text"` with a `text.body` field. A template quick-reply tap arrives as `type: "button"` with a `button: { text, payload }` field, which today is stripped by the non-passthrough zod schema before the use case even sees it.

## Goals / Non-Goals

**Goals:**
- Recognize inbound `type: "button"` messages and extract `button.text`.
- Reuse the existing text-based pipeline downstream of the use case unchanged (`InboundMessage`, `InboundMessagePort`, `InboundBatchCoordinator`, conversation engine, `ProspectingReplyTracker`).
- Keep the "unsupported type" warning path intact for any type still not handled (e.g. `image`, `interactive`).

**Non-Goals:**
- Modeling `type: "interactive"` / `button_reply` payloads (no outbound interactive sends exist yet — see proposal.md).
- Giving `button.payload` any special semantic handling (e.g. intent routing). It is not extracted in this change; only `button.text` is.
- Changing anything about outbound template sending.

## Decisions

**Map `button.text` into the existing `text` field rather than introducing a distinct message-type concept.**
Alternative considered: introduce a `MessageType` enum / discriminated union across the whole pipeline (`InboundMessage`, port, coordinator) to model `text` vs `button` as distinct content shapes. Rejected for now — nothing downstream (conversation engine, reply tracker) currently needs to distinguish *how* a lead's text arrived, only that it did. Adding a new concept across four layers for a distinction nothing consumes would be premature; the narrower fix (accept `button` as an additional inbound source of `text`) fully resolves the reported failure with a much smaller surface area. If a future change needs to treat button taps differently (e.g., route on `button.payload`), that's the point to introduce the richer model — YAGNI today.

**Add `button` as an optional field on the existing zod object schema, matching how `text` is already modeled.**
`webhookMessageSchema` stays a plain (non-passthrough) `z.object()` with `text` and `button` both optional; `type` continues to discriminate which one is populated. This mirrors the current pattern instead of switching to `.passthrough()`/`looseObject()`, which would let arbitrary future Meta payload shapes flow through unvalidated.

**`RawInboundMessage.type` gains `"button"` as a recognized literal alongside `"text"`; the use case's guard becomes `(raw.type === "text" && raw.text) || (raw.type === "button" && raw.button)`, extracting the respective text value.**
Keeps a single use case and single downstream construction of `InboundMessage`, just with two accepted input shapes instead of one.

**A button tap with an empty/missing `button.text` is treated as unsupported and logged/dropped**, the same as today's guard on missing `text.body` — no new empty-string edge case handling is introduced.

## Risks / Trade-offs

- [Meta template button label changes without a corresponding conversation-engine update] → Not mitigated here; `button.text` flows into the LLM reasoning layer exactly as free-form text would, so it degrades gracefully (worst case, an unexpected label is treated as unrecognized lead input) rather than erroring.
- [Future need to distinguish button taps from typed text for analytics or routing] → Deferred by design (see Non-Goals); revisit by introducing a discriminated message-type model if/when a concrete downstream consumer needs it.

## Migration Plan

No data migration. This is a backward-compatible additive change to the webhook schema and use case; existing `type: "text"` handling is untouched. Deploy as a normal release; no rollback concerns beyond reverting the commit if the new scenario misbehaves.
