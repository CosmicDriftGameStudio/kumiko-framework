import { describe, expect, test } from "bun:test";
import { Temporal } from "temporal-polyfill";
import { signMfaPreauthSetupToken, verifyMfaPreauthSetupToken } from "../mfa-preauth-setup-token";

const SECRET = "test-mfa-preauth-setup-secret-at-least-32-bytes!!";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";

describe("mfa-preauth-setup-token", () => {
  test("round-trip: sign → verify → payload", () => {
    const { token } = signMfaPreauthSetupToken(
      { userId: USER_ID, tenantId: TENANT_ID },
      10,
      SECRET,
    );
    const result = verifyMfaPreauthSetupToken(token, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual({ userId: USER_ID, tenantId: TENANT_ID });
    }
  });

  test("cross-domain replay from a challenge-shaped signature is rejected", () => {
    const { token } = signMfaPreauthSetupToken(
      { userId: USER_ID, tenantId: TENANT_ID },
      10,
      SECRET,
    );
    const [bodyB64] = token.split(".");
    const forged = `${bodyB64}.${Buffer.from("not-the-real-signature-bytes").toString("base64url")}`;
    expect(verifyMfaPreauthSetupToken(forged, SECRET)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  test("tampered signature → bad_signature", () => {
    const { token } = signMfaPreauthSetupToken(
      { userId: USER_ID, tenantId: TENANT_ID },
      10,
      SECRET,
    );
    const tampered = `${token.slice(0, -3)}XXX`;
    expect(verifyMfaPreauthSetupToken(tampered, SECRET)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  test("different secret → bad_signature", () => {
    const { token } = signMfaPreauthSetupToken(
      { userId: USER_ID, tenantId: TENANT_ID },
      10,
      SECRET,
    );
    expect(verifyMfaPreauthSetupToken(token, "other-secret-not-the-same-one!!!!")).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  test("expired → expired", () => {
    const t0 = Temporal.Instant.fromEpochMilliseconds(1_700_000_000_000);
    const laterThanTtl = t0.add({ minutes: 11 });
    const { token } = signMfaPreauthSetupToken(
      { userId: USER_ID, tenantId: TENANT_ID },
      10,
      SECRET,
      t0,
    );
    expect(verifyMfaPreauthSetupToken(token, SECRET, laterThanTtl)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  test("malformed: wrong part count", () => {
    expect(verifyMfaPreauthSetupToken("not-a-token", SECRET)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyMfaPreauthSetupToken("a.b.c", SECRET)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
