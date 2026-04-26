import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  type TenantId,
} from "../../engine";
import { createTestUser, TestUsers } from "../../testing/fixtures";
import { buildServer } from "../server";

const JWT_SECRET = "test-secret-at-least-32-chars-long!!";

const testFeature = defineFeature("test", (r) => {
  r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));

  r.writeHandler(
    "item:create",
    z.object({ name: z.string().min(1) }),
    async (event) => ({ isSuccess: true, data: { name: event.payload.name } }),
    { access: { roles: ["Admin"] } },
  );

  r.queryHandler(
    "item:list",
    z.object({ search: z.string().optional() }),
    async () => [{ id: 1, name: "Test" }],
    { access: { openToAll: true } },
  );
});

const registry = createRegistry([testFeature]);
const { app, jwt } = buildServer({ registry, context: {}, jwtSecret: JWT_SECRET });

const adminUser = TestUsers.admin;
const guestUser = createTestUser({ id: 2, roles: ["Guest"] });

async function authHeader(user: {
  id: string;
  tenantId: TenantId;
  roles: readonly string[];
}): Promise<Record<string, string>> {
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
    const res = await req("POST", "/api/write", {
      type: "test:write:item:create",
      payload: { name: "x" },
    });
    expect(res.status).toBe(401);
  });

  test("rejects invalid token", async () => {
    const res = await req(
      "POST",
      "/api/write",
      { type: "test:write:item:create", payload: { name: "x" } },
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
      { type: "test:write:item:create", payload: { name: "Test" } },
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
      { type: "test:write:item:create", payload: { name: "Hello" } },
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
      { type: "test:write:item:create", payload: { name: "" } },
      headers,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "validation_error", i18nKey: expect.any(String) });
  });

  test("returns 403 for access denied", async () => {
    const headers = await authHeader(guestUser);
    const res = await req(
      "POST",
      "/api/write",
      { type: "test:write:item:create", payload: { name: "Test" } },
      headers,
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "access_denied" });
  });
});

// --- Query ---

describe("POST /api/query", () => {
  test("dispatches query and returns data", async () => {
    const headers = await authHeader(adminUser);
    const res = await req(
      "POST",
      "/api/query",
      { type: "test:query:item:list", payload: {} },
      headers,
    );

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
      { type: "test:write:item:create", payload: { name: "Fire" } },
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
      { type: "test:write:item:create", payload: { name: "x" } },
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

// --- r.httpRoute (feature-deklarierte HTTP-Routes außerhalb /api/) ---

describe("feature-declared HTTP routes (r.httpRoute)", () => {
  // Eigenes buildServer-Setup mit einem Feature das eine Route deklariert.
  // Pinst die Verdrahtung end-to-end: r.httpRoute → registry → buildServer
  // → Hono-app.{get,post}(path) → Response. deps.app erlaubt internal-call
  // an /api/* (gleicher Auth-Pfad wie ein echter HTTP-Call).
  const routeFeature = defineFeature("routes", (r) => {
    r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
    r.queryHandler("item:list", z.object({}), async () => [{ id: 7 }], {
      access: { openToAll: true },
    });
    r.httpRoute({
      method: "GET",
      path: "/version",
      anonymous: true,
      handler: (c) => c.json({ version: "1.2.3" }),
    });
    r.httpRoute({
      method: "GET",
      path: "/probe-deps",
      anonymous: true,
      handler: (c, deps) => {
        // Beweist dass deps.app die Hono-App-Instanz ist — Handler kann
        // sie für internal app.fetch(...)-Calls nutzen (typischer
        // Use-Case: feed.xml ruft /api/query intern auf).
        return c.json({
          hasApp: typeof deps.app === "object" && typeof deps.app.fetch === "function",
        });
      },
    });
  });
  const routeRegistry = createRegistry([routeFeature]);
  const { app: routeApp } = buildServer({
    registry: routeRegistry,
    context: {},
    jwtSecret: JWT_SECRET,
  });

  test("GET /version returnt deklarierten JSON-Response", async () => {
    const res = await routeApp.request("/version");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: "1.2.3" });
  });

  test("Handler bekommt deps.app — Hono-Instance für internal-fetch", async () => {
    const res = await routeApp.request("/probe-deps");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hasApp: boolean };
    expect(body.hasApp).toBe(true);
  });

  test("Boot-Validator: Route auf /api/* ist verboten", () => {
    expect(() =>
      defineFeature("bad", (r) => {
        r.httpRoute({
          method: "GET",
          path: "/api/forbidden",
          handler: (c) => c.text("nope"),
        });
      }),
    ).toThrow(/\/api\/\* namespace.*reserved/);
  });

  test("Boot-Validator: doppelte method+path-Combo wird abgelehnt", () => {
    expect(() =>
      defineFeature("dup", (r) => {
        r.httpRoute({ method: "GET", path: "/x", handler: (c) => c.text("a") });
        r.httpRoute({ method: "GET", path: "/x", handler: (c) => c.text("b") });
      }),
    ).toThrow(/already registered/);
  });
});
