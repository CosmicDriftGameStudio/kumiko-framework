import { createHmac, timingSafeEqual } from "node:crypto";
import { Temporal } from "temporal-polyfill";

function hmacSign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export type HmacTokenVerifyResult<TPayload> =
  | { readonly ok: true; readonly payload: TPayload; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

export function createHmacTokenCodec<
  TPayload extends { readonly userId: string; readonly tenantId: string },
>(domain: string, isPayload: (value: unknown) => value is TPayload) {
  type EncodedBody = TPayload & { readonly expiresAtMs: number };

  function isEncodedBody(value: unknown): value is EncodedBody {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Record<string, unknown>;
    return isPayload(v) && typeof v["expiresAtMs"] === "number";
  }

  return {
    sign(
      payload: TPayload,
      ttlMinutes: number,
      secret: string,
      now: Temporal.Instant = Temporal.Now.instant(),
    ): { token: string; expiresAt: Temporal.Instant } {
      const expiresAt = now.add({ minutes: ttlMinutes });
      const body: EncodedBody = { ...payload, expiresAtMs: expiresAt.epochMilliseconds };
      const bodyB64 = Buffer.from(JSON.stringify(body)).toString("base64url");
      const signature = hmacSign(`${domain}:${bodyB64}`, secret);
      return { token: `${bodyB64}.${signature}`, expiresAt };
    },

    verify(
      token: string,
      secret: string,
      now: Temporal.Instant = Temporal.Now.instant(),
    ): HmacTokenVerifyResult<TPayload> {
      const parts = token.split(".");
      if (parts.length !== 2) return { ok: false, reason: "malformed" };
      const [bodyB64, providedSig] = parts;
      if (!bodyB64 || !providedSig) return { ok: false, reason: "malformed" };

      const expected = hmacSign(`${domain}:${bodyB64}`, secret);
      const expectedBuf = Buffer.from(expected, "base64url");
      const providedBuf = Buffer.from(providedSig, "base64url");
      if (expectedBuf.length !== providedBuf.length) return { ok: false, reason: "bad_signature" };
      if (!timingSafeEqual(expectedBuf, providedBuf)) return { ok: false, reason: "bad_signature" };

      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8"));
      } catch {
        return { ok: false, reason: "malformed" };
      }
      if (!isEncodedBody(parsed)) return { ok: false, reason: "malformed" };

      if (
        Temporal.Instant.compare(now, Temporal.Instant.fromEpochMilliseconds(parsed.expiresAtMs)) >
        0
      ) {
        return { ok: false, reason: "expired" };
      }

      const { expiresAtMs, ...payload } = parsed;
      return { ok: true, payload, expiresAtMs };
    },
  };
}
