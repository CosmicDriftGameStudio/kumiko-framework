import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import * as z from "zod";
import { tenantChannel } from "../../engine/constants.ts";
import { defineFeature } from "../../engine/define-feature.ts";
import { createEntity, createTextField } from "../../engine/factories.ts";
import { createRegistry } from "../../engine/registry.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { authMiddleware } from "../auth-middleware.ts";
import { collectEntityReadAccess } from "../entity-read-access.ts";
import { createJwtHelper } from "../jwt.ts";
import {
  type AccessInvalidationCredential,
  createSseBroker,
  type SseBroker,
  type SseEvent,
} from "../sse-broker.ts";
import {
  createSseRoute,
  SSE_STALLED_CLIENT_TIMEOUT_MS,
  type SseRouteOptions,
} from "../sse-route.ts";

const NO_ANONYMOUS_ENTITIES: SseRouteOptions = {
  anonymousLiveEntities: new Set(),
  entityReadAccess: new Map([["user", [{ roles: ["User"] }]]]),
};

const JWT_SECRET = "sse-route-unit-test-secret-at-least-32-characters";

function createTrackingBroker(): { broker: SseBroker; subscribedChannel: Promise<string> } {
  let resolveChannel!: (channel: string) => void;
  const subscribedChannel = new Promise<string>((resolve) => {
    resolveChannel = resolve;
  });

  const broker: SseBroker = {
    addClient(channel, _send, _close) {
      resolveChannel(channel);
      return "test-client-id";
    },
    removeClient() {},
    pushToChannel(_channel: string, _event: SseEvent) {},
    getClientCount() {
      return 0;
    },
    getTotalClientCount() {
      return 0;
    },
    subscribeAccessInvalidation() {
      return () => {};
    },
    publishAccessInvalidation() {},
  };

  return { broker, subscribedChannel };
}

async function buildSseApp(
  broker: SseBroker,
  options: SseRouteOptions = NO_ANONYMOUS_ENTITIES,
): Promise<{ app: Hono; token: string }> {
  const jwt = createJwtHelper(JWT_SECRET);
  const token = await jwt.sign(TestUsers.user); // tenantId = 1

  const app = new Hono();
  app.use("/api/*", authMiddleware(jwt));
  app.route("/api", createSseRoute(broker, options));
  return { app, token };
}

// createTrackingBroker's addClient discards the `send` callback — fine for
// the channel-scoping tests above, but frame-naming tests need to capture
// it and actually push an event through.
function createSendCapturingBroker(): {
  broker: SseBroker;
  send: Promise<(event: SseEvent) => void>;
} {
  let resolveSend!: (send: (event: SseEvent) => void) => void;
  const send = new Promise<(event: SseEvent) => void>((resolve) => {
    resolveSend = resolve;
  });

  const broker: SseBroker = {
    addClient(_channel, sendFn) {
      resolveSend(sendFn);
      return "test-client-id";
    },
    removeClient() {},
    pushToChannel() {},
    getClientCount() {
      return 0;
    },
    getTotalClientCount() {
      return 0;
    },
    subscribeAccessInvalidation() {
      return () => {};
    },
    publishAccessInvalidation() {},
  };

  return { broker, send };
}

// The stream's first frame is always the immediate heartbeat `ping` (see
// SSE_HEARTBEAT_INTERVAL_MS's while-loop in sse-route.ts) — skip it and
// return the first real frame.
async function readNextEntityFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<{ event: string; data: string }> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("SSE stream ended before a non-ping frame arrived");
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const frame = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const eventName = frame.match(/^event: (.*)$/m)?.[1];
      if (eventName !== undefined && eventName !== "ping") {
        const data = frame.match(/^data: (.*)$/m)?.[1] ?? "";
        return { event: eventName, data };
      }
      separatorIndex = buffer.indexOf("\n\n");
    }
  }
}

describe("sse-route security", () => {
  test("subscribes to authenticated tenant channel, ignores client query-param", async () => {
    const { broker, subscribedChannel } = createTrackingBroker();
    const { app, token } = await buildSseApp(broker);

    const controller = new AbortController();
    // Stream keeps the request open — fire without awaiting, then abort.
    // Promise.resolve() normalises Response | Promise<Response> to a thenable.
    void Promise.resolve(
      app.request("/api/sse?channel=tenant:999", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }),
    ).catch(() => {
      // Aborted — expected.
    });

    const channel = await subscribedChannel;
    controller.abort();

    expect(channel).toBe("tenant:00000000-0000-4000-8000-000000000001");
    expect(channel).not.toBe("tenant:999");
  });

  test("subscribes to authenticated tenant channel even without any query-param", async () => {
    const { broker, subscribedChannel } = createTrackingBroker();
    const { app, token } = await buildSseApp(broker);

    const controller = new AbortController();
    void Promise.resolve(
      app.request("/api/sse", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }),
    ).catch(() => {});

    const channel = await subscribedChannel;
    controller.abort();

    expect(channel).toBe("tenant:00000000-0000-4000-8000-000000000001");
  });

  test("rejects request without Bearer token", async () => {
    const { broker } = createTrackingBroker();
    const { app } = await buildSseApp(broker);

    const res = await app.request("/api/sse");
    expect(res.status).toBe(401);
  });

  test("cross-tenant injection attempt: user in tenant 1 cannot subscribe to tenant 2", async () => {
    const { broker, subscribedChannel } = createTrackingBroker();
    const { app, token } = await buildSseApp(broker); // token: tenantId 1

    const controller = new AbortController();
    void Promise.resolve(
      app.request("/api/sse?channel=tenant:2&channel=tenant:3", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }),
    ).catch(() => {});

    const channel = await subscribedChannel;
    controller.abort();

    expect(channel).toBe("tenant:00000000-0000-4000-8000-000000000001");
  });
});

describe("sse-route frame naming", () => {
  test("entity events broadcast under the entity-name frame, not the verb", async () => {
    const { broker, send } = createSendCapturingBroker();
    const { app, token } = await buildSseApp(broker);

    const controller = new AbortController();
    const responsePromise = Promise.resolve(
      app.request("/api/sse", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }),
    );

    const sendEvent = await send;
    const response = await responsePromise;
    const reader = response.body!.getReader();

    sendEvent({
      type: "user.created",
      data: {
        id: "u1",
        aggregateType: "user",
        version: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const frame = await readNextEntityFrame(reader);
    controller.abort();

    expect(frame.event).toBe("user");
    expect(JSON.parse(frame.data)).toEqual({
      id: "u1",
      aggregateType: "user",
      eventType: "user.created",
      version: 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  test("a payload smuggled into entity frame data never reaches the wire", async () => {
    const { broker, send } = createSendCapturingBroker();
    const { app, token } = await buildSseApp(broker);

    const controller = new AbortController();
    const responsePromise = Promise.resolve(
      app.request("/api/sse", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }),
    );

    const sendEvent = await send;
    const response = await responsePromise;
    const reader = response.body!.getReader();

    sendEvent({
      type: "user.updated",
      data: {
        id: "u1",
        aggregateType: "user",
        version: 2,
        createdAt: "2026-01-01T00:00:00.000Z",
        payload: { changes: { email: "leak@example.test" } },
        email: "leak@example.test",
      },
    });

    const frame = await readNextEntityFrame(reader);
    controller.abort();

    expect(frame.data).not.toContain("leak@example.test");
    expect(JSON.parse(frame.data)).not.toHaveProperty("payload");
  });

  test("an entity no query lets the connection's role read gets no frame", async () => {
    const { broker, send } = createSendCapturingBroker();
    const { app, token } = await buildSseApp(broker);

    const controller = new AbortController();
    const responsePromise = Promise.resolve(
      app.request("/api/sse", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }),
    );

    const sendEvent = await send;
    const response = await responsePromise;
    const reader = response.body!.getReader();

    const createdAt = "2026-01-01T00:00:00.000Z";
    sendEvent({
      type: "export-job.created",
      data: { id: "hidden", aggregateType: "export-job", version: 1, createdAt },
    });
    sendEvent({
      type: "user.created",
      data: { id: "visible", aggregateType: "user", version: 1, createdAt },
    });

    const frame = await readNextEntityFrame(reader);
    controller.abort();

    expect(frame.event).toBe("user");
  });

  test("an entity readable through an openToAll query only signals the change, without id or version", async () => {
    const { broker, send } = createSendCapturingBroker();
    const { app, token } = await buildSseApp(broker, {
      anonymousLiveEntities: new Set(),
      entityReadAccess: new Map([
        ["form-draft", [{ openToAll: { reason: "owner check lives in the handler" } }]],
      ]),
    });

    const controller = new AbortController();
    const responsePromise = Promise.resolve(
      app.request("/api/sse", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }),
    );

    const sendEvent = await send;
    const response = await responsePromise;
    const reader = response.body!.getReader();

    sendEvent({
      type: "form-draft.updated",
      data: {
        id: "someone-elses-draft",
        aggregateType: "form-draft",
        version: 7,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const frame = await readNextEntityFrame(reader);
    controller.abort();

    expect(frame.event).toBe("form-draft");
    const wire = JSON.parse(frame.data);
    expect(wire).not.toHaveProperty("id");
    expect(wire).not.toHaveProperty("version");
  });

  test("a camelCase entity signalled under its kebab-case aggregate type follows the entity's read rules", async () => {
    const registry = createRegistry([
      defineFeature("demo", (r) => {
        r.entity({
          name: "documentExtract",
          ...createEntity({
            table: "document_extracts",
            fields: { name: createTextField({ personal: false, reason: "test_fixture" }) },
          }),
        });
        r.queryHandler({
          name: "list-extracts",
          schema: z.object({}),
          handler: async () => ({}),
          access: { openToAll: { reason: "owner check lives in the handler" } },
          liveEntities: ["documentExtract"],
        });
      }),
    ]);
    const { broker, send } = createSendCapturingBroker();
    const { app, token } = await buildSseApp(broker, {
      anonymousLiveEntities: new Set(),
      entityReadAccess: collectEntityReadAccess(registry),
    });

    const controller = new AbortController();
    const responsePromise = Promise.resolve(
      app.request("/api/sse", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }),
    );

    const sendEvent = await send;
    const response = await responsePromise;
    const reader = response.body!.getReader();

    sendEvent({
      type: "document-extract.updated",
      data: {
        id: "someone-elses-extract",
        aggregateType: "document-extract",
        version: 3,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const frame = await readNextEntityFrame(reader);
    controller.abort();

    expect(frame.event).toBe("document-extract");
    const wire = JSON.parse(frame.data);
    expect(wire).not.toHaveProperty("id");
    expect(wire).not.toHaveProperty("version");
  });

  test("non-entity events (no aggregateType) keep event.type as the frame name", async () => {
    const { broker, send } = createSendCapturingBroker();
    const { app, token } = await buildSseApp(broker);

    const controller = new AbortController();
    const responsePromise = Promise.resolve(
      app.request("/api/sse", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }),
    );

    const sendEvent = await send;
    const response = await responsePromise;
    const reader = response.body!.getReader();

    sendEvent({
      type: "channel-in-app:event:delivered",
      data: { id: "m1", userId: TestUsers.user.id, notificationType: "info", title: "Hi" },
    });

    const frame = await readNextEntityFrame(reader);
    controller.abort();

    expect(frame.event).toBe("channel-in-app:event:delivered");
  });

  test("frames addressed to another user or to nobody are dropped, only own frames pass", async () => {
    const { broker, send } = createSendCapturingBroker();
    const { app, token } = await buildSseApp(broker);

    const controller = new AbortController();
    const responsePromise = Promise.resolve(
      app.request("/api/sse", {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      }),
    );

    const sendEvent = await send;
    const response = await responsePromise;
    const reader = response.body!.getReader();

    sendEvent({
      type: "channel-in-app:event:delivered",
      data: { id: "other", userId: TestUsers.admin.id, title: "not for you" },
    });
    sendEvent({
      type: "channel-in-app:event:delivered",
      data: { id: "nobody", title: "no addressee" },
    });
    sendEvent({
      type: "channel-in-app:event:delivered",
      data: { id: "mine", userId: TestUsers.user.id, title: "for you" },
    });

    const frame = await readNextEntityFrame(reader);
    controller.abort();

    expect(JSON.parse(frame.data).id).toBe("mine");
  });
});

describe("sse-route access invalidation", () => {
  type Recording = {
    broker: SseBroker;
    credentials: AccessInvalidationCredential[];
    invalidate: Promise<() => void>;
    removeClientCalls: number;
    unsubscribeCalls: number;
  };

  function createRecordingBroker(): Recording {
    let resolveInvalidate!: (cb: () => void) => void;
    const recording: Recording = {
      credentials: [],
      invalidate: new Promise<() => void>((resolve) => {
        resolveInvalidate = resolve;
      }),
      removeClientCalls: 0,
      unsubscribeCalls: 0,
      broker: {
        addClient: () => "test-client-id",
        removeClient: () => {
          recording.removeClientCalls++;
        },
        pushToChannel() {},
        getClientCount: () => 0,
        getTotalClientCount: () => 0,
        subscribeAccessInvalidation: (_userId, onInvalidate, credential) => {
          if (credential) recording.credentials.push(credential);
          resolveInvalidate(onInvalidate);
          return () => {
            recording.unsubscribeCalls++;
          };
        },
        publishAccessInvalidation() {},
      },
    };
    return recording;
  }

  async function openStream(recording: Recording, sid: string, ttlSeconds?: number) {
    const jwt = createJwtHelper(JWT_SECRET, "kumiko", ttlSeconds);
    const token = await jwt.sign({ ...TestUsers.user, sid });
    const app = new Hono();
    app.use("/api/*", authMiddleware(jwt));
    app.route("/api", createSseRoute(recording.broker, NO_ANONYMOUS_ENTITIES));
    const response = await app.request("/api/sse", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.body!.getReader();
  }

  test("subscribes with the session id of the token as credential", async () => {
    const recording = createRecordingBroker();
    const reader = await openStream(recording, "sid-1");
    await recording.invalidate;
    await reader.cancel();

    expect(recording.credentials).toEqual([{ sid: "sid-1" }]);
  });

  test("invalidation ends the response and releases client and subscription exactly once", async () => {
    const recording = createRecordingBroker();
    const reader = await openStream(recording, "sid-1");
    const invalidate = await recording.invalidate;

    invalidate();

    let done = false;
    while (!done) {
      ({ done } = await reader.read());
    }

    expect(recording.removeClientCalls).toBe(1);
    expect(recording.unsubscribeCalls).toBe(1);
  });

  test("a stream outlasting its JWT ends on its own and releases client and subscription exactly once", async () => {
    const recording = createRecordingBroker();
    const reader = await openStream(recording, "sid-1", 1);
    await recording.invalidate;

    let done = false;
    while (!done) {
      ({ done } = await reader.read());
    }

    expect(recording.removeClientCalls).toBe(1);
    expect(recording.unsubscribeCalls).toBe(1);
  });
});

describe("sse-route backpressure", () => {
  const userUpdated = (n: number): SseEvent => ({
    type: "user.updated",
    data: {
      id: `u${n}`,
      aggregateType: "user",
      version: n + 1,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  });

  async function openClients(clock: { now: number }) {
    const local = createSseBroker();
    let resolveNextAdded!: () => void;
    let nextAdded = Promise.resolve();
    const broker: SseBroker = {
      ...local,
      addClient(channel, send, close) {
        const id = local.addClient(channel, send, close);
        resolveNextAdded();
        return id;
      },
    };
    const { app, token } = await buildSseApp(broker, {
      ...NO_ANONYMOUS_ENTITIES,
      now: () => clock.now,
    });
    const open = async () => {
      nextAdded = new Promise<void>((resolve) => {
        resolveNextAdded = resolve;
      });
      const response = await app.request("/api/sse", {
        headers: { Authorization: `Bearer ${token}` },
      });
      await nextAdded;
      return response.body!.getReader();
    };
    return { local, open, channel: tenantChannel(TestUsers.user.tenantId) };
  }

  test("a reading client receives a synchronous burst far above the old queue limit and stays connected", async () => {
    const clock = { now: 0 };
    const { local, open, channel } = await openClients(clock);
    const reader = await open();

    const burst = 1000;
    for (let n = 0; n < burst; n++) local.pushToChannel(channel, userUpdated(n));

    for (let n = 0; n < burst; n++) {
      const frame = await readNextEntityFrame(reader);
      expect(JSON.parse(frame.data).id).toBe(`u${n}`);
    }
    expect(local.getClientCount(channel)).toBe(1);
    await reader.cancel();
  });

  test("a client without progress past the stall timeout is dropped and released while others keep receiving", async () => {
    const clock = { now: 0 };
    const { local, open, channel } = await openClients(clock);
    await open();
    const fastReader = await open();
    expect(local.getClientCount(channel)).toBe(2);

    for (let n = 0; n < 3; n++) {
      local.pushToChannel(channel, userUpdated(n));
      expect(JSON.parse((await readNextEntityFrame(fastReader)).data).id).toBe(`u${n}`);
    }
    expect(local.getClientCount(channel)).toBe(2);

    // let the fast client's last write settle before the clock jumps
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    clock.now += SSE_STALLED_CLIENT_TIMEOUT_MS + 1;
    local.pushToChannel(channel, userUpdated(3));
    expect(JSON.parse((await readNextEntityFrame(fastReader)).data).id).toBe("u3");

    expect(local.getClientCount(channel)).toBe(1);
    local.pushToChannel(channel, userUpdated(4));
    expect(JSON.parse((await readNextEntityFrame(fastReader)).data).id).toBe("u4");
    await fastReader.cancel();
  });
});
