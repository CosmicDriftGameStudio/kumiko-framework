import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  type SessionUser,
} from "../../engine";
import { buildServer } from "../server";

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";

const testFeature = defineFeature("test", (r) => {
  r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));

  r.writeHandler(
    "item.create",
    z.object({ name: z.string().min(1) }),
    async (event) => ({ isSuccess: true, data: { name: event.payload.name } }),
    { access: { roles: ["Admin"] } },
  );

  r.queryHandler("item.list", z.object({ search: z.string().optional() }), async () => [
    { id: 1, name: "Test" },
  ]);
});

const registry = createRegistry([testFeature]);
const { app, jwt } = buildServer({ registry, context: {}, jwtSecret: JWT_SECRET });

const adminUser: SessionUser = { id: 1, tenantId: 1, roles: ["Admin"] };
const guestUser: SessionUser = { id: 2, tenantId: 1, roles: ["Guest"] };

async function authHeader(user: SessionUser): Promise<Record<string, string>> {
  const token = await jwt.sign(user);
  return { Authorization: `Bearer ${token}` };
}

function req(method: string, path: string, body?: unknown, headers?: Record<string, string>) {
  const init: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body) init.body = JSON.stringify(body);
  return app.request(path, init);
}

// --- Health ---

describe("health", () => {
  test("GET /health returns ok", async () => {
    const res = await req("GET", "/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

// --- Auth ---

describe("auth middleware", () => {
  test("rejects request without token", async () => {
    const res = await req("POST", "/api/write", { type: "item.create", payload: { name: "x" } });
    expect(res.status).toBe(401);
  });

  test("rejects invalid token", async () => {
    const res = await req(
      "POST",
      "/api/write",
      { type: "item.create", payload: { name: "x" } },
      {
        Authorization: "Bearer invalid.token.here",
      },
    );
    expect(res.status).toBe(401);
  });

  test("accepts valid token", async () => {
    const headers = await authHeader(adminUser);
    const res = await req(
      "POST",
      "/api/write",
      { type: "item.create", payload: { name: "Test" } },
      headers,
    );
    expect(res.status).toBe(200);
  });
});

// --- Write ---

describe("POST /api/write", () => {
  test("dispatches write and returns result", async () => {
    const headers = await authHeader(adminUser);
    const res = await req(
      "POST",
      "/api/write",
      { type: "item.create", payload: { name: "Hello" } },
      headers,
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isSuccess).toBe(true);
    expect(body.data.name).toBe("Hello");
  });

  test("returns 400 for validation error", async () => {
    const headers = await authHeader(adminUser);
    const res = await req(
      "POST",
      "/api/write",
      { type: "item.create", payload: { name: "" } },
      headers,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.isSuccess).toBe(false);
  });

  test("returns 400 for access denied", async () => {
    const headers = await authHeader(guestUser);
    const res = await req(
      "POST",
      "/api/write",
      { type: "item.create", payload: { name: "Test" } },
      headers,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("access");
  });
});

// --- Query ---

describe("POST /api/query", () => {
  test("dispatches query and returns data", async () => {
    const headers = await authHeader(adminUser);
    const res = await req("POST", "/api/query", { type: "item.list", payload: {} }, headers);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([{ id: 1, name: "Test" }]);
  });

  test("returns 404 for unknown query", async () => {
    const headers = await authHeader(adminUser);
    const res = await req("POST", "/api/query", { type: "nope", payload: {} }, headers);
    expect(res.status).toBe(404);
  });
});

// --- Command ---

describe("POST /api/command", () => {
  test("dispatches command and returns 202", async () => {
    const headers = await authHeader(adminUser);
    const res = await req(
      "POST",
      "/api/command",
      { type: "item.create", payload: { name: "Fire" } },
      headers,
    );

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("returns 403 for access denied", async () => {
    const headers = await authHeader(guestUser);
    const res = await req(
      "POST",
      "/api/command",
      { type: "item.create", payload: { name: "x" } },
      headers,
    );
    expect(res.status).toBe(403);
  });
});

// --- SSE ---

describe("GET /api/sse", () => {
  test("rejects without auth", async () => {
    const res = await app.request("/api/sse");
    expect(res.status).toBe(401);
  });

  test("returns event stream with auth", async () => {
    const headers = await authHeader(adminUser);
    const res = await app.request("/api/sse", { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });
});
