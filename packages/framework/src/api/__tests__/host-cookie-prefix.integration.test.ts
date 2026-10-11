// __Host- cookie prefix through the real buildServer pipeline: login, cookie-
// authenticated write with CSRF, legacy-cookie rejection and logout. Secure is
// forced via auth.secureCookies so NODE_ENV stays "test".

import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../engine/index.js";
import { setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";
import { getSetCookies } from "../../testing/http-cookies.js";
import { CSRF_HEADER_NAME } from "../auth-middleware.js";
import type { AuthRoutesConfig } from "../auth-routes.js";
import { AUTH_COOKIE_BASE, CSRF_COOKIE_BASE, HOST_COOKIE_PREFIX } from "../session-cookies.js";

const PREFIXED_AUTH = `${HOST_COOKIE_PREFIX}${AUTH_COOKIE_BASE}`;
const PREFIXED_CSRF = `${HOST_COOKIE_PREFIX}${CSRF_COOKIE_BASE}`;

const hostCookieFeature = defineFeature("hostcookie", (r) => {
  r.writeHandler(
    "login",
    z.object({ email: z.string(), password: z.string() }),
    async () => ({
      isSuccess: true as const,
      data: { kind: "auth-session", session: TestUsers.user },
    }),
    {
      access: { roles: ["anonymous"] },
      rateLimit: { per: "ip", limit: 1000, windowSeconds: 60 },
    },
  );
  r.writeHandler("ping", z.object({}), async () => ({ isSuccess: true as const, data: {} }), {
    access: { roles: ["User"] },
  });
});

const BASE_AUTH_CONFIG: AuthRoutesConfig = {
  membershipQuery: "tenant:query:memberships",
  loginHandler: "hostcookie:write:login",
};

async function withStack(
  authConfig: AuthRoutesConfig,
  run: (stack: TestStack) => Promise<void>,
): Promise<void> {
  const stack = await setupTestStack({ features: [hostCookieFeature], authConfig });
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
        expect(cookies.get(PREFIXED_AUTH)).toBeUndefined();

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

  test("insecure default (test env): names stay unprefixed", async () => {
    await withStack(BASE_AUTH_CONFIG, async (stack) => {
      const cookies = getSetCookies(await login(stack));
      expect(cookies.get(AUTH_COOKIE_BASE)).toBeDefined();
      expect(cookies.get(PREFIXED_AUTH)).toBeUndefined();
    });
  });
});
