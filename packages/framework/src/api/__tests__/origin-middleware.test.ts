// origin-middleware: server-side Origin-allowlist guard layered behind
// authMiddleware. Covers the production-relevant paths: cookie + state-
// changing (allowed/disallowed/simple-request/opaque, all four methods),
// cookie + safe method, bearer transport, the no-Origin Sec-Fetch-Site
// fallback, and the fail-closed boot check.

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { TestUsers } from "../../stack/index.js";
import { AUTH_COOKIE_NAME, authMiddleware } from "../auth-middleware.js";
import { createJwtHelper } from "../jwt.js";
import {
  assertOriginGuardConfig,
  isOriginAllowed,
  isWebSocketOriginAllowed,
  normalizeOrigin,
  originMiddleware,
} from "../origin-middleware.js";

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
  test.each(["PUT", "PATCH", "DELETE"])(
    "cookie transport + %s + disallowed origin → 403 (every state-changing method)",
    async (method) => {
      const { app, token } = await buildApp();
      const res = await app.request("/api/write", {
        method,
        headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}`, Origin: DISALLOWED },
      });
      expect(res.status).toBe(403);
      expect(await readErrorCode(res)).toBe("origin_not_allowed");
    },
  );

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

describe("isWebSocketOriginAllowed", () => {
  const HOST = "app.example.eu";
  const SAME_HOST_ORIGIN = `https://${HOST}`;
  const allowlist: ReadonlySet<string> = new Set([normalizeOrigin(ALLOWED)]);

  // Probe route: reports the predicate's verdict for the request it received.
  async function verdict(
    headers: Record<string, string>,
    list: ReadonlySet<string> | undefined,
    transport: "cookie" | "bearer" = "cookie",
  ): Promise<boolean> {
    const jwt = createJwtHelper(JWT_SECRET);
    const token = await jwt.sign(TestUsers.user);
    const app = new Hono();
    app.use("/api/*", authMiddleware(jwt));
    app.get("/api/ws/probe", (c) => c.json({ allowed: isWebSocketOriginAllowed(c, list) }));
    const auth: Record<string, string> =
      transport === "cookie"
        ? { Cookie: `${AUTH_COOKIE_NAME}=${token}` }
        : { Authorization: `Bearer ${token}` };
    const res = await app.request("/api/ws/probe", {
      headers: { Host: HOST, ...auth, ...headers },
    });
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || !("allowed" in body)) {
      throw new Error(`unexpected probe body ${JSON.stringify(body)}`);
    }
    return body.allowed === true;
  }

  test("bearer transport is always allowed, even with a foreign Origin", async () => {
    expect(await verdict({ Origin: DISALLOWED }, allowlist, "bearer")).toBe(true);
    expect(await verdict({}, undefined, "bearer")).toBe(true);
  });

  test("cookie without Origin header is rejected", async () => {
    expect(await verdict({}, undefined)).toBe(false);
    expect(await verdict({}, allowlist)).toBe(false);
  });

  test("Origin 'null' and unparsable origins are rejected", async () => {
    expect(await verdict({ Origin: "null" }, undefined)).toBe(false);
    expect(await verdict({ Origin: "not a url" }, undefined)).toBe(false);
  });

  test("non-empty allowlist: listed origin passes, case/trailing slash normalized", async () => {
    expect(await verdict({ Origin: ALLOWED }, allowlist)).toBe(true);
    expect(await verdict({ Origin: `${ALLOWED.toUpperCase()}/` }, allowlist)).toBe(true);
    expect(await verdict({ Origin: DISALLOWED }, allowlist)).toBe(false);
  });

  test("non-empty allowlist has no same-host fallback", async () => {
    expect(await verdict({ Origin: SAME_HOST_ORIGIN }, allowlist)).toBe(false);
  });

  test("empty or absent allowlist: same host passes (case-insensitive), other host fails", async () => {
    expect(await verdict({ Origin: SAME_HOST_ORIGIN }, undefined)).toBe(true);
    expect(await verdict({ Origin: SAME_HOST_ORIGIN }, new Set())).toBe(true);
    expect(await verdict({ Origin: `https://${HOST.toUpperCase()}` }, undefined)).toBe(true);
    expect(await verdict({ Origin: DISALLOWED }, undefined)).toBe(false);
    expect(await verdict({ Origin: `https://${HOST}:8443` }, undefined)).toBe(false);
  });
});
