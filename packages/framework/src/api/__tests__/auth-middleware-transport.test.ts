// auth-middleware: cookie + bearer + reject-both. Pure-logic unit tests
// against a hand-rolled Hono app — no DB, no dispatcher. Exercises the
// transport-extraction path that drives the csrf-middleware downstream.

import { Hono } from "hono";
import { describe, expect, test } from "vitest";
import { TestUsers } from "../../testing/fixtures";
import { AUTH_COOKIE_NAME, authMiddleware, getAuthTransport, getUser } from "../auth-middleware";
import { createJwtHelper } from "../jwt";

const JWT_SECRET = "auth-middleware-transport-test-secret-min-32-chars";

async function buildApp(): Promise<{ app: Hono; token: string }> {
  const jwt = createJwtHelper(JWT_SECRET);
  const token = await jwt.sign(TestUsers.user);
  const app = new Hono();
  app.use("/api/*", authMiddleware(jwt));
  app.get("/api/ping", (c) => {
    const user = getUser(c);
    const transport = getAuthTransport(c);
    return c.json({ userId: user.id, transport });
  });
  return { app, token };
}

describe("auth-middleware transport selection", () => {
  test("bearer header authenticates and sets transport=bearer", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/ping", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; transport: string };
    expect(body.userId).toBe(TestUsers.user.id);
    expect(body.transport).toBe("bearer");
  });

  test("auth cookie authenticates and sets transport=cookie", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/ping", {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; transport: string };
    expect(body.userId).toBe(TestUsers.user.id);
    expect(body.transport).toBe("cookie");
  });

  test("both cookie AND bearer → 400 ambiguous_auth", async () => {
    const { app, token } = await buildApp();
    const res = await app.request("/api/ping", {
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: `${AUTH_COOKIE_NAME}=${token}`,
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("ambiguous_auth");
  });

  test("neither cookie nor bearer → 401 missing_token", async () => {
    const { app } = await buildApp();
    const res = await app.request("/api/ping");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("missing_token");
  });

  test("invalid cookie JWT → 401 invalid_token", async () => {
    const { app } = await buildApp();
    const res = await app.request("/api/ping", {
      headers: { Cookie: `${AUTH_COOKIE_NAME}=not-a-real-jwt` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_token");
  });
});
