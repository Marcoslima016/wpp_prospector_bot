import { createHmac, timingSafeEqual } from "node:crypto";

/** Conteúdo assinado do cookie de sessão. */
export interface SessionPayload {
  /** Instante de emissão (epoch ms). */
  iat: number;
  /** Instante de expiração (epoch ms). */
  exp: number;
}

export type VerifyResult =
  | { status: "ok"; payload: SessionPayload }
  | { status: "invalid-signature" }
  | { status: "expired" };

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/** Comparação de strings resistente a timing (mesmo comprimento → tempo constante). */
export function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Emite o valor do cookie de sessão: `payload.hmac`, onde `payload` é
 * base64url(`{ iat, exp }`) e `hmac` = HMAC-SHA256(payload, secret). Sem store —
 * a sessão é stateless e cabe em um único operador.
 */
export function issue(now: Date, ttlMs: number, secret: string): string {
  const iat = now.getTime();
  const payload: SessionPayload = { iat, exp: iat + ttlMs };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Confere assinatura e expiração. `invalid-signature` cobre também formato
 * inválido e payload corrompido. Trocar `secret` faz todo token antigo cair em
 * `invalid-signature`.
 */
export function verify(token: string, now: Date, secret: string): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 2) return { status: "invalid-signature" };

  const payloadB64 = parts[0];
  const providedHmac = parts[1];
  if (payloadB64 === undefined || providedHmac === undefined || payloadB64 === "") {
    return { status: "invalid-signature" };
  }

  if (!constantTimeEquals(providedHmac, sign(payloadB64, secret))) {
    return { status: "invalid-signature" };
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return { status: "invalid-signature" };
  }

  if (
    payload === null ||
    typeof payload !== "object" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return { status: "invalid-signature" };
  }

  if (now.getTime() >= payload.exp) return { status: "expired" };

  return { status: "ok", payload };
}
