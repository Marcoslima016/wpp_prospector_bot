import { describe, expect, it } from "vitest";
import { issue, verify } from "./session-token.ts";

const SECRET = "server-session-secret";
const TTL = 12 * 60 * 60 * 1000;
const t0 = new Date("2026-09-02T12:00:00.000Z");

describe("session-token", () => {
  it("round-trip issue → verify devolve ok com o payload", () => {
    const token = issue(t0, TTL, SECRET);
    const result = verify(token, t0, SECRET);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.payload.iat).toBe(t0.getTime());
      expect(result.payload.exp).toBe(t0.getTime() + TTL);
    }
  });

  it("assinatura adulterada → invalid-signature", () => {
    const token = issue(t0, TTL, SECRET);
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(verify(tampered, t0, SECRET).status).toBe("invalid-signature");
  });

  it("payload adulterado (sem re-assinar) → invalid-signature", () => {
    const token = issue(t0, TTL, SECRET);
    const forgedPayload = Buffer.from(JSON.stringify({ iat: 0, exp: 9e15 }), "utf8").toString(
      "base64url",
    );
    const forged = `${forgedPayload}.${token.split(".")[1]}`;

    expect(verify(forged, t0, SECRET).status).toBe("invalid-signature");
  });

  it("formato inválido → invalid-signature", () => {
    expect(verify("nope", t0, SECRET).status).toBe("invalid-signature");
    expect(verify("a.b.c", t0, SECRET).status).toBe("invalid-signature");
  });

  it("exp vencido → expired", () => {
    const token = issue(t0, TTL, SECRET);
    const later = new Date(t0.getTime() + TTL + 1);

    expect(verify(token, later, SECRET).status).toBe("expired");
  });

  it("troca de secret invalida um token emitido antes", () => {
    const token = issue(t0, TTL, SECRET);

    expect(verify(token, t0, "rotated-secret").status).toBe("invalid-signature");
  });
});
