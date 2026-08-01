import { describe, expect, test } from "bun:test";
import { parseSseFrames } from "@cosmicdrift/kumiko-dispatcher-live";
import { Hono } from "hono";
import { z } from "zod";
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
  type TenantId,
} from "../../engine";
import type { BatchResult, Dispatcher, WriteResult } from "../../pipeline/dispatcher";
import { createTestUser, TestUsers } from "../../stack";
import { waitFor } from "../../testing";
import { createApiRoutes, pumpStream, StreamFrame } from "../routes";
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

  r.streamHandler(
    "item:tail-fail-mid",
    z.object({}),
    async function* () {
      yield { i: 0 };
      yield { i: 1 };
      throw new Error("boom");
    },
    { access: { roles: ["Admin"] } },
  );

  r.streamHandler(
    "item:tail-fail-first",
    z.object({}),
    // biome-ignore lint/correctness/useYield: deliberately throws before any yield — tests the pre-pull failure path
    async function* () {
      throw new Error("boom");
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

  test("closes the generator when writeSSE throws mid-loop (e.g. client disconnected on a ping)", async () => {
    let cleanedUp = false;
    async function* gen() {
      try {
        await Bun.sleep(50);
        yield { i: 0 };
      } finally {
        cleanedUp = true;
      }
    }
    const frames: Array<{ event: string; data: string }> = [];
    const writer = {
      frames,
      async writeSSE(message: { event: string; data: string }) {
        if (message.event === StreamFrame.ping) throw new Error("client disconnected");
        frames.push(message);
      },
    };

    await expect(pumpStream(writer, gen(), 5)).rejects.toThrow("client disconnected");
    // Fire-and-forget cleanup (kumiko-framework#1547): pumpStream's finally
    // no longer awaits generator.return() — it can't, since a still-pending
    // .next() would make that await hang — so cleanedUp flips asynchronously
    // after pumpStream's own rejection, not synchronously before it.
    await waitFor(() => {
      expect(cleanedUp).toBe(true);
    });
  });

  test("does not hang when writeSSE throws while a .next() pull is still in flight", async () => {
    // kumiko-framework#1547: generator.return() queues behind an in-flight
    // .next() (V8 semantics) — an `await generator.return(undefined)` in the
    // finally block would hang for as long as the handler's .next() never
    // settles, which a dead Redis/DB subscription can do indefinitely.
    // `never` intentionally never resolves — the fire-and-forget fix must
    // not need it to.
    const never = new Promise<never>(() => {});
    async function* gen() {
      await never;
      yield { i: 0 };
    }
    const writer = {
      frames: [] as Array<{ event: string; data: string }>,
      async writeSSE(message: { event: string; data: string }) {
        if (message.event === StreamFrame.ping) throw new Error("client disconnected");
        this.frames.push(message);
      },
    };

    const TIMEOUT = Symbol("timeout");
    const outcome = await Promise.race([
      pumpStream(writer, gen(), 5).then(
        () => "resolved",
        (e) => e,
      ),
      Bun.sleep(500).then(() => TIMEOUT),
    ]);
    expect(outcome).not.toBe(TIMEOUT);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe("client disconnected");
  });

  test("serializes an undefined yielded value as an explicit null chunk instead of an invalid frame", async () => {
    const writer = fakeSseWriter();
    async function* gen() {
      yield undefined;
    }

    await pumpStream(writer, gen(), 1000);

    expect(writer.frames[0]).toEqual({ event: StreamFrame.chunk, data: "null" });
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

  test("access-denied gate surfaces as a real 403, not an HTTP 200 error frame", async () => {
    // Dispatch gates (feature/rate-limit/access/validation) run on the
    // generator's first pull, which the route now performs BEFORE opening
    // the SSE response — so a gate failure maps to its real HTTP status
    // instead of a flushed-200 error frame (framework#1517).
    const headers = await authHeader(guestUser);
    const res = await req(
      "POST",
      "/api/stream",
      { type: "test:stream:item:tail", payload: { count: 1 } },
      headers,
    );

    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).not.toContain("text/event-stream");
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "access_denied" });
  });

  test("returns 404 for unknown stream handler", async () => {
    const headers = await authHeader(adminUser);
    const res = await req("POST", "/api/stream", { type: "nope", payload: {} }, headers);

    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).not.toContain("text/event-stream");
  });

  test("returns 400 for schema validation failure", async () => {
    const headers = await authHeader(adminUser);
    const res = await req(
      "POST",
      "/api/stream",
      { type: "test:stream:item:tail", payload: { count: -1 } },
      headers,
    );

    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).not.toContain("text/event-stream");
  });

  test("handler failure after chunks already sent stays HTTP 200 with an error frame", async () => {
    // Boundary between the pre-pull fix and the still-open SSE stream: a
    // failure that happens AFTER the first chunk (headers already flushed)
    // must keep surfacing as a 200 + "error" frame, not a real HTTP status.
    const headers = await authHeader(adminUser);
    const res = await req(
      "POST",
      "/api/stream",
      { type: "test:stream:item:tail-fail-mid", payload: {} },
      headers,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const frames = parseSseFrames(await res.text());
    expect(frames).toHaveLength(3);
    expect(frames.slice(0, 2)).toEqual([
      { event: "chunk", data: JSON.stringify({ i: 0 }) },
      { event: "chunk", data: JSON.stringify({ i: 1 }) },
    ]);
    expect(frames[2]?.event).toBe("error");
    expect(JSON.parse(frames[2]?.data ?? "{}")).toMatchObject({ code: "internal_error" });
  });

  test("handler failure before the first yield surfaces as a real HTTP 500, not an SSE error frame", async () => {
    // Contract-pin for routes.ts's "error frames only reachable once the
    // stream is already open" comment: a generator that throws before its
    // first yield is caught by the same pre-pull gate as feature/access/
    // rate-limit/validation failures — the client sees 500 + JSON, not a
    // 200 with an SSE error frame.
    const headers = await authHeader(adminUser);
    const res = await req(
      "POST",
      "/api/stream",
      { type: "test:stream:item:tail-fail-first", payload: {} },
      headers,
    );

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).not.toContain("text/event-stream");
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "internal_error" });
  });
});

// --- POST /api/stream pre-pull race (framework#1547) ---
// Mount createApiRoutes with a short sseHeartbeatMs so the pre-pull heartbeat
// race is testable without waiting for the production 15s interval.

describe("POST /api/stream pre-pull race", () => {
  const user = createTestUser({ roles: ["Admin"] });

  function stubDispatcher(streamImpl: Dispatcher["stream"]): Dispatcher {
    return {
      async write(): Promise<WriteResult> {
        return { isSuccess: true, data: {} };
      },
      async query(): Promise<unknown> {
        return [];
      },
      stream: streamImpl,
      async command(): Promise<void> {},
      async batch(): Promise<BatchResult> {
        return { isSuccess: true, results: [] };
      },
      async resolveAuthClaims(): Promise<Record<string, unknown>> {
        return {};
      },
    };
  }

  function mountStreamApp(dispatcher: Dispatcher, sseHeartbeatMs: number) {
    const app = new Hono<{ Variables: { pipelineUser: typeof user } }>();
    app.use("/api/*", async (c, next) => {
      c.set("pipelineUser", user);
      await next();
    });
    app.route("/api", createApiRoutes(dispatcher, { sseHeartbeatMs }));
    return app;
  }

  test("slow first next() opens 200 SSE with ping frames instead of hanging as HTTP error", async () => {
    // First .next() takes longer than heartbeatMs → settledInTime=false →
    // streamSSE opens immediately and pumpStream emits ping until the chunk
    // arrives (framework#1547 route-level contract).
    //
    // 25x the heartbeat, not 3x: the assertion rides on the timer winning the
    // race, and a loaded CI runner delays timers by tens of milliseconds. At
    // 60ms the timer occasionally fired after the chunk, the route took the
    // settled path, and the run failed with ["chunk","done"] — a red main that
    // blocks the release job.
    const dispatcher = stubDispatcher(async function* () {
      await Bun.sleep(500);
      yield { i: 0 };
    });
    const app = mountStreamApp(dispatcher, 20);
    const res = await app.request(
      new Request("http://localhost/api/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "any:stream:tail", payload: {} }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const frames = parseSseFrames(await res.text());
    const events = frames.map((f) => f.event);
    expect(events).toContain("ping");
    expect(events).toContain("chunk");
    expect(events.at(-1)).toBe("done");
  });

  test("client abort during pre-pull returns 499 and runs generator cleanup", async () => {
    // Finite sleep (not a never-resolving await): V8 queues .return() behind an
    // in-flight .next(), so cleanup only runs once the pending pull settles.
    // Abort before heartbeatMs so the route hits the 499 branch; sleep then
    // completes and the queued return drains the generator's finally.
    //
    // Abort is triggered off an entry signal, not a fixed sleep margin against
    // the heartbeat timer — a stalled event loop could otherwise let the
    // heartbeat fire first and flip the route onto the 200-SSE branch.
    let cleanedUp = false;
    let entered: () => void;
    const atEntry = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const dispatcher = stubDispatcher(async function* () {
      try {
        entered();
        await Bun.sleep(80);
        yield { i: 0 };
      } finally {
        cleanedUp = true;
      }
    });
    const app = mountStreamApp(dispatcher, 40);
    const ac = new AbortController();
    const pending = app.request(
      new Request("http://localhost/api/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "any:stream:tail", payload: {} }),
        signal: ac.signal,
      }),
    );
    // Abort as soon as the generator has been entered — no timing window left.
    await atEntry;
    ac.abort();
    const res = await pending;
    expect(res.status).toBe(499);
    await waitFor(() => {
      expect(cleanedUp).toBe(true);
    });
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
