// csrf-middleware: double-submit token check against a Hono app that
// layers authMiddleware → csrfMiddleware → handler. Covers the paths that
// matter in production: cookie + state-changing, cookie + safe, bearer.

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { TestUsers } from "../../stack";
import {
  AUTH_COOKIE_NAME,
  authMiddleware,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "../auth-middleware";
import { csrfMiddleware } from "../csrf-middleware";
import { createJwtHelper } from "../jwt";

const JWT_SECRET = "csrf-middleware-test-secret-min-32-characters-long";
const CSRF = "csrf-token-fixed-for-test";

async function buildApp(): Promise<{ app: Hono; token: string }> {
  const jwt = createJwtHelper(JWT_SECRET);
  const token = await jwt.sign(TestUsers.user);
  const app = new Hono();
  app.use("/api/*", authMiddleware(jwt));
  app.use("/api/*", csrfMiddleware());
  app.get("/api/ping", (c) => c.json({ ok: true }));
  app.post("/api/write", (c) => c.json({ ok: true }));
  return { app, token };
}

describe("csrf-middleware", () => {
  test("bearer transport skips csrf check even on POST", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  test("cookie transport + GET → no csrf check (safe method)", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/ping", {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
  });

  test("cookie transport + POST + matching csrf → ok", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${token}; ${CSRF_COOKIE_NAME}=${CSRF}`,
        [CSRF_HEADER_NAME]: CSRF,
      },
    });
    expect(res.status).toBe(200);
  });

  test("cookie transport + POST + missing header → 403", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${token}; ${CSRF_COOKIE_NAME}=${CSRF}`,
      },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("csrf_token_mismatch");
  });

  test("cookie transport + POST + wrong header → 403", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${token}; ${CSRF_COOKIE_NAME}=${CSRF}`,
        [CSRF_HEADER_NAME]: "wrong-value",
      },
    });
    expect(res.status).toBe(403);
  });

  test("cookie transport + POST + missing csrf cookie → 403", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/write", {
      method: "POST",
      headers: {
        Cookie: `${AUTH_COOKIE_NAME}=${token}`,
        [CSRF_HEADER_NAME]: CSRF,
      },
    });
    expect(res.status).toBe(403);
  });
});
