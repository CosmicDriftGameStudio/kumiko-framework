import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { CSRF_HEADER_NAME } from "@cosmicdrift/kumiko-dispatcher-live";
import {
  confirmAccountUnlock,
  confirmSignup,
  csrfHeader,
  fetchCurrentUser,
  fetchTenants,
  login,
  logout,
  requestAccountUnlock,
  requestEmailVerification,
  requestPasswordReset,
  requestSignup,
  resetPassword,
  switchTenant,
  verifyEmail,
} from "../auth-client";

const CSRF_TOKEN = "csrf-test-token";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function withCsrfDocument(): void {
  (globalThis as { document?: { cookie: string } }).document = {
    cookie: `kumiko_csrf=${CSRF_TOKEN}`,
  };
}

function withoutCsrfDocument(): void {
  delete (globalThis as { document?: { cookie: string } }).document;
}

beforeEach(() => {
  globalThis.fetch = mock(
    async () => new Response(null, { status: 200 }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  withoutCsrfDocument();
});

describe("csrfHeader", () => {
  test("returns CSRF header when kumiko_csrf cookie is present", () => {
    withCsrfDocument();
    expect(csrfHeader()).toEqual({ [CSRF_HEADER_NAME]: CSRF_TOKEN });
  });

  test("returns empty object when no CSRF cookie", () => {
    withoutCsrfDocument();
    expect(csrfHeader()).toEqual({});
  });
});

describe("login", () => {
  test("HTTP 429 → kind:failure reason:rate_limited", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 429 }),
    ) as unknown as typeof fetch;

    const res = await login({ email: "a@b.c", password: "secret" });

    expect(res).toEqual({ kind: "failure", error: { reason: "rate_limited" } });
  });

  test("success → kind:success with token and user", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        isSuccess: true,
        token: "jwt-1",
        user: { id: "u1", tenantId: "t1", roles: ["Admin"] },
      }),
    ) as unknown as typeof fetch;

    const res = await login({ email: "a@b.c", password: "secret" });

    expect(res).toEqual({
      kind: "success",
      data: { token: "jwt-1", user: { id: "u1", tenantId: "t1", roles: ["Admin"] } },
    });
  });

  test("MFA enrolled → kind:mfa-challenge", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ isSuccess: true, mfaRequired: true, challengeToken: "challenge-abc" }),
    ) as unknown as typeof fetch;

    const res = await login({ email: "a@b.c", password: "secret" });

    expect(res).toEqual({ kind: "mfa-challenge", challengeToken: "challenge-abc" });
  });

  test("MFA enforcement blocks unenrolled user → kind:mfa-setup-required", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ isSuccess: true, mfaSetupRequired: true }),
    ) as unknown as typeof fetch;

    const res = await login({ email: "a@b.c", password: "secret" });

    expect(res).toEqual({ kind: "mfa-setup-required" });
  });

  test("string error → kind:failure with reason from string", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ isSuccess: false, error: "invalid_credentials" }),
    ) as unknown as typeof fetch;

    const res = await login({ email: "a@b.c", password: "wrong" });

    expect(res).toEqual({ kind: "failure", error: { reason: "invalid_credentials" } });
  });

  test("structured error → reason, message, retryAfterSeconds from details", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        isSuccess: false,
        error: {
          code: "login_failed",
          message: "Account locked",
          details: { reason: "account_locked", retryAfterSeconds: 300 },
        },
      }),
    ) as unknown as typeof fetch;

    const res = await login({ email: "a@b.c", password: "secret" });

    expect(res).toEqual({
      kind: "failure",
      error: { reason: "account_locked", message: "Account locked", retryAfterSeconds: 300 },
    });
  });

  test("structured error without details.reason → falls back to error.code", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ isSuccess: false, error: { code: "no_membership" } }),
    ) as unknown as typeof fetch;

    const res = await login({ email: "a@b.c", password: "secret" });

    expect(res).toEqual({ kind: "failure", error: { reason: "no_membership" } });
  });

  test("no error field → default reason login_failed", async () => {
    globalThis.fetch = mock(async () => jsonResponse({})) as unknown as typeof fetch;

    const res = await login({ email: "a@b.c", password: "secret" });

    expect(res).toEqual({ kind: "failure", error: { reason: "login_failed" } });
  });

  test("isSuccess true but missing token/user → login_failed fallback", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ isSuccess: true }),
    ) as unknown as typeof fetch;

    const res = await login({ email: "a@b.c", password: "secret" });

    expect(res).toEqual({ kind: "failure", error: { reason: "login_failed" } });
  });

  test("malformed JSON body → login_failed fallback", async () => {
    globalThis.fetch = mock(
      async () => new Response("not json", { status: 200 }),
    ) as unknown as typeof fetch;

    const res = await login({ email: "a@b.c", password: "secret" });

    expect(res).toEqual({ kind: "failure", error: { reason: "login_failed" } });
  });
});

describe("logout", () => {
  test("POSTs to /api/auth/logout with CSRF header when cookie present", async () => {
    withCsrfDocument();
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await logout();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          [CSRF_HEADER_NAME]: CSRF_TOKEN,
        }),
      }),
    );
  });
});

type TokenEndpoint = {
  name: string;
  fn: (
    arg: string,
  ) => Promise<{ ok: true } | { ok: false; error: { reason: string; retryAfterSeconds?: number } }>;
  url: string;
  bodyKey: string;
};

const tokenEndpoints: TokenEndpoint[] = [
  {
    name: "requestPasswordReset",
    fn: requestPasswordReset,
    url: "/api/auth/request-password-reset",
    bodyKey: "email",
  },
  {
    name: "resetPassword",
    fn: (email) => resetPassword("tok", email),
    url: "/api/auth/reset-password",
    bodyKey: "newPassword",
  },
  {
    name: "requestEmailVerification",
    fn: requestEmailVerification,
    url: "/api/auth/request-email-verification",
    bodyKey: "email",
  },
  {
    name: "verifyEmail",
    fn: verifyEmail,
    url: "/api/auth/verify-email",
    bodyKey: "token",
  },
  {
    name: "requestAccountUnlock",
    fn: requestAccountUnlock,
    url: "/api/auth/request-account-unlock",
    bodyKey: "email",
  },
  {
    name: "confirmAccountUnlock",
    fn: confirmAccountUnlock,
    url: "/api/auth/confirm-account-unlock",
    bodyKey: "token",
  },
  {
    name: "requestSignup",
    fn: requestSignup,
    url: "/api/auth/signup-request",
    bodyKey: "email",
  },
];

for (const { name, fn, url, bodyKey } of tokenEndpoints) {
  describe(name, () => {
    test("ok → { ok: true }", async () => {
      withCsrfDocument();
      const fetchMock = mock(async () => new Response(null, { status: 200 }));
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const res = await fn(bodyKey === "email" ? "user@test.com" : "token-1");

      expect(res).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          headers: expect.objectContaining({ [CSRF_HEADER_NAME]: CSRF_TOKEN }),
        }),
      );
    });

    test("429 → rate_limited with retryAfterSeconds", async () => {
      globalThis.fetch = mock(async () =>
        jsonResponse({ error: { details: { retryAfterSeconds: 120 } } }, 429),
      ) as unknown as typeof fetch;

      const res = await fn(bodyKey === "email" ? "user@test.com" : "token-1");

      expect(res).toEqual({ ok: false, error: { reason: "rate_limited", retryAfterSeconds: 120 } });
    });

    test("other failure → reason from details or code", async () => {
      globalThis.fetch = mock(async () =>
        jsonResponse(
          { error: { code: "validation_failed", details: { reason: "invalid_token" } } },
          422,
        ),
      ) as unknown as typeof fetch;

      const res = await fn(bodyKey === "email" ? "user@test.com" : "token-1");

      expect(res).toEqual({ ok: false, error: { reason: "invalid_token" } });
    });

    test("failure without details → unknown fallback", async () => {
      globalThis.fetch = mock(async () => jsonResponse({}, 500)) as unknown as typeof fetch;

      const res = await fn(bodyKey === "email" ? "user@test.com" : "token-1");

      expect(res).toEqual({ ok: false, error: { reason: "unknown" } });
    });
  });
}

describe("resetPassword", () => {
  test("sends token and newPassword in body", async () => {
    withCsrfDocument();
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await resetPassword("reset-tok", "newpass123");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/reset-password",
      expect.objectContaining({
        body: JSON.stringify({ token: "reset-tok", newPassword: "newpass123" }),
      }),
    );
  });
});

describe("confirmSignup", () => {
  test("ok → returns parsed data", async () => {
    withCsrfDocument();
    const data = {
      user: { id: "u1", tenantId: "t1", roles: ["Member"] },
      tenantKey: "acme",
    };
    globalThis.fetch = mock(async () => jsonResponse(data)) as unknown as typeof fetch;

    const res = await confirmSignup("signup-tok", "password123");

    expect(res).toEqual({ ok: true, data });
  });

  test("failure → parseTokenFailure shape", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ error: { code: "invalid_signup_token" } }, 422),
    ) as unknown as typeof fetch;

    const res = await confirmSignup("bad-tok", "password123");

    expect(res).toEqual({ ok: false, error: { reason: "invalid_signup_token" } });
  });
});

describe("fetchTenants", () => {
  test("401 → null", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 401 }),
    ) as unknown as typeof fetch;

    const res = await fetchTenants();

    expect(res).toBeNull();
  });

  test("ok → returns tenants and activeTenantId", async () => {
    const body = {
      tenants: [{ tenantId: "t1", roles: ["Admin"], name: "Acme" }],
      activeTenantId: "t1",
    };
    globalThis.fetch = mock(async () => jsonResponse(body)) as unknown as typeof fetch;

    const res = await fetchTenants();

    expect(res).toEqual(body);
  });

  test("non-ok status → throws", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(fetchTenants()).rejects.toThrow("auth/tenants failed: 500");
  });
});

describe("switchTenant", () => {
  test("ok → resolves without error", async () => {
    withCsrfDocument();
    const fetchMock = mock(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await switchTenant("tenant-2");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/switch-tenant",
      expect.objectContaining({
        body: JSON.stringify({ tenantId: "tenant-2" }),
        headers: expect.objectContaining({ [CSRF_HEADER_NAME]: CSRF_TOKEN }),
      }),
    );
  });

  test("!ok → throws with status and body", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ error: { code: "not_a_member" } }, 403),
    ) as unknown as typeof fetch;

    await expect(switchTenant("tenant-x")).rejects.toThrow(
      'switch-tenant failed: 403 {"error":{"code":"not_a_member"}}',
    );
  });

  test("!ok with unparseable body → throws with empty object", async () => {
    globalThis.fetch = mock(
      async () => new Response("not json", { status: 400 }),
    ) as unknown as typeof fetch;

    await expect(switchTenant("tenant-x")).rejects.toThrow("switch-tenant failed: 400 {}");
  });
});

describe("fetchCurrentUser", () => {
  test("401 → null", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 401 }),
    ) as unknown as typeof fetch;

    const res = await fetchCurrentUser();

    expect(res).toBeNull();
  });

  test("missing data field → null", async () => {
    globalThis.fetch = mock(async () => jsonResponse({})) as unknown as typeof fetch;

    const res = await fetchCurrentUser();

    expect(res).toBeNull();
  });

  test("full profile with locale and roles JSON", async () => {
    withCsrfDocument();
    globalThis.fetch = mock(async () =>
      jsonResponse({
        data: {
          id: "u1",
          email: "user@test.com",
          displayName: "Test User",
          locale: "de",
          roles: '["SystemAdmin","Support"]',
        },
      }),
    ) as unknown as typeof fetch;

    const res = await fetchCurrentUser();

    expect(res).toEqual({
      id: "u1",
      email: "user@test.com",
      displayName: "Test User",
      locale: "de",
      globalRoles: ["SystemAdmin", "Support"],
    });
  });

  test("undefined roles → empty globalRoles", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        data: { id: "u1", email: "a@b.c", displayName: "User" },
      }),
    ) as unknown as typeof fetch;

    const res = await fetchCurrentUser();

    expect(res?.globalRoles).toEqual([]);
  });

  test("empty roles string → empty globalRoles", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        data: { id: "u1", email: "a@b.c", displayName: "User", roles: "" },
      }),
    ) as unknown as typeof fetch;

    const res = await fetchCurrentUser();

    expect(res?.globalRoles).toEqual([]);
  });

  test("invalid JSON roles → empty globalRoles", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        data: { id: "u1", email: "a@b.c", displayName: "User", roles: "not-json" },
      }),
    ) as unknown as typeof fetch;

    const res = await fetchCurrentUser();

    expect(res?.globalRoles).toEqual([]);
  });

  test("non-array JSON roles → empty globalRoles", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        data: { id: "u1", email: "a@b.c", displayName: "User", roles: '{"role":"Admin"}' },
      }),
    ) as unknown as typeof fetch;

    const res = await fetchCurrentUser();

    expect(res?.globalRoles).toEqual([]);
  });

  test("mixed-type array roles → empty globalRoles", async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        data: { id: "u1", email: "a@b.c", displayName: "User", roles: '["Admin",1,true]' },
      }),
    ) as unknown as typeof fetch;

    const res = await fetchCurrentUser();

    expect(res?.globalRoles).toEqual([]);
  });

  test("non-ok status → throws", async () => {
    globalThis.fetch = mock(
      async () => new Response(null, { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(fetchCurrentUser()).rejects.toThrow("user:me failed: 500");
  });
});
