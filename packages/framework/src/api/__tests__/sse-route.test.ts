import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { TestUsers } from "../../stack";
import { authMiddleware } from "../auth-middleware";
import { createJwtHelper } from "../jwt";
import type { SseBroker, SseEvent } from "../sse-broker";
import { createSseRoute } from "../sse-route";

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
      data: { id: "m1", userId: "u1", notificationType: "info", title: "Hi" },
    });

    const frame = await readNextEntityFrame(reader);
    controller.abort();

    expect(frame.event).toBe("channel-in-app:event:delivered");
  });
});
