import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getUser } from "./auth-middleware";
import type { SseBroker } from "./sse-broker";
import { Routes } from "./api-constants";

export function createSseRoute(broker: SseBroker) {
  const route = new Hono();

  route.get(Routes.sse, async (c) => {
    const user = getUser(c);
    const channel = c.req.query("channel") ?? `tenant:${user.tenantId}`;

    return streamSSE(c, async (stream) => {
      const clientId = broker.addClient(
        channel,
        (event) => {
          stream.writeSSE({ event: event.type, data: JSON.stringify(event.data) });
        },
        () => stream.close(),
      );

      stream.onAbort(() => {
        broker.removeClient(channel, clientId);
      });

      // Keep connection alive with heartbeat
      while (true) {
        await stream.writeSSE({ event: "ping", data: "" });
        await stream.sleep(30000);
      }
    });
  });

  return route;
}
