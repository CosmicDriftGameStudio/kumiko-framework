// r.webSocketRoute over a real Bun.serve socket: upgrade guards (origin,
// session, upgrade header), connect-time rejection, and the live message
// path (text/binary echo, size cap, handler failure). anonymousAccess is wired
// on purpose (see http-route-entry.integration.test.ts): without it a route
// mounted behind the wrong guard would 401 on a missing token too, masking the
// bug the "no session" test exists to catch.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AUTH_COOKIE_NAME, type KumikoWebSocketData } from "@cosmicdrift/kumiko-framework/api";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStack, type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { buildBunServeOptions } from "../bun-serve-options";

const APP_ORIGIN = "https://app.example";
const EVIL_ORIGIN = "https://evil.example";
const MAX_MESSAGE_BYTES = 1024;
const membershipQuery = "tenant:query:memberships";

const wsFeature = defineFeature("ws-test", (r) => {
  r.webSocketRoute({
    path: "/api/ws/echo",
    maxMessageBytes: MAX_MESSAGE_BYTES,
    connect: (_c, { user }) => ({
      onOpen: (connection) => connection.send(JSON.stringify({ userId: user.id })),
      onMessage: (data, connection) => connection.send(data),
    }),
  });
  r.webSocketRoute({
    path: "/api/ws/rejected",
    connect: () => new Response(null, { status: 409 }),
  });
  r.webSocketRoute({
    path: "/api/ws/explosive",
    connect: () => ({
      onMessage: () => {
        throw new Error("handler failure");
      },
    }),
  });
});

function upgradeHeaders(extra: Record<string, string>): Record<string, string> {
  return {
    Connection: "Upgrade",
    Upgrade: "websocket",
    "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Key": Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64"),
    ...extra,
  };
}

async function errorCode(res: Response): Promise<string | undefined> {
  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
  const { error } = body;
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}

// Bun's WebSocket accepts request headers (needed for Cookie/Origin), which lib.dom's typing omits.
const BunWebSocket = WebSocket as unknown as new (
  url: string,
  options: { headers: Record<string, string> },
) => WebSocket;

type ClientSocket = {
  readonly opened: Promise<void>;
  readonly closed: Promise<CloseEvent>;
  readonly next: () => Promise<unknown>;
  readonly send: (data: string | Uint8Array<ArrayBuffer>) => void;
  readonly close: () => void;
};

// Listeners attach at construction so a message sent during the upgrade
// (onOpen) is never lost between "open" and the test's first await.
function connectSocket(url: string, headers: Record<string, string>): ClientSocket {
  const ws = new BunWebSocket(url, { headers });
  ws.binaryType = "arraybuffer";
  const inbox: unknown[] = [];
  const waiters: ((value: unknown) => void)[] = [];
  ws.addEventListener("message", (event) => {
    const waiter = waiters.shift();
    if (waiter) waiter(event.data);
    else inbox.push(event.data);
  });
  return {
    opened: new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => reject(new Error(`WebSocket to ${url} failed`)));
    }),
    closed: new Promise<CloseEvent>((resolve) => ws.addEventListener("close", resolve)),
    next: () =>
      inbox.length > 0
        ? Promise.resolve(inbox.shift())
        : new Promise((resolve) => waiters.push(resolve)),
    send: (data) => ws.send(data),
    close: () => ws.close(),
  };
}

type Harness = {
  readonly stack: TestStack;
  readonly server: Bun.Server<KumikoWebSocketData>;
  readonly httpOrigin: string;
  readonly url: (path: string) => string;
  readonly cookie: (sid?: string) => Promise<string>;
};

async function startHarness(
  authConfig: Parameters<typeof setupTestStack>[0]["authConfig"],
): Promise<Harness> {
  const stack = await setupTestStack({
    features: [wsFeature],
    anonymousAccess: { defaultTenantId: TestUsers.user.tenantId },
    ...(authConfig ? { authConfig } : {}),
  });
  const server = Bun.serve<KumikoWebSocketData>(
    buildBunServeOptions(
      0,
      (req, socketAddress) => stack.app.fetch(req, socketAddress),
      undefined,
      (req, env) => stack.app.fetch(req, env),
    ),
  );
  return {
    stack,
    server,
    httpOrigin: `http://localhost:${server.port}`,
    url: (path) => `ws://localhost:${server.port}${path}`,
    cookie: async (sid) =>
      `${AUTH_COOKIE_NAME}=${await stack.jwt.sign(sid ? { ...TestUsers.user, sid } : TestUsers.user)}`,
  };
}

async function stopHarness(harness: Harness): Promise<void> {
  await harness.server.stop(true);
  await harness.stack.cleanup();
}

async function upgradeAttempt(
  harness: Harness,
  path: string,
  headers: Record<string, string>,
): Promise<Response> {
  return fetch(`${harness.httpOrigin}${path}`, { headers: upgradeHeaders(headers) });
}

describe("r.webSocketRoute (integration) — same-host origin, no allowlist", () => {
  let harness: Harness;
  let cookie: string;

  beforeAll(async () => {
    harness = await startHarness({ membershipQuery });
    cookie = await harness.cookie();
  });
  afterAll(() => stopHarness(harness));

  test("no session → 401", async () => {
    const res = await upgradeAttempt(harness, "/api/ws/echo", { Origin: harness.httpOrigin });
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("unauthenticated");
  });

  test("valid cookie + foreign Origin → 403 origin_not_allowed", async () => {
    const res = await upgradeAttempt(harness, "/api/ws/echo", {
      Cookie: cookie,
      Origin: EVIL_ORIGIN,
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("origin_not_allowed");
  });

  test("valid cookie + no Origin → 403 origin_not_allowed", async () => {
    const res = await upgradeAttempt(harness, "/api/ws/echo", { Cookie: cookie });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("origin_not_allowed");
  });

  test("plain GET (no upgrade headers) → 426", async () => {
    const res = await fetch(`${harness.httpOrigin}/api/ws/echo`, {
      headers: { Cookie: cookie, Origin: harness.httpOrigin },
    });
    expect(res.status).toBe(426);
    expect(await errorCode(res)).toBe("websocket_upgrade_required");
  });

  test("upgrade request on a server without the upgrade wiring → 500", async () => {
    const res = await harness.stack.app.request(`${harness.httpOrigin}/api/ws/echo`, {
      headers: upgradeHeaders({
        Cookie: cookie,
        Origin: harness.httpOrigin,
        Host: new URL(harness.httpOrigin).host,
      }),
    });
    expect(res.status).toBe(500);
    expect(await errorCode(res)).toBe("websocket_upgrade_unavailable");
  });

  test("connect() returning a Response rejects the upgrade with it", async () => {
    const res = await upgradeAttempt(harness, "/api/ws/rejected", {
      Cookie: cookie,
      Origin: harness.httpOrigin,
    });
    expect(res.status).toBe(409);
  });

  test("same-host Origin + valid cookie opens and greets with the user id", async () => {
    const socket = connectSocket(harness.url("/api/ws/echo"), {
      Cookie: cookie,
      Origin: harness.httpOrigin,
    });
    await socket.opened;
    expect(JSON.parse(String(await socket.next()))).toEqual({ userId: TestUsers.user.id });
    socket.close();
    await socket.closed;
  });

  test("echoes text and binary messages unchanged", async () => {
    const socket = connectSocket(harness.url("/api/ws/echo"), {
      Cookie: cookie,
      Origin: harness.httpOrigin,
    });
    await socket.opened;
    await socket.next();

    socket.send("hello ä");
    expect(await socket.next()).toBe("hello ä");

    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    socket.send(bytes);
    const echoed = await socket.next();
    if (!(echoed instanceof ArrayBuffer)) throw new Error("expected binary echo");
    expect(Array.from(new Uint8Array(echoed))).toEqual(Array.from(bytes));

    socket.close();
    await socket.closed;
  });

  test("a message above maxMessageBytes closes the socket with 1009", async () => {
    const socket = connectSocket(harness.url("/api/ws/echo"), {
      Cookie: cookie,
      Origin: harness.httpOrigin,
    });
    await socket.opened;
    await socket.next();

    socket.send("x".repeat(MAX_MESSAGE_BYTES * 2));
    expect((await socket.closed).code).toBe(1009);
  });

  test("a throwing handler closes the socket with 1011", async () => {
    const socket = connectSocket(harness.url("/api/ws/explosive"), {
      Cookie: cookie,
      Origin: harness.httpOrigin,
    });
    await socket.opened;
    socket.send("trigger");
    expect((await socket.closed).code).toBe(1011);
  });
});

describe("r.webSocketRoute (integration) — origin allowlist and session checker", () => {
  const revokedSessions = new Set<string>();
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness({
      membershipQuery,
      allowedOrigins: [APP_ORIGIN],
      sessionChecker: async (sid) => (revokedSessions.has(sid) ? "revoked" : "live"),
    });
  });
  afterAll(() => stopHarness(harness));

  test("an allowlisted Origin opens", async () => {
    const socket = connectSocket(harness.url("/api/ws/echo"), {
      Cookie: await harness.cookie("sid-live"),
      Origin: APP_ORIGIN,
    });
    await socket.opened;
    expect(JSON.parse(String(await socket.next()))).toEqual({ userId: TestUsers.user.id });
    socket.close();
    await socket.closed;
  });

  test("the request's own host is NOT enough once an allowlist exists → 403", async () => {
    const res = await upgradeAttempt(harness, "/api/ws/echo", {
      Cookie: await harness.cookie("sid-live"),
      Origin: harness.httpOrigin,
    });
    expect(res.status).toBe(403);
    expect(await errorCode(res)).toBe("origin_not_allowed");
  });

  test("a revoked session is rejected at the upgrade with 401", async () => {
    revokedSessions.add("sid-revoked");
    const res = await upgradeAttempt(harness, "/api/ws/echo", {
      Cookie: await harness.cookie("sid-revoked"),
      Origin: APP_ORIGIN,
    });
    expect(res.status).toBe(401);
  });
});

describe("r.webSocketRoute (integration) — tenant lifecycle", () => {
  const lifecycle = { status: "active" };
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness({
      membershipQuery,
      resolveTenantLifecycleStatus: async () => ({ status: lifecycle.status }),
    });
  });
  afterAll(() => stopHarness(harness));

  test("a serving tenant opens", async () => {
    lifecycle.status = "active";
    const socket = connectSocket(harness.url("/api/ws/echo"), {
      Cookie: await harness.cookie(),
      Origin: harness.httpOrigin,
    });
    await socket.opened;
    socket.close();
    await socket.closed;
  });

  test("a tenant in teardown is rejected at the upgrade with 410, like HTTP", async () => {
    lifecycle.status = "destroying";
    const res = await upgradeAttempt(harness, "/api/ws/echo", {
      Cookie: await harness.cookie(),
      Origin: harness.httpOrigin,
    });
    expect(res.status).toBe(410);
    expect(await errorCode(res)).toBe("tenant_unavailable");
  });
});
