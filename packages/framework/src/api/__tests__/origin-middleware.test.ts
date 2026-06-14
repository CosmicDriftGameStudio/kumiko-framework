// origin-middleware: server-side Origin-allowlist guard layered behind
// authMiddleware. Covers the production-relevant paths: cookie + state-
// changing (allowed/disallowed/simple-request/opaque), cookie + safe method,
// bearer transport, and the no-Origin Sec-Fetch-Site fallback.

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { TestUsers } from "../../stack";
import { AUTH_COOKIE_NAME, authMiddleware } from "../auth-middleware";
import { createJwtHelper } from "../jwt";
import { isOriginAllowed, normalizeOrigin, originMiddleware } from "../origin-middleware";

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
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("origin_not_allowed");
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

  test("no Origin + Sec-Fetch-Site: cross-site → 403", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}`, "Sec-Fetch-Site": "cross-site" },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("origin_not_allowed");
  });
});
