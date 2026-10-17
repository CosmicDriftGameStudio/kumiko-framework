// __Host- cookie prefix through the real buildServer pipeline: login, cookie-
// authenticated write with CSRF, legacy-cookie rejection and logout. Secure is
// forced via auth.secureCookies so NODE_ENV stays "test".

import { describe, expect, test } from "bun:test";
import { getSetCookies } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature, type TenantId } from "../../engine/index.js";
import { TestUsers } from "../../seeding/seed-users.js";
import { CSRF_HEADER_NAME } from "../auth-middleware.js";
import type { AuthRoutesConfig } from "../auth-routes.js";
import { AUTH_COOKIE_BASE, CSRF_COOKIE_BASE, HOST_COOKIE_PREFIX } from "../session-cookies.js";

const PREFIXED_AUTH = `${HOST_COOKIE_PREFIX}${AUTH_COOKIE_BASE}`;
const PREFIXED_CSRF = `${HOST_COOKIE_PREFIX}${CSRF_COOKIE_BASE}`;

const hostCookieFeature = defineFeature("hostcookie", (r) => {
  r.writeHandler({
    name: "login",
    schema: z.object({ email: z.string(), password: z.string() }),
    handler: async () => ({
      isSuccess: true as const,
      data: { kind: "auth-session", session: TestUsers.user },
    }),
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip", limit: 1000, windowSeconds: 60 },
  });
  r.writeHandler({
    name: "ping",
    schema: z.object({}),
    handler: async () => ({ isSuccess: true as const, data: {} }),
    access: { roles: ["User"] },
  });
  r.writeHandler({
    name: "whoami",
    schema: z.object({}),
    handler: async (event) => ({ isSuccess: true as const, data: { roles: event.user.roles } }),
    access: { roles: ["anonymous", "User"] },
  });
});

const ANONYMOUS_TENANT_ID = "00000000-0000-4000-8000-0000000000a1" as TenantId;

const BASE_AUTH_CONFIG: AuthRoutesConfig = {
  membershipQuery: "tenant:query:memberships",
  loginHandler: "hostcookie:write:login",
};

async function withStack(
  authConfig: AuthRoutesConfig,
  run: (stack: TestStack) => Promise<void>,
  extra: Pick<Parameters<typeof setupTestStack>[0], "anonymousAccess"> = {},
): Promise<void> {
  const stack = await setupTestStack({ features: [hostCookieFeature], authConfig, ...extra });
  try {
    await run(stack);
  } finally {
    await stack.cleanup();
  }
}

async function login(stack: TestStack): Promise<Response> {
  return await stack.app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "a@b.c", password: "[REDACTED:API key param]" }),
  });
}

async function ping(stack: TestStack, headers: Record<string, string>): Promise<Response> {
  return await stack.app.request("/api/write", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ type: "hostcookie:write:ping", payload: {} }),
  });
}

function isExpiry(header: string, name: string): boolean {
  return header.startsWith(`${name}=`) && /Max-Age=0/i.test(header);
}

function expectAllSessionCookieVariantsExpired(res: Response): void {
  const headers = res.headers.getSetCookie();
  for (const name of [PREFIXED_AUTH, PREFIXED_CSRF, AUTH_COOKIE_BASE, CSRF_COOKIE_BASE]) {
    expect(headers.some((h) => isExpiry(h, name))).toBe(true);
  }
}

async function loginCookies(stack: TestStack): Promise<{ auth: string; csrf: string }> {
  const cookies = getSetCookies(await login(stack));
  const auth = cookies.get(PREFIXED_AUTH)?.value;
  const csrf = cookies.get(PREFIXED_CSRF)?.value;
  if (auth === undefined || csrf === undefined) throw new Error("login set no session cookies");
  return { auth, csrf };
}

describe("__Host- session cookies (integration)", () => {
  test("login sets prefixed Secure host-only cookies and expires the legacy names", async () => {
    await withStack({ ...BASE_AUTH_CONFIG, secureCookies: true }, async (stack) => {
      const res = await login(stack);
      expect(res.status).toBe(200);
      const cookies = getSetCookies(res);
      for (const name of [PREFIXED_AUTH, PREFIXED_CSRF]) {
        const raw = cookies.get(name)?.raw;
        expect(raw).toMatch(/;\s*Secure/i);
        expect(raw).toMatch(/;\s*Path=\//i);
        expect(raw).not.toMatch(/Domain=/i);
      }
      const headers = res.headers.getSetCookie();
      for (const name of [AUTH_COOKIE_BASE, CSRF_COOKIE_BASE]) {
        expect(headers.some((h) => isExpiry(h, name))).toBe(true);
      }
    });
  });

  test("a follow-up request with the prefixed cookies and the CSRF header is authenticated and passes CSRF", async () => {
    await withStack({ ...BASE_AUTH_CONFIG, secureCookies: true }, async (stack) => {
      const cookies = getSetCookies(await login(stack));
      const auth = cookies.get(PREFIXED_AUTH)?.value;
      const csrf = cookies.get(PREFIXED_CSRF)?.value;
      expect(auth).toBeDefined();
      expect(csrf).toBeDefined();
      const cookieHeader = `${PREFIXED_AUTH}=${auth}; ${PREFIXED_CSRF}=${csrf}`;

      const ok = await ping(stack, {
        Cookie: cookieHeader,
        [CSRF_HEADER_NAME]: csrf ?? "",
      });
      expect(ok.status).toBe(200);

      const noHeader = await ping(stack, { Cookie: cookieHeader });
      expect(noHeader.status).toBe(403);
    });
  });

  test("a request with only the legacy auth cookie is anonymous (401)", async () => {
    await withStack({ ...BASE_AUTH_CONFIG, secureCookies: true }, async (stack) => {
      const token = await stack.jwt.sign(TestUsers.user);
      const res = await ping(stack, {
        Cookie: `${AUTH_COOKIE_BASE}=${token}; ${CSRF_COOKIE_BASE}=c`,
        [CSRF_HEADER_NAME]: "c",
      });
      expect(res.status).toBe(401);
    });
  });

  test("logout clears the prefixed and the legacy names", async () => {
    await withStack({ ...BASE_AUTH_CONFIG, secureCookies: true }, async (stack) => {
      const cookies = getSetCookies(await login(stack));
      const auth = cookies.get(PREFIXED_AUTH)?.value;
      const csrf = cookies.get(PREFIXED_CSRF)?.value;
      const res = await stack.app.request("/api/auth/logout", {
        method: "POST",
        headers: {
          Cookie: `${PREFIXED_AUTH}=${auth}; ${PREFIXED_CSRF}=${csrf}`,
          [CSRF_HEADER_NAME]: csrf ?? "",
        },
      });
      expect(res.status).toBe(200);
      const headers = res.headers.getSetCookie();
      for (const name of [PREFIXED_AUTH, PREFIXED_CSRF, AUTH_COOKIE_BASE, CSRF_COOKIE_BASE]) {
        expect(headers.some((h) => isExpiry(h, name))).toBe(true);
      }
    });
  });

  test("with cookieDomain the names stay unprefixed and the session cookie authenticates", async () => {
    await withStack(
      {
        ...BASE_AUTH_CONFIG,
        secureCookies: true,
        cookieDomain: "example.eu",
        allowedOrigins: ["https://admin.example.eu"],
      },
      async (stack) => {
        const cookies = getSetCookies(await login(stack));
        expect(cookies.get(AUTH_COOKIE_BASE)?.raw).toMatch(/Domain=example\.eu/i);
        expect(cookies.get(PREFIXED_AUTH)?.value ?? "").toBe("");

        const auth = cookies.get(AUTH_COOKIE_BASE)?.value;
        const csrf = cookies.get(CSRF_COOKIE_BASE)?.value;
        const ok = await ping(stack, {
          Cookie: `${AUTH_COOKIE_BASE}=${auth}; ${CSRF_COOKIE_BASE}=${csrf}`,
          [CSRF_HEADER_NAME]: csrf ?? "",
          Origin: "https://admin.example.eu",
        });
        expect(ok.status).toBe(200);
      },
    );
  });

  test("with cookieDomain login and logout expire the leftover __Host- cookies as Secure host-only", async () => {
    await withStack(
      {
        ...BASE_AUTH_CONFIG,
        secureCookies: true,
        cookieDomain: "example.eu",
        allowedOrigins: ["https://admin.example.eu"],
      },
      async (stack) => {
        const expectHostPrefixedExpiry = (res: Response): void => {
          const headers = res.headers.getSetCookie();
          for (const name of [PREFIXED_AUTH, PREFIXED_CSRF]) {
            const expiry = headers.find((h) => isExpiry(h, name));
            expect(expiry).toMatch(/;\s*Secure/i);
            expect(expiry).toMatch(/;\s*Path=\//i);
            expect(expiry).not.toMatch(/Domain=/i);
          }
        };
        const loginRes = await login(stack);
        expectHostPrefixedExpiry(loginRes);

        const cookies = getSetCookies(loginRes);
        const auth = cookies.get(AUTH_COOKIE_BASE)?.value;
        const csrf = cookies.get(CSRF_COOKIE_BASE)?.value;
        const logoutRes = await stack.app.request("/api/auth/logout", {
          method: "POST",
          headers: {
            Cookie: `${AUTH_COOKIE_BASE}=${auth}; ${CSRF_COOKIE_BASE}=${csrf}`,
            [CSRF_HEADER_NAME]: csrf ?? "",
            Origin: "https://admin.example.eu",
          },
        });
        expect(logoutRes.status).toBe(200);
        expectHostPrefixedExpiry(logoutRes);
      },
    );
  });

  test("a duplicated auth cookie makes the request unauthenticated and expires every variant", async () => {
    await withStack({ ...BASE_AUTH_CONFIG, secureCookies: true }, async (stack) => {
      const { auth, csrf } = await loginCookies(stack);
      const res = await ping(stack, {
        Cookie: `${PREFIXED_AUTH}=${auth}; ${PREFIXED_AUTH}=${auth}; ${PREFIXED_CSRF}=${csrf}`,
        [CSRF_HEADER_NAME]: csrf,
      });
      expect(res.status).toBe(401);
      expectAllSessionCookieVariantsExpired(res);
    });
  });

  test("a duplicated csrf cookie on a POST is unauthenticated instead of a CSRF mismatch", async () => {
    await withStack({ ...BASE_AUTH_CONFIG, secureCookies: true }, async (stack) => {
      const { auth, csrf } = await loginCookies(stack);
      const res = await ping(stack, {
        Cookie: `${PREFIXED_AUTH}=${auth}; ${PREFIXED_CSRF}=${csrf}; ${PREFIXED_CSRF}=stale`,
        [CSRF_HEADER_NAME]: csrf,
      });
      expect(res.status).toBe(401);
      expectAllSessionCookieVariantsExpired(res);
    });
  });

  test("with cookieDomain a duplicated auth cookie expires the domain and the host-only variants", async () => {
    await withStack(
      {
        ...BASE_AUTH_CONFIG,
        secureCookies: true,
        cookieDomain: "example.eu",
        allowedOrigins: ["https://admin.example.eu"],
      },
      async (stack) => {
        const cookies = getSetCookies(await login(stack));
        const auth = cookies.get(AUTH_COOKIE_BASE)?.value;
        const csrf = cookies.get(CSRF_COOKIE_BASE)?.value ?? "";
        const res = await ping(stack, {
          Cookie: `${AUTH_COOKIE_BASE}=${auth}; ${AUTH_COOKIE_BASE}=${auth}; ${CSRF_COOKIE_BASE}=${csrf}`,
          [CSRF_HEADER_NAME]: csrf,
          Origin: "https://admin.example.eu",
        });
        expect(res.status).toBe(401);
        const expiries = res.headers.getSetCookie();
        for (const name of [AUTH_COOKIE_BASE, CSRF_COOKIE_BASE]) {
          const variants = expiries.filter((h) => isExpiry(h, name));
          expect(variants.some((h) => /Domain=example\.eu/i.test(h))).toBe(true);
          expect(variants.some((h) => !/Domain=/i.test(h))).toBe(true);
        }
      },
    );
  });

  test("with anonymousAccess a duplicated auth cookie continues as anonymous and expires every variant", async () => {
    await withStack(
      { ...BASE_AUTH_CONFIG, secureCookies: true },
      async (stack) => {
        const { auth, csrf } = await loginCookies(stack);
        const res = await stack.app.request("/api/write", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `${PREFIXED_AUTH}=${auth}; ${PREFIXED_AUTH}=${auth}; ${PREFIXED_CSRF}=${csrf}`,
            [CSRF_HEADER_NAME]: csrf,
          },
          body: JSON.stringify({ type: "hostcookie:write:whoami", payload: {} }),
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { data: { roles: readonly string[] } };
        expect(body.data.roles).toEqual(["anonymous"]);
        expectAllSessionCookieVariantsExpired(res);
      },
      { anonymousAccess: { defaultTenantId: ANONYMOUS_TENANT_ID } },
    );
  });

  test("the prefixed and the legacy auth cookie side by side are not a duplicate", async () => {
    await withStack({ ...BASE_AUTH_CONFIG, secureCookies: true }, async (stack) => {
      const { auth, csrf } = await loginCookies(stack);
      const res = await ping(stack, {
        Cookie: `${AUTH_COOKIE_BASE}=old; ${PREFIXED_AUTH}=${auth}; ${PREFIXED_CSRF}=${csrf}`,
        [CSRF_HEADER_NAME]: csrf,
      });
      expect(res.status).toBe(200);
    });
  });

  test("publicOrigin enables the Origin guard for the public origin and the request's own host", async () => {
    await withStack(
      { ...BASE_AUTH_CONFIG, secureCookies: true, publicOrigin: "https://app.example.eu" },
      async (stack) => {
        const { auth, csrf } = await loginCookies(stack);
        const session = {
          Cookie: `${PREFIXED_AUTH}=${auth}; ${PREFIXED_CSRF}=${csrf}`,
          [CSRF_HEADER_NAME]: csrf,
        };
        const fromPublicOrigin = await ping(stack, {
          ...session,
          Origin: "https://app.example.eu",
        });
        expect(fromPublicOrigin.status).toBe(200);

        const fromOwnHost = await ping(stack, {
          ...session,
          Host: "custom.example.com",
          Origin: "https://custom.example.com",
        });
        expect(fromOwnHost.status).toBe(200);

        const fromSibling = await ping(stack, { ...session, Origin: "https://tenant.example.eu" });
        expect(fromSibling.status).toBe(403);
        const body = (await fromSibling.json()) as { error: { code: string } };
        expect(body.error.code).toBe("origin_not_allowed");
      },
    );
  });

  test("insecure default (test env): names stay unprefixed", async () => {
    await withStack(BASE_AUTH_CONFIG, async (stack) => {
      const cookies = getSetCookies(await login(stack));
      expect(cookies.get(AUTH_COOKIE_BASE)).toBeDefined();
      expect(cookies.get(PREFIXED_AUTH)).toBeUndefined();
    });
  });
});
