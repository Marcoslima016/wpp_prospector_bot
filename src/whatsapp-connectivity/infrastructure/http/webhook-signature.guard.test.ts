import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isValidWebhookSignature } from "./webhook-signature.guard.ts";

const appSecret = "test-app-secret";

function signatureFor(rawBody: Buffer): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

describe("isValidWebhookSignature", () => {
  it("aceita uma assinatura válida para o corpo da requisição", () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: "world" }));

    expect(
      isValidWebhookSignature({ rawBody, signatureHeader: signatureFor(rawBody), appSecret }),
    ).toBe(true);
  });

  it("rejeita quando a assinatura não corresponde ao corpo", () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: "world" }));
    const tamperedBody = Buffer.from(JSON.stringify({ hello: "tampered" }));

    expect(
      isValidWebhookSignature({
        rawBody: tamperedBody,
        signatureHeader: signatureFor(rawBody),
        appSecret,
      }),
    ).toBe(false);
  });

  it("rejeita quando a assinatura está ausente", () => {
    const rawBody = Buffer.from(JSON.stringify({ hello: "world" }));

    expect(isValidWebhookSignature({ rawBody, signatureHeader: undefined, appSecret })).toBe(false);
  });
});
