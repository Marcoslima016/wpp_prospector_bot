export class WhatsAppApiError extends Error {
  readonly code?: string;

  constructor(message: string, options?: { code?: string; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "WhatsAppApiError";
    this.code = options?.code;
  }
}
