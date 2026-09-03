import type { MessagingCostRecorderPort } from "../../application/ports/messaging-cost-recorder.port.ts";

/**
 * `MessagingCostRecorderPort` que não faz nada — injetado quando o registro está
 * desligado (`WHATSAPP_COST_TRACKING_ENABLED=false`). Mantém a use-case de
 * status sem ramo condicional.
 */
export class NoopMessagingCostRecorder implements MessagingCostRecorderPort {
  recordConversationEvent(): Promise<void> {
    return Promise.resolve();
  }
}
