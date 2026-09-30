// r.webSocketRoute boot validation + the Bun websocket handler's behavior
// against a recording fake socket. The real upgrade over TCP is covered by
// server-runtime's websocket-route.integration.test.ts.

import { describe, expect, spyOn, test } from "bun:test";
import { createRegistry, defineFeature } from "../../engine";
import type { SessionUser, WebSocketRouteDefinition } from "../../engine/types";
import { requestContext } from "../request-context";
import { buildServer } from "../server";
import {
  buildWebSocketSessionRevalidator,
  isWebSocketUpgradeRequest,
  type KumikoServerWebSocket,
  type KumikoWebSocketData,
  kumikoWebSocketHandler,
  WEBSOCKET_HEARTBEAT_INTERVAL_MS,
} from "../websocket-route";

const JWT_SECRET = "websocket-route-test-secret-min-32-characters";
const MIB = 1024 * 1024;

function routeFeature(name: string, ...routes: readonly Partial<WebSocketRouteDefinition>[]) {
  return defineFeature(name, (r) => {
    for (const route of routes) {
      r.webSocketRoute({ path: "/api/ws/echo", connect: () => ({}), ...route });
    }
  });
}

describe("r.webSocketRoute validation", () => {
  test("accepts a path under /api/ws/ with :param segments and a valid cap", () => {
    expect(() =>
      routeFeature("ok", { path: "/api/ws/rooms/:roomId", maxMessageBytes: MIB }),
    ).not.toThrow();
  });

  test("rejects a path outside /api/ws/", () => {
    expect(() => routeFeature("bad-prefix", { path: "/ws/echo" })).toThrow(/must start with/);
    expect(() => routeFeature("bad-api", { path: "/api/echo" })).toThrow(/must start with/);
  });

  test("rejects wildcards", () => {
    expect(() => routeFeature("wild", { path: "/api/ws/*" })).toThrow(/must not contain "\*"/);
  });

  test.each([0, MIB + 1, 1.5, Number.NaN, -1])("rejects maxMessageBytes %p", (maxMessageBytes) => {
    expect(() => routeFeature("cap", { maxMessageBytes })).toThrow(/maxMessageBytes/);
  });

  test("rejects a duplicate path within a feature", () => {
    expect(() => routeFeature("dup", { path: "/api/ws/a" }, { path: "/api/ws/a" })).toThrow(
      /already registered/,
    );
  });

  test("buildServer rejects the same path in two features", () => {
    const registry = createRegistry([
      routeFeature("first", { path: "/api/ws/shared" }),
      routeFeature("second", { path: "/api/ws/shared" }),
    ]);
    expect(() => buildServer({ registry, context: {}, jwtSecret: JWT_SECRET })).toThrow(
      /declared by both feature "first" and "second"/,
    );
  });
});

describe("isWebSocketUpgradeRequest", () => {
  test("matches the Upgrade header case-insensitively", () => {
    const upgrade = (value: string) =>
      isWebSocketUpgradeRequest(new Request("http://x/", { headers: { Upgrade: value } }));
    expect(upgrade("websocket")).toBe(true);
    expect(upgrade("WebSocket")).toBe(true);
    expect(upgrade("h2c")).toBe(false);
    expect(isWebSocketUpgradeRequest(new Request("http://x/"))).toBe(false);
  });
});

describe("buildWebSocketSessionRevalidator", () => {
  const user: SessionUser = {
    id: "user-1",
    tenantId: "tenant-1" as SessionUser["tenantId"],
    roles: ["User", "Admin"],
    sid: "sid-1",
  };
  const live = (roles?: readonly string[]) => async () =>
    roles ? { status: "live" as const, roles } : ("live" as const);

  test("undefined when neither a checker nor a lifecycle resolver is wired", () => {
    expect(buildWebSocketSessionRevalidator({ user })).toBeUndefined();
  });

  test("live session with the same roles (any order) stays open", async () => {
    const check = buildWebSocketSessionRevalidator({
      user,
      sessionChecker: live(["Admin", "User"]),
    });
    expect(await check?.()).toBe(true);
  });

  test("bare live (no derived roles) stays open", async () => {
    expect(await buildWebSocketSessionRevalidator({ user, sessionChecker: live() })?.()).toBe(true);
  });

  test("revoked session closes", async () => {
    const check = buildWebSocketSessionRevalidator({
      user,
      sessionChecker: async () => "revoked",
    });
    expect(await check?.()).toBe(false);
  });

  test("changed roles close", async () => {
    const fewer = buildWebSocketSessionRevalidator({ user, sessionChecker: live(["User"]) });
    const more = buildWebSocketSessionRevalidator({
      user,
      sessionChecker: live(["User", "Admin", "Auditor"]),
    });
    expect(await fewer?.()).toBe(false);
    expect(await more?.()).toBe(false);
  });

  test("tenant in teardown closes, a serving tenant stays open", async () => {
    const status = { current: "active" };
    const check = buildWebSocketSessionRevalidator({
      user,
      resolveTenantLifecycleStatus: async () => ({ status: status.current }),
    });
    expect(await check?.()).toBe(true);
    status.current = "destroying";
    expect(await check?.()).toBe(false);
  });
});

type SocketLog = {
  readonly sent: (string | Uint8Array)[];
  readonly closed: { code?: number; reason?: string }[];
  pings: number;
};

function fakeSocket(data: Partial<KumikoWebSocketData>): {
  ws: KumikoServerWebSocket;
  log: SocketLog;
} {
  const log: SocketLog = { sent: [], closed: [], pings: 0 };
  const ws: KumikoServerWebSocket = {
    data: {
      handlers: {},
      maxMessageBytes: 1024,
      requestContextData: undefined,
      revalidateSession: undefined,
      ...data,
    },
    send: (payload) => {
      log.sent.push(payload);
    },
    close: (code, reason) => {
      log.closed.push({
        ...(code !== undefined ? { code } : {}),
        ...(reason !== undefined ? { reason } : {}),
      });
    },
    ping: () => {
      log.pings += 1;
    },
  };
  return { ws, log };
}

// The handler wraps every callback in an async guard; awaiting a macrotask
// lets those settle without timers that could mask a bug.
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("kumikoWebSocketHandler", () => {
  test("message over the cap closes with 1009 and never reaches the handler", async () => {
    const received: unknown[] = [];
    const { ws, log } = fakeSocket({
      maxMessageBytes: 4,
      handlers: { onMessage: (data) => void received.push(data) },
    });
    kumikoWebSocketHandler.message(ws, "12345");
    kumikoWebSocketHandler.message(ws, new Uint8Array(5));
    await settle();
    expect(received).toEqual([]);
    expect(log.closed).toEqual([
      { code: 1009, reason: "message too big" },
      { code: 1009, reason: "message too big" },
    ]);
  });

  test("the cap counts UTF-8 bytes, not characters", () => {
    const { ws, log } = fakeSocket({ maxMessageBytes: 4 });
    kumikoWebSocketHandler.message(ws, "äää");
    expect(log.closed[0]?.code).toBe(1009);
  });

  test("binary messages arrive as an exact-length Uint8Array copy", async () => {
    const pool = new Uint8Array([9, 9, 1, 2, 3, 9]);
    const view = Buffer.from(pool.buffer, 2, 3);
    const messages: (string | Uint8Array)[] = [];
    const { ws } = fakeSocket({ handlers: { onMessage: (data) => void messages.push(data) } });
    kumikoWebSocketHandler.message(ws, view);
    await settle();
    const received = messages[0];
    if (!(received instanceof Uint8Array)) throw new Error("expected binary data");
    expect(Array.from(received)).toEqual([1, 2, 3]);
    expect(received.buffer).not.toBe(pool.buffer);
  });

  test("a throwing or rejecting handler closes with 1011 instead of an unhandled rejection", async () => {
    const errorLog = spyOn(console, "error").mockImplementation(() => {});
    try {
      const sync = fakeSocket({
        handlers: {
          onMessage: () => {
            throw new Error("boom");
          },
        },
      });
      kumikoWebSocketHandler.message(sync.ws, "x");
      const rejected = fakeSocket({
        handlers: { onOpen: () => Promise.reject(new Error("nope")) },
      });
      kumikoWebSocketHandler.open(rejected.ws);
      await settle();
      kumikoWebSocketHandler.close(rejected.ws, 1006, "");
      expect(sync.log.closed).toEqual([{ code: 1011, reason: "internal error" }]);
      expect(rejected.log.closed).toEqual([{ code: 1011, reason: "internal error" }]);
    } finally {
      errorLog.mockRestore();
    }
  });

  test("handlers run inside the captured request context", async () => {
    const seenRequestIds: (string | undefined)[] = [];
    const { ws } = fakeSocket({
      requestContextData: { requestId: "req-1", correlationId: "corr-1" },
      handlers: { onMessage: () => void seenRequestIds.push(requestContext.get()?.requestId) },
    });
    kumikoWebSocketHandler.message(ws, "x");
    await settle();
    expect(seenRequestIds).toEqual(["req-1"]);
  });

  describe("heartbeat", () => {
    function captureHeartbeat(ws: KumikoServerWebSocket) {
      const setSpy = spyOn(globalThis, "setInterval");
      const clearSpy = spyOn(globalThis, "clearInterval");
      let tick: (() => void) | undefined;
      let delay: number | undefined;
      setSpy.mockImplementation(((callback: () => void, ms: number) => {
        tick = callback;
        delay = ms;
        return 42;
      }) as unknown as typeof setInterval);
      clearSpy.mockImplementation((() => {}) as unknown as typeof clearInterval);
      kumikoWebSocketHandler.open(ws);
      return {
        tick: () => tick?.(),
        delay,
        cleared: () => clearSpy.mock.calls.length,
        restore: () => {
          setSpy.mockRestore();
          clearSpy.mockRestore();
        },
      };
    }

    test("pings on the heartbeat cadence and stops on close", () => {
      const { ws, log } = fakeSocket({});
      const heartbeat = captureHeartbeat(ws);
      try {
        expect(heartbeat.delay).toBe(WEBSOCKET_HEARTBEAT_INTERVAL_MS);
        heartbeat.tick();
        expect(log.pings).toBe(1);
        kumikoWebSocketHandler.close(ws, 1000, "bye");
        expect(heartbeat.cleared()).toBe(1);
      } finally {
        heartbeat.restore();
      }
    });

    test("closes with 1008 once the session is no longer live", async () => {
      let live = true;
      const { ws, log } = fakeSocket({ revalidateSession: async () => live });
      const heartbeat = captureHeartbeat(ws);
      try {
        heartbeat.tick();
        await settle();
        expect(log.closed).toEqual([]);
        live = false;
        heartbeat.tick();
        await settle();
        expect(log.closed).toEqual([{ code: 1008, reason: "session changed" }]);
      } finally {
        heartbeat.restore();
      }
    });

    test("a failing session check keeps the socket open", async () => {
      const errorLog = spyOn(console, "error").mockImplementation(() => {});
      const { ws, log } = fakeSocket({
        revalidateSession: () => Promise.reject(new Error("db down")),
      });
      const heartbeat = captureHeartbeat(ws);
      try {
        heartbeat.tick();
        await settle();
        expect(log.closed).toEqual([]);
      } finally {
        heartbeat.restore();
        errorLog.mockRestore();
      }
    });
  });
});
