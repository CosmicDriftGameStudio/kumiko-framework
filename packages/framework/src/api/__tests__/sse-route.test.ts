import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { TestUsers } from "../../stack/index.js";
import { authMiddleware } from "../auth-middleware.js";
import { createJwtHelper } from "../jwt.js";
import type { AccessInvalidationCredential, SseBroker, SseEvent } from "../sse-broker.js";
import { createSseRoute } from "../sse-route.js";

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

async function buildSseApp(broker: SseBroker): Promise<{ app: Hono; token: string }> {
  const jwt = createJwtHelper(JWT_SECRET);
  const token = await jwt.sign(TestUsers.user); // tenantId = 1

  const app = new Hono();
  app.use("/api/*", authMiddleware(jwt));
  app.route("/api", createSseRoute(broker));
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
        payload: {},
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const frame = await readNextEntityFrame(reader);
    controller.abort();

    expect(frame.event).toBe("user");
    expect(JSON.parse(frame.data)).toEqual({
      id: "u1",
      aggregateType: "user",
      version: 1,
      payload: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    });
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

  test("frames addressed to another user are dropped, own and unaddressed frames pass", async () => {
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

  async function openStream(recording: Recording, sid: string) {
    const jwt = createJwtHelper(JWT_SECRET);
    const token = await jwt.sign({ ...TestUsers.user, sid });
    const app = new Hono();
    app.use("/api/*", authMiddleware(jwt));
    app.route("/api", createSseRoute(recording.broker));
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
});
