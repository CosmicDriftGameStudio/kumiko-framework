// origin-middleware: server-side Origin-allowlist guard layered behind
// authMiddleware. Covers the production-relevant paths: cookie + state-
// changing (allowed/disallowed/simple-request/opaque, all four methods),
// cookie + safe method, bearer transport, the no-Origin Sec-Fetch-Site
// fallback, and the fail-closed boot check.

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { TestUsers } from "../../stack";
import { AUTH_COOKIE_NAME, authMiddleware } from "../auth-middleware";
import { createJwtHelper } from "../jwt";
import {
  assertOriginGuardConfig,
  isOriginAllowed,
  normalizeOrigin,
  originMiddleware,
} from "../origin-middleware";

function isErrorBody(v: unknown): v is { error: { code: string } } {
  if (typeof v !== "object" || v === null || !("error" in v)) return false;
  const err = (v as { error: unknown }).error;
  return (
    typeof err === "object" && err !== null && typeof (err as { code: unknown }).code === "string"
  );
}

async function readErrorCode(res: Response): Promise<string> {
  const body: unknown = await res.json();
  if (!isErrorBody(body))
    throw new Error(`expected { error: { code } }, got ${JSON.stringify(body)}`);
  return body.error.code;
}

const JWT_SECRET = "origin-middleware-test-secret-min-32-characters-long";
const ALLOWED = "https://admin.example.eu";
const DISALLOWED = "https://tenant.example.eu";

async function buildApp(): Promise<{ app: Hono; token: string }> {
  const jwt = createJwtHelper(JWT_SECRET);
  const token = await jwt.sign(TestUsers.user);
  const app = new Hono();
  app.use("/api/*", authMiddleware(jwt));
  app.use("/api/*", originMiddleware([ALLOWED]));
  app.get("/api/ping", (c) => c.json({ ok: true }));
  app.post("/api/write", (c) => c.json({ ok: true }));
  return { app, token };
}

describe("normalizeOrigin", () => {
  test("lowercases and strips trailing slash + whitespace", () => {
    expect(normalizeOrigin("HTTPS://Admin.Example.EU/")).toBe("https://admin.example.eu");
    expect(normalizeOrigin("  https://admin.example.eu  ")).toBe("https://admin.example.eu");
    expect(normalizeOrigin("https://admin.example.eu")).toBe("https://admin.example.eu");
  });
});

describe("isOriginAllowed", () => {
  const allowlist = new Set([normalizeOrigin(ALLOWED)]);
  test("matches normalized entry regardless of case/trailing slash", () => {
    expect(isOriginAllowed("https://admin.example.eu", allowlist)).toBe(true);
    expect(isOriginAllowed("HTTPS://ADMIN.EXAMPLE.EU/", allowlist)).toBe(true);
  });
  test("rejects a non-listed origin and the opaque 'null' origin", () => {
    expect(isOriginAllowed(DISALLOWED, allowlist)).toBe(false);
    expect(isOriginAllowed("null", allowlist)).toBe(false);
  });
});

describe("assertOriginGuardConfig", () => {
  test("throws when cookieDomain is set without allowedOrigins or opt-out", () => {
    expect(() => assertOriginGuardConfig({ cookieDomain: "example.eu" })).toThrow(/allowedOrigins/);
  });
  test("throws when allowedOrigins is an empty array", () => {
    expect(() =>
      assertOriginGuardConfig({ cookieDomain: "example.eu", allowedOrigins: [] }),
    ).toThrow();
  });
  test("passes when allowedOrigins is set", () => {
    expect(() =>
      assertOriginGuardConfig({ cookieDomain: "example.eu", allowedOrigins: [ALLOWED] }),
    ).not.toThrow();
  });
  test("passes when explicitly opted out", () => {
    expect(() =>
      assertOriginGuardConfig({ cookieDomain: "example.eu", unsafeSkipOriginCheck: true }),
    ).not.toThrow();
  });
  test("throws on contradictory opt-out + non-empty allowedOrigins (flag would be ignored)", () => {
    expect(() =>
      assertOriginGuardConfig({ allowedOrigins: [ALLOWED], unsafeSkipOriginCheck: true }),
    ).toThrow(/unsafeSkipOriginCheck/);
    // also throws even without a cookieDomain — the contradiction is independent
    expect(() =>
      assertOriginGuardConfig({
        cookieDomain: "example.eu",
        allowedOrigins: [ALLOWED],
        unsafeSkipOriginCheck: true,
      }),
    ).toThrow(/unsafeSkipOriginCheck/);
  });
  test("passes when no cookieDomain (host-only cookie) or no auth at all", () => {
    expect(() => assertOriginGuardConfig({})).not.toThrow();
    expect(() => assertOriginGuardConfig(undefined)).not.toThrow();
  });
});

describe("originMiddleware", () => {
  test("bearer transport skips the check even on a disallowed-origin POST", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Origin: DISALLOWED },
    });
    expect(res.status).toBe(200);
  });

  test("cookie transport + GET → no check (safe method)", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/ping", {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}`, Origin: DISALLOWED },
    });
    expect(res.status).toBe(200);
  });

  test("cookie transport + POST + allowed origin → ok", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}`, Origin: ALLOWED },
    });
    expect(res.status).toBe(200);
  });

  test("cookie transport + POST + disallowed origin → 403 origin_not_allowed", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}`, Origin: DISALLOWED },
    });
    expect(res.status).toBe(403);
    expect(await readErrorCode(res)).toBe("origin_not_allowed");
  });

  // The guard runs as /api/* middleware before routing, so a disallowed-origin
  // request is rejected for every state-changing method even without a route.
  test.each([
    "PUT",
    "PATCH",
    "DELETE",
  ])("cookie transport + %s + disallowed origin → 403 (every state-changing method)", async (method) => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method,
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}`, Origin: DISALLOWED },
    });
    expect(res.status).toBe(403);
    expect(await readErrorCode(res)).toBe("origin_not_allowed");
  });

  test("disallowed origin is blocked even as a simple text/plain request", async () => {
    // The real vector: a `text/plain` POST skips the CORS preflight and reaches
    // the server, where only the Origin check stands between it and the handler.
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${token}`,
        Origin: DISALLOWED,
        "Content-Type": "text/plain",
      },
      body: "type=x",
    });
    expect(res.status).toBe(403);
  });

  test("cookie transport + POST + no Origin → passes (CSRF token is the next layer)", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
  });

  test("no Origin + Sec-Fetch-Site: same-origin → passes", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}`, "Sec-Fetch-Site": "same-origin" },
    });
    expect(res.status).toBe(200);
  });

  // same-site is passed through by design (the CSRF token is the next layer);
  // the realistic same-site XSS attack carries an Origin header and is rejected
  // by the allowlist branch before this fallback is reached.
  test("no Origin + Sec-Fetch-Site: same-site → passes (intentional, CSRF is next layer)", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}`, "Sec-Fetch-Site": "same-site" },
    });
    expect(res.status).toBe(200);
  });

  test("no Origin + Sec-Fetch-Site: cross-site → 403", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}`, "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(403);
    expect(await readErrorCode(res)).toBe("origin_not_allowed");
  });
});
