import { Temporal } from "temporal-polyfill";
import { describe, expect, test } from "vitest";
import { signToken, TokenPurpose, verifyToken } from "../signed-token";

const SECRET = "test-hmac-secret-32-bytes-minimum!!";
const USER_ID = "11111111-1111-4111-8111-111111111111";

describe("signed-token", () => {
  test("round-trip: sign → verify (matching purpose) → userId", () => {
    const { token } = signToken(USER_ID, TokenPurpose.passwordReset, 15, SECRET);
    const result = verifyToken(token, TokenPurpose.passwordReset, SECRET);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.userId).toBe(USER_ID);
  });

  test("cross-purpose replay is rejected (reset token on verify endpoint)", () => {
    const { token } = signToken(USER_ID, TokenPurpose.passwordReset, 15, SECRET);
    const result = verifyToken(token, TokenPurpose.emailVerification, SECRET);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("tampered signature → bad_signature", () => {
    const { token } = signToken(USER_ID, TokenPurpose.passwordReset, 15, SECRET);
    const tampered = `${token.slice(0, -3)}XXX`;
    const result = verifyToken(tampered, TokenPurpose.passwordReset, SECRET);
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("different secret → bad_signature", () => {
    const { token } = signToken(USER_ID, TokenPurpose.passwordReset, 15, SECRET);
    const result = verifyToken(
      token,
      TokenPurpose.passwordReset,
      "other-secret-not-the-same-one!!!!",
    );
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("expired → expired", () => {
    const t0 = Temporal.Instant.fromEpochMilliseconds(1_700_000_000_000);
    const laterThanTtl = t0.add({ minutes: 16 });
    const { token } = signToken(USER_ID, TokenPurpose.passwordReset, 15, SECRET, t0);
    const result = verifyToken(token, TokenPurpose.passwordReset, SECRET, laterThanTtl);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  test("malformed: wrong part count", () => {
    expect(verifyToken("not-a-token", "reset", SECRET)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyToken("a.b", "reset", SECRET)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyToken("a.b.c.d", "reset", SECRET)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  test("malformed: non-numeric expiry", () => {
    const result = verifyToken(`${USER_ID}.not-a-number.sig`, "reset", SECRET);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  test("empty parts count as malformed", () => {
    const result = verifyToken("..", "reset", SECRET);
    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  test("expiresAt reflects configured TTL", () => {
    const t0 = Temporal.Instant.fromEpochMilliseconds(1_700_000_000_000);
    const { expiresAt } = signToken(USER_ID, "reset", 30, SECRET, t0);
    const diff = expiresAt.since(t0).total({ unit: "minutes" });
    expect(diff).toBe(30);
  });
});
