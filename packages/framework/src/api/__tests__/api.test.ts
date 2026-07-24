import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  type TenantId,
} from "../../engine";
import { createTestUser, TestUsers } from "../../stack";
import { pumpStream } from "../routes";
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

  r.streamHandler(
    "item:tail",
    z.object({ count: z.number().int().min(0) }),
    async function* (query) {
      for (let i = 0; i < query.payload.count; i++) {
        yield { i };
      }
    },
    { access: { roles: ["Admin"] } },
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

// --- pumpStream (SSE pull loop) ---

function fakeSseWriter() {
  const frames: Array<{ event: string; data: string }> = [];
  return {
    frames,
    async writeSSE(message: { event: string; data: string }) {
      frames.push(message);
    },
  };
}

async function* delayedGenerator(values: readonly unknown[], delayMsByIndex: readonly number[]) {
  for (let i = 0; i < values.length; i++) {
    const delay = delayMsByIndex[i] ?? 0;
    if (delay > 0) await Bun.sleep(delay);
    yield values[i];
  }
}

describe("pumpStream", () => {
  test("emits a ping when the handler is slow, then still delivers the pending chunk (no loss)", async () => {
    const writer = fakeSseWriter();
    // heartbeatMs (10) fires before the 40ms-delayed second chunk resolves.
    const gen = delayedGenerator([{ i: 0 }, { i: 1 }], [0, 40]);

    await pumpStream(writer, gen, 10);

    const events = writer.frames.map((f) => f.event);
    expect(events[0]).toBe("chunk");
    expect(events).toContain("ping");
    expect(events.at(-1)).toBe("done");
    // Both chunks arrive despite the ping in between — no chunk dropped.
    const chunkData = writer.frames.filter((f) => f.event === "chunk").map((f) => f.data);
    expect(chunkData).toEqual([JSON.stringify({ i: 0 }), JSON.stringify({ i: 1 })]);
  });

  test("no heartbeat fires when the handler is faster than heartbeatMs — chunks then done", async () => {
    const writer = fakeSseWriter();
    const gen = delayedGenerator([{ i: 0 }, { i: 1 }, { i: 2 }], [0, 0, 0]);

    await pumpStream(writer, gen, 1000);

    expect(writer.frames.map((f) => f.event)).toEqual(["chunk", "chunk", "chunk", "done"]);
  });

  test("a handler generator that throws propagates the error instead of swallowing it", async () => {
    const writer = fakeSseWriter();
    async function* throwing() {
      yield { i: 0 };
      throw new Error("handler-boom");
    }

    await expect(pumpStream(writer, throwing(), 1000)).rejects.toThrow("handler-boom");
    // The chunk before the throw still made it out.
    expect(writer.frames.map((f) => f.event)).toEqual(["chunk"]);
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

// --- Stream (dispatcher-driven SSE) ---

function parseSseFrames(text: string): Array<{ event: string; data: string }> {
  return text
    .split("\n\n")
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => {
      const event = /^event: (.*)$/m.exec(frame)?.[1] ?? "";
      const data = /^data: (.*)$/m.exec(frame)?.[1] ?? "";
      return { event, data };
    });
}

describe("POST /api/stream", () => {
  test("dispatches stream handler and yields chunk frames then done", async () => {
    const headers = await authHeader(adminUser);
    const res = await req(
      "POST",
      "/api/stream",
      { type: "test:stream:item:tail", payload: { count: 3 } },
      headers,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const frames = parseSseFrames(await res.text());
    expect(frames).toEqual([
      { event: "chunk", data: JSON.stringify({ i: 0 }) },
      { event: "chunk", data: JSON.stringify({ i: 1 }) },
      { event: "chunk", data: JSON.stringify({ i: 2 }) },
      { event: "done", data: "" },
    ]);
  });

  test("access-denied gate surfaces as an error frame, not an HTTP error status", async () => {
    // Dispatch gates (feature/rate-limit/access/validation) fire on the
    // generator's first pull, which happens after SSE headers are already
    // flushed — so an access-denied mid-stream stays HTTP 200.
    const headers = await authHeader(guestUser);
    const res = await req(
      "POST",
      "/api/stream",
      { type: "test:stream:item:tail", payload: { count: 1 } },
      headers,
    );

    expect(res.status).toBe(200);
    const frames = parseSseFrames(await res.text());
    expect(frames).toHaveLength(1);
    expect(frames[0]?.event).toBe("error");
    expect(JSON.parse(frames[0]?.data ?? "{}")).toMatchObject({ code: "access_denied" });
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

  test("Handler kann via deps.app intern /api/query aufrufen (anonymous + defaultTenantId)", async () => {
    // Realistischer Use-Case (publicstatus feed.xml): die r.httpRoute
    // baut eine View aus internen /api/query-Daten. Anonymous-Access mit
    // defaultTenantId macht den inner-Call ohne Bearer-Token möglich;
    // pinst dass deps.app.fetch identisch zu einem echten HTTP-Call läuft.
    const inner = defineFeature("inner", (r) => {
      r.entity("item", createEntity({ table: "Items", fields: { name: createTextField() } }));
      // Bewusst "anonymous" — openToAll schließt anonymous-User explizit
      // aus (siehe access.ts), damit das Aktivieren von anonymousAccess
      // nicht versehentlich jeden openToAll-Handler public macht.
      r.queryHandler("item:list", z.object({}), async () => [{ id: 42, name: "hello" }], {
        access: { roles: ["anonymous"] },
      });
      r.httpRoute({
        method: "GET",
        path: "/feed",
        anonymous: true,
        handler: async (c, deps) => {
          const queryRes = await deps.app.fetch(
            new Request(`${new URL(c.req.url).origin}/api/query`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "inner:query:item:list", payload: {} }),
            }),
          );
          const body = (await queryRes.json()) as { data?: unknown };
          return c.json({ status: queryRes.status, items: body.data });
        },
      });
    });
    const innerRegistry = createRegistry([inner]);
    const { app: innerApp } = buildServer({
      registry: innerRegistry,
      context: {},
      jwtSecret: JWT_SECRET,
      anonymousAccess: {
        defaultTenantId: "00000000-0000-4000-8000-000000000000" as TenantId,
      },
    });

    const res = await innerApp.request("/feed");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: number; items: unknown };
    expect(body.status).toBe(200);
    expect(body.items).toEqual([{ id: 42, name: "hello" }]);
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
