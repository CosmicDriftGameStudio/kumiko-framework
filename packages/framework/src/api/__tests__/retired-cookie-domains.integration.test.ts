import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../engine/index.js";
import { setupTestStack, type TestStack, TestUsers } from "../../stack/index.js";
import { AUTH_COOKIE_NAME, CSRF_COOKIE_NAME } from "../auth-middleware.js";
import type { AuthRoutesConfig } from "../auth-routes.js";

const loginFeature = defineFeature("retiredcookie", (r) => {
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
});

const BASE_AUTH_CONFIG: AuthRoutesConfig = {
  membershipQuery: "tenant:query:memberships",
  loginHandler: "retiredcookie:write:login",
};

function isDeleteFor(header: string, name: string): boolean {
  return header.startsWith(`${name}=`) && /Max-Age=0/i.test(header);
}

function isSetFor(header: string, name: string): boolean {
  return header.startsWith(`${name}=`) && !/Max-Age=0/i.test(header);
}

function hasDomain(header: string, domain: string): boolean {
  return new RegExp(`Domain=\\.?${domain.replaceAll(".", "\\.")}(;|$)`, "i").test(header);
}

async function withStack(
  authConfig: AuthRoutesConfig,
  run: (stack: TestStack) => Promise<void>,
): Promise<void> {
  const stack = await setupTestStack({ features: [loginFeature], authConfig });
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
    body: JSON.stringify({ email: "a@b.c", password: "pw" }),
  });
}

describe("retiredCookieDomains (integration)", () => {
  test("login: host-only set for both cookies plus deletes for the retired domain, deletes first", async () => {
    await withStack(
      { ...BASE_AUTH_CONFIG, retiredCookieDomains: ["example.com"] },
      async (stack) => {
        const res = await login(stack);
        expect(res.status).toBe(200);
        const headers = res.headers.getSetCookie();
        for (const name of [AUTH_COOKIE_NAME, CSRF_COOKIE_NAME]) {
          const sets = headers.filter((h) => isSetFor(h, name));
          expect(sets).toHaveLength(1);
          expect(sets[0]).not.toMatch(/Domain=/i);
          const deletes = headers.filter((h) => isDeleteFor(h, name));
          expect(deletes).toHaveLength(1);
          expect(hasDomain(deletes[0] ?? "", "example.com")).toBe(true);
          expect(headers.indexOf(deletes[0] ?? "")).toBeLessThan(headers.indexOf(sets[0] ?? ""));
        }
      },
    );
  });

  test("logout: deletes host-only and every retired domain", async () => {
    await withStack(
      { ...BASE_AUTH_CONFIG, retiredCookieDomains: ["example.com", ".old.example.org"] },
      async (stack) => {
        const token = await stack.jwt.sign(TestUsers.user);
        const res = await stack.app.request("/api/auth/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        expect(res.status).toBe(200);
        const headers = res.headers.getSetCookie();
        for (const name of [AUTH_COOKIE_NAME, CSRF_COOKIE_NAME]) {
          const deletes = headers.filter((h) => isDeleteFor(h, name));
          expect(deletes.some((h) => !/Domain=/i.test(h))).toBe(true);
          expect(deletes.some((h) => hasDomain(h, "example.com"))).toBe(true);
          expect(deletes.some((h) => hasDomain(h, "old.example.org"))).toBe(true);
          expect(deletes).toHaveLength(3);
        }
      },
    );
  });

  test("without the option: login sends no delete headers", async () => {
    await withStack(BASE_AUTH_CONFIG, async (stack) => {
      const res = await login(stack);
      expect(res.status).toBe(200);
      const headers = res.headers.getSetCookie();
      expect(headers).toHaveLength(2);
      expect(headers.some((h) => /Max-Age=0/i.test(h))).toBe(false);
    });
  });
});
