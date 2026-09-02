import type { UsageRecorderPort } from "../../application/ports/usage-recorder.port.ts";

/**
 * `UsageRecorderPort` que não faz nada — injetado quando o registro de consumo
 * está desligado (`LLM_USAGE_TRACKING_ENABLED=false`). Mantém os call sites sem
 * ramo condicional.
 */
export class NoopUsageRecorder implements UsageRecorderPort {
  recordLlmCall(): Promise<void> {
    return Promise.resolve();
  }
}
