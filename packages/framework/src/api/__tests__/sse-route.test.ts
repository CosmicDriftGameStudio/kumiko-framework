import { Hono } from "hono";
import { describe, expect, test } from "bun:test";
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
