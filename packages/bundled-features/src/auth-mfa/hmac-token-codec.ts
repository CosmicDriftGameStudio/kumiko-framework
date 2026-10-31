import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { hmacSignatureMatches, signHmacSha256Base64Url } from "../shared/hmac-signature.ts";

export type HmacTokenVerifyResult<TPayload> =
  | { readonly ok: true; readonly payload: TPayload; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

export type UserTenantPayload = { readonly userId: string; readonly tenantId: TenantId };

export function isUserTenantPayload(value: unknown): value is UserTenantPayload {
  if (!isPlainObject(value)) return false;
  return typeof value["userId"] === "string" && typeof value["tenantId"] === "string";
}

// `domain` is part of the signed input: it is the only thing that stops a token
// minted for one MFA step from verifying as another (e.g. a preauth-setup token
// replayed as a challenge token), since both share the same secret and payload shape.
export function createHmacTokenCodec<TPayload extends { readonly userId: string }>(
  domain: string,
  isPayload: (value: unknown) => value is TPayload,
) {
  type EncodedBody = TPayload & { readonly expiresAtMs: number };

  function splitEncodedBody(
    value: unknown,
  ): { readonly payload: TPayload; readonly expiresAtMs: number } | null {
    if (!isPlainObject(value)) return null;
    const expiresAtMs = value["expiresAtMs"];
    if (typeof expiresAtMs !== "number") return null;
    const { expiresAtMs: _drop, ...rest } = value;
    return isPayload(rest) ? { payload: rest, expiresAtMs } : null;
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
      const signature = signHmacSha256Base64Url(`${domain}:${bodyB64}`, secret);
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

      const expected = signHmacSha256Base64Url(`${domain}:${bodyB64}`, secret);
      if (!hmacSignatureMatches(expected, providedSig))
        return { ok: false, reason: "bad_signature" };

      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8"));
      } catch {
        return { ok: false, reason: "malformed" };
      }
      const body = splitEncodedBody(parsed);
      if (!body) return { ok: false, reason: "malformed" };

      if (
        Temporal.Instant.compare(now, Temporal.Instant.fromEpochMilliseconds(body.expiresAtMs)) > 0
      ) {
        return { ok: false, reason: "expired" };
      }

      return { ok: true, payload: body.payload, expiresAtMs: body.expiresAtMs };
    },
  };
}
