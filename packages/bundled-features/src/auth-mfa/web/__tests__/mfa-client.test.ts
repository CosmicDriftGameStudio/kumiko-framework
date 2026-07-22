import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { confirmMfaSetupPreauth, startMfaSetupPreauth, verifyMfaChallenge } from "../mfa-client";

beforeEach(() => {
  globalThis.fetch = mock(
    async () => new Response(null, { status: 200 }),
  ) as unknown as typeof fetch;
});
afterEach(() => {});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("verifyMfaChallenge", () => {
  test("posts challengeToken + code to /api/auth/mfa/verify", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ isSuccess: true, token: "t", user: { id: "u1", tenantId: "t1", roles: [] } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await verifyMfaChallenge("challenge-1", "123456");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/mfa/verify",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ challengeToken: "challenge-1", code: "123456" }),
      }),
    );
  });

  test("success → kind:success mit token+user", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        isSuccess: true,
        token: "test-token",
        user: { id: "u1", tenantId: "t1", roles: ["Admin"] },
      }),
    ) as unknown as typeof fetch;

    const res = await verifyMfaChallenge("challenge-1", "123456");

    expect(res).toEqual({
      kind: "success",
      data: { token: "test-token", user: { id: "u1", tenantId: "t1", roles: ["Admin"] } },
    });
  });

  test("HTTP 429 → kind:failure reason:rate_limited (ohne Body-Parse)", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 429 }),
    ) as unknown as typeof fetch;

    const res = await verifyMfaChallenge("challenge-1", "000000");

    expect(res).toEqual({ kind: "failure", error: { reason: "rate_limited" } });
  });

  test("error als String → kind:failure reason:<string>", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ isSuccess: false, error: "invalid_totp_code" }),
    ) as unknown as typeof fetch;

    const res = await verifyMfaChallenge("challenge-1", "000000");

    expect(res).toEqual({ kind: "failure", error: { reason: "invalid_totp_code" } });
  });

  test("error-Objekt mit details.reason → reason aus details, message+retryAfterSeconds übernommen", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        isSuccess: false,
        error: {
          code: "mfa_verify_failed",
          message: "too many attempts",
          details: { reason: "too_many_attempts", retryAfterSeconds: 60 },
        },
      }),
    ) as unknown as typeof fetch;

    const res = await verifyMfaChallenge("challenge-1", "000000");

    expect(res).toEqual({
      kind: "failure",
      error: { reason: "too_many_attempts", message: "too many attempts", retryAfterSeconds: 60 },
    });
  });

  test("error-Objekt ohne details.reason → fällt auf error.code zurück", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ isSuccess: false, error: { code: "invalid_challenge_token" } }),
    ) as unknown as typeof fetch;

    const res = await verifyMfaChallenge("challenge-1", "000000");

    expect(res).toEqual({ kind: "failure", error: { reason: "invalid_challenge_token" } });
  });

  test("kein error-Feld, kein isSuccess → default reason mfa_verify_failed", async () => {
    globalThis.fetch = mock(async () => jsonResponse({})) as unknown as typeof fetch;

    const res = await verifyMfaChallenge("challenge-1", "000000");

    expect(res).toEqual({ kind: "failure", error: { reason: "mfa_verify_failed" } });
  });

  test("kaputtes JSON → leeres Body-Objekt, default reason", async () => {
    globalThis.fetch = mock(
      async () => new Response("not json", { status: 200 }),
    ) as unknown as typeof fetch;

    const res = await verifyMfaChallenge("challenge-1", "000000");

    expect(res).toEqual({ kind: "failure", error: { reason: "mfa_verify_failed" } });
  });
});

describe("startMfaSetupPreauth", () => {
  test("posts preauthSetupToken + accountLabel to /api/auth/mfa/preauth-enable-start", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({
        isSuccess: true,
        setupToken: "setup-1",
        otpauthUri: "otpauth://totp/App:user@example.com?secret=ABCD&issuer=App",
        recoveryCodes: ["r1", "r2"],
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await startMfaSetupPreauth("preauth-1", "user@example.com");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/mfa/preauth-enable-start",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ preauthSetupToken: "preauth-1", accountLabel: "user@example.com" }),
      }),
    );
  });

  test("success → kind:success mit setupToken/otpauthUri/recoveryCodes", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        isSuccess: true,
        setupToken: "setup-1",
        otpauthUri: "otpauth://totp/App:user@example.com?secret=ABCD&issuer=App",
        recoveryCodes: ["r1", "r2"],
      }),
    ) as unknown as typeof fetch;

    const res = await startMfaSetupPreauth("preauth-1", "user@example.com");

    expect(res).toEqual({
      kind: "success",
      data: {
        setupToken: "setup-1",
        otpauthUri: "otpauth://totp/App:user@example.com?secret=ABCD&issuer=App",
        recoveryCodes: ["r1", "r2"],
      },
    });
  });

  test("HTTP 429 → kind:failure reason:rate_limited", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 429 }),
    ) as unknown as typeof fetch;

    const res = await startMfaSetupPreauth("preauth-1", "user@example.com");

    expect(res).toEqual({ kind: "failure", error: { reason: "rate_limited" } });
  });

  test("error als String → kind:failure reason:<string>", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ isSuccess: false, error: "invalid_challenge_token" }),
    ) as unknown as typeof fetch;

    const res = await startMfaSetupPreauth("preauth-1", "user@example.com");

    expect(res).toEqual({ kind: "failure", error: { reason: "invalid_challenge_token" } });
  });

  test("error-Objekt ohne details.reason → fällt auf error.code zurück", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ isSuccess: false, error: { code: "mfa_already_enabled" } }),
    ) as unknown as typeof fetch;

    const res = await startMfaSetupPreauth("preauth-1", "user@example.com");

    expect(res).toEqual({ kind: "failure", error: { reason: "mfa_already_enabled" } });
  });
});

describe("confirmMfaSetupPreauth", () => {
  test("posts setupToken + code to /api/auth/mfa/preauth-confirm", async () => {
    const fetchMock = mock(async () =>
      jsonResponse({ isSuccess: true, token: "t", user: { id: "u1", tenantId: "t1", roles: [] } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await confirmMfaSetupPreauth("setup-1", "123456");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/mfa/preauth-confirm",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ setupToken: "setup-1", code: "123456" }),
      }),
    );
  });

  test("success → kind:success mit token+user", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        isSuccess: true,
        token: "test-token",
        user: { id: "u1", tenantId: "t1", roles: ["User"] },
      }),
    ) as unknown as typeof fetch;

    const res = await confirmMfaSetupPreauth("setup-1", "123456");

    expect(res).toEqual({
      kind: "success",
      data: { token: "test-token", user: { id: "u1", tenantId: "t1", roles: ["User"] } },
    });
  });

  test("HTTP 429 → kind:failure reason:rate_limited", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 429 }),
    ) as unknown as typeof fetch;

    const res = await confirmMfaSetupPreauth("setup-1", "000000");

    expect(res).toEqual({ kind: "failure", error: { reason: "rate_limited" } });
  });

  test("error-Objekt mit details.reason → reason + retryAfterSeconds übernommen", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        isSuccess: false,
        error: {
          code: "mfa_setup_confirm_failed",
          details: { reason: "too_many_attempts", retryAfterSeconds: 30 },
        },
      }),
    ) as unknown as typeof fetch;

    const res = await confirmMfaSetupPreauth("setup-1", "000000");

    expect(res).toEqual({
      kind: "failure",
      error: { reason: "too_many_attempts", retryAfterSeconds: 30 },
    });
  });
});
