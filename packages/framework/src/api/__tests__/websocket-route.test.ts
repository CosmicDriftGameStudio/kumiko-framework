// r.webSocketRoute boot validation + the Bun websocket handler's behavior
// against a recording fake socket. The real upgrade over TCP is covered by
// server-runtime's websocket-route.integration.test.ts.

import { describe, expect, spyOn, test } from "bun:test";
import { createRegistry, defineFeature } from "../../engine";
import type { SessionUser, WebSocketRouteDefinition } from "../../engine/types";
import type { AuthSessionChecker } from "../auth-middleware";
import { requestContext } from "../request-context";
import { buildServer } from "../server";
import {
  buildWebSocketSessionRevalidator,
  createWebSocketConnectionLimiter,
  isWebSocketUpgradeRequest,
  type KumikoServerWebSocket,
  type KumikoWebSocketData,
  kumikoWebSocketHandler,
  WEBSOCKET_HEARTBEAT_INTERVAL_MS,
  WEBSOCKET_REVALIDATION_FAILURE_LIMIT,
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

  test.each([0, 101, 1.5, Number.NaN, -1])(
    "rejects maxConnectionsPerUser %p",
    (maxConnectionsPerUser) => {
      expect(() => routeFeature("conn-cap", { maxConnectionsPerUser })).toThrow(
        /maxConnectionsPerUser/,
      );
    },
  );

  test("accepts maxConnectionsPerUser 1 and 100", () => {
    expect(() => routeFeature("conn-min", { maxConnectionsPerUser: 1 })).not.toThrow();
    expect(() => routeFeature("conn-max", { maxConnectionsPerUser: 100 })).not.toThrow();
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
    expect(await check?.()).toBe("live");
  });

  test("bare live (no derived roles) stays open", async () => {
    expect(await buildWebSocketSessionRevalidator({ user, sessionChecker: live() })?.()).toBe(
      "live",
    );
  });

  test("revoked session closes", async () => {
    const check = buildWebSocketSessionRevalidator({
      user,
      sessionChecker: async () => "revoked",
    });
    expect(await check?.()).toBe("invalid");
  });

  test("changed roles close", async () => {
    const fewer = buildWebSocketSessionRevalidator({ user, sessionChecker: live(["User"]) });
    const more = buildWebSocketSessionRevalidator({
      user,
      sessionChecker: live(["User", "Admin", "Auditor"]),
    });
    expect(await fewer?.()).toBe("invalid");
    expect(await more?.()).toBe("invalid");
  });

  test("tenant in teardown closes, a serving tenant stays open", async () => {
    const status = { current: "active" };
    const check = buildWebSocketSessionRevalidator({
      user,
      resolveTenantLifecycleStatus: async () => ({ status: status.current }),
    });
    expect(await check?.()).toBe("live");
    status.current = "destroying";
    expect(await check?.()).toBe("invalid");
  });

  describe("token expiry", () => {
    const expiresAtSec = 1_000;
    const at = (ms: number) => () => ms;

    test("live before exp, expired at and after exp — without touching the store", async () => {
      const calls: string[] = [];
      const checker: AuthSessionChecker = async () => {
        calls.push("checked");
        return "live";
      };
      const build = (nowMs: number) =>
        buildWebSocketSessionRevalidator({
          user,
          sessionChecker: checker,
          tokenExpiresAtSec: expiresAtSec,
          nowMs: at(nowMs),
        });
      expect(await build(999_999)?.()).toBe("live");
      expect(await build(1_000_000)?.()).toBe("expired");
      expect(await build(2_000_000)?.()).toBe("expired");
      expect(calls).toEqual(["checked"]);
    });

    test("an expiry alone is enough to build a revalidator", () => {
      expect(
        buildWebSocketSessionRevalidator({ user, tokenExpiresAtSec: expiresAtSec }),
      ).toBeDefined();
    });
  });
});

describe("createWebSocketConnectionLimiter", () => {
  test("caps per key, frees a slot on release, and release is idempotent", () => {
    const limiter = createWebSocketConnectionLimiter();
    const first = limiter.tryAcquire("a", 2);
    const second = limiter.tryAcquire("a", 2);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(limiter.tryAcquire("a", 2)).toBeUndefined();
    expect(limiter.tryAcquire("b", 2)).toBeDefined();
    first?.();
    first?.();
    expect(limiter.tryAcquire("a", 2)).toBeDefined();
    expect(limiter.tryAcquire("a", 2)).toBeUndefined();
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
      const { ws, log } = fakeSocket({
        revalidateSession: async () => (live ? "live" : "invalid"),
      });
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

    test("counts unanswered checks as failures, starts no second check, and closes with 1013", async () => {
      const errorLog = spyOn(console, "error").mockImplementation(() => {});
      const started: string[] = [];
      const { ws, log } = fakeSocket({
        revalidateSession: () => {
          started.push("check");
          return new Promise(() => {});
        },
      });
      const heartbeat = captureHeartbeat(ws);
      try {
        // Tick 1 starts the check that never settles; ticks 2..4 find it pending.
        for (let i = 0; i < WEBSOCKET_REVALIDATION_FAILURE_LIMIT; i += 1) {
          heartbeat.tick();
          await settle();
          expect(log.closed).toEqual([]);
        }
        heartbeat.tick();
        await settle();
        expect(started).toEqual(["check"]);
        expect(log.pings).toBe(WEBSOCKET_REVALIDATION_FAILURE_LIMIT + 1);
        expect(log.closed).toEqual([{ code: 1013, reason: "try again later" }]);
      } finally {
        heartbeat.restore();
        errorLog.mockRestore();
      }
    });

    test("an expired token closes with 1008 session expired", async () => {
      const { ws, log } = fakeSocket({ revalidateSession: async () => "expired" });
      const heartbeat = captureHeartbeat(ws);
      try {
        heartbeat.tick();
        await settle();
        expect(log.closed).toEqual([{ code: 1008, reason: "session expired" }]);
      } finally {
        heartbeat.restore();
      }
    });

    test("only consecutive check failures close the socket (1013), a success resets the count", async () => {
      const errorLog = spyOn(console, "error").mockImplementation(() => {});
      const outcomes: ("fail" | "ok")[] = ["fail", "fail", "ok", "fail", "fail"];
      const { ws, log } = fakeSocket({
        revalidateSession: async () => {
          if (outcomes.shift() === "fail") throw new Error("store down");
          return "live";
        },
      });
      const heartbeat = captureHeartbeat(ws);
      try {
        for (let i = 0; i < 5; i += 1) {
          heartbeat.tick();
          await settle();
        }
        expect(log.closed).toEqual([]);

        outcomes.push("fail");
        heartbeat.tick();
        await settle();
        expect(WEBSOCKET_REVALIDATION_FAILURE_LIMIT).toBe(3);
        expect(log.closed).toEqual([{ code: 1013, reason: "try again later" }]);
      } finally {
        heartbeat.restore();
        errorLog.mockRestore();
      }
    });
  });

  describe("per-connection ordering and slot release", () => {
    test("handlers run one after another in arrival order", async () => {
      const events: string[] = [];
      let releaseFirst: () => void = () => {};
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const { ws } = fakeSocket({
        handlers: {
          onMessage: async (data) => {
            events.push(`start:${String(data)}`);
            if (data === "slow") await firstGate;
            events.push(`end:${String(data)}`);
          },
        },
      });
      kumikoWebSocketHandler.message(ws, "slow");
      kumikoWebSocketHandler.message(ws, "fast");
      await settle();
      expect(events).toEqual(["start:slow"]);
      releaseFirst();
      await settle();
      expect(events).toEqual(["start:slow", "end:slow", "start:fast", "end:fast"]);
    });

    test("close runs onClose at once, aborts the signal, and queued messages never start", async () => {
      const events: string[] = [];
      let heldSignal: AbortSignal | undefined;
      const { ws } = fakeSocket({
        handlers: {
          onMessage: (data, connection) => {
            events.push(`start:${String(data)}`);
            heldSignal = connection.signal;
            return new Promise<void>(() => {});
          },
          onClose: (_code, _reason, connection) => {
            events.push(`close:aborted=${connection.signal.aborted}`);
          },
        },
      });
      kumikoWebSocketHandler.message(ws, "hangs");
      kumikoWebSocketHandler.message(ws, "queued");
      await settle();
      expect(heldSignal?.aborted).toBe(false);
      kumikoWebSocketHandler.close(ws, 1000, "");
      await settle();
      kumikoWebSocketHandler.message(ws, "after-close");
      await settle();
      expect(events).toEqual(["start:hangs", "close:aborted=true"]);
      expect(heldSignal?.aborted).toBe(true);
    });

    test("a failing handler closes with 1011 and onClose still runs afterwards", async () => {
      const errorLog = spyOn(console, "error").mockImplementation(() => {});
      const events: string[] = [];
      const { ws, log } = fakeSocket({
        handlers: {
          onMessage: () => {
            throw new Error("boom");
          },
          onClose: () => void events.push("close"),
        },
      });
      try {
        kumikoWebSocketHandler.message(ws, "x");
        await settle();
        expect(log.closed).toEqual([{ code: 1011, reason: "internal error" }]);
        kumikoWebSocketHandler.close(ws, 1006, "");
        await settle();
        expect(events).toEqual(["close"]);
      } finally {
        errorLog.mockRestore();
      }
    });

    test("a throwing onClose is logged, not rethrown", async () => {
      const errorLog = spyOn(console, "error").mockImplementation(() => {});
      const { ws, log } = fakeSocket({
        handlers: {
          onClose: () => {
            throw new Error("cleanup failed");
          },
        },
      });
      try {
        kumikoWebSocketHandler.close(ws, 1000, "");
        await settle();
        expect(log.closed).toEqual([]);
        expect(errorLog).toHaveBeenCalled();
      } finally {
        errorLog.mockRestore();
      }
    });

    test("close frees the connection slot", () => {
      const released: string[] = [];
      const { ws } = fakeSocket({ releaseConnectionSlot: () => void released.push("released") });
      kumikoWebSocketHandler.close(ws, 1000, "");
      expect(released).toEqual(["released"]);
    });
  });
});
