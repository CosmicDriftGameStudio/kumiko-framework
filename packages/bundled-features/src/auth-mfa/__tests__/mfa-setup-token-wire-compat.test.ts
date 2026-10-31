import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { signHmacSha256Base64Url } from "../../shared/index.ts";
import { signMfaChallengeToken } from "../mfa-challenge-token.ts";
import { signMfaSetupToken, verifyMfaSetupToken } from "../mfa-setup-token.ts";

const SECRET = "golden-mfa-setup-secret-0123456789abcdef";
const NOW = Temporal.Instant.from("2026-10-31T09:00:00Z");
const EXPIRES_AT_MS = 1793437800000;

const BASE_PAYLOAD = {
  userId: "user-golden-1",
  totpSecretBase32: "JBSWY3DPEHPK3PXP",
  recoveryCodeHashes: ["hash-a", "hash-b"],
};
const WITH_TENANT_PAYLOAD = { ...BASE_PAYLOAD, tenantId: "tenant-golden-1" };
const TENANT_ID = "tenant-golden-1";

const WITH_TENANT_TOKEN =
  "eyJ1c2VySWQiOiJ1c2VyLWdvbGRlbi0xIiwidG90cFNlY3JldEJhc2UzMiI6IkpCU1dZM0RQRUhQSzNQWFAiLCJyZWNvdmVyeUNvZGVIYXNoZXMiOlsiaGFzaC1hIiwiaGFzaC1iIl0sInRlbmFudElkIjoidGVuYW50LWdvbGRlbi0xIiwiZXhwaXJlc0F0TXMiOjE3OTM0Mzc4MDAwMDB9.1uFpZSQ5pckOXwKclhhQtxK8G5ri022GUY243N_Umpk";
const NO_TENANT_TOKEN =
  "eyJ1c2VySWQiOiJ1c2VyLWdvbGRlbi0xIiwidG90cFNlY3JldEJhc2UzMiI6IkpCU1dZM0RQRUhQSzNQWFAiLCJyZWNvdmVyeUNvZGVIYXNoZXMiOlsiaGFzaC1hIiwiaGFzaC1iIl0sImV4cGlyZXNBdE1zIjoxNzkzNDM3ODAwMDAwfQ.Ie5wtXlSCURzGSYJ9eg3tRc8N7R6phKJ9osiocYslkY";

function signRawSetupBody(body: unknown): string {
  const bodyB64 = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${bodyB64}.${signHmacSha256Base64Url(`mfa-setup:${bodyB64}`, SECRET)}`;
}

describe("mfa-setup-token wire compatibility", () => {
  test("verifies a token with tenantId minted by the previous implementation", () => {
    const result = verifyMfaSetupToken(WITH_TENANT_TOKEN, SECRET, NOW);
    expect(result).toEqual({ ok: true, payload: WITH_TENANT_PAYLOAD, expiresAtMs: EXPIRES_AT_MS });
  });

  test("verifies a token without tenantId minted by the previous implementation", () => {
    const result = verifyMfaSetupToken(NO_TENANT_TOKEN, SECRET, NOW);
    expect(result).toEqual({ ok: true, payload: BASE_PAYLOAD, expiresAtMs: EXPIRES_AT_MS });
    if (result.ok) expect("tenantId" in result.payload).toBe(false);
  });

  test("signing reproduces the previous tokens byte for byte", () => {
    expect(signMfaSetupToken(WITH_TENANT_PAYLOAD, 10, SECRET, NOW).token).toBe(WITH_TENANT_TOKEN);
    expect(signMfaSetupToken(BASE_PAYLOAD, 10, SECRET, NOW).token).toBe(NO_TENANT_TOKEN);
  });

  test("rejects the token after its ttl", () => {
    const later = NOW.add({ minutes: 11 });
    expect(verifyMfaSetupToken(WITH_TENANT_TOKEN, SECRET, later)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  test("a challenge token does not verify as a setup token", () => {
    const { token } = signMfaChallengeToken(
      { userId: "user-golden-1", tenantId: TENANT_ID },
      10,
      SECRET,
      NOW,
    );
    expect(verifyMfaSetupToken(token, SECRET, NOW)).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("a non-string recovery code hash is malformed", () => {
    const token = signRawSetupBody({
      ...BASE_PAYLOAD,
      recoveryCodeHashes: ["hash-a", 1],
      expiresAtMs: EXPIRES_AT_MS,
    });
    expect(verifyMfaSetupToken(token, SECRET, NOW)).toEqual({ ok: false, reason: "malformed" });
  });
});
