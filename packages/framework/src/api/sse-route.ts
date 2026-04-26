import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { tenantChannel } from "../engine/constants";
import { Routes } from "./api-constants";
import { getUser } from "./auth-middleware";
import type { SseBroker } from "./sse-broker";

export function createSseRoute(broker: SseBroker) {
  const route = new Hono();

  route.get(Routes.sse, async (c) => {
    const user = getUser(c);
    // Channel is server-derived from authenticated user — never trust client input.
    // Allowing ?channel=... would let any authenticated user subscribe to other tenants' feeds.
    const channel = tenantChannel(user.tenantId);

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

      // Keep connection alive with heartbeat. 15s is conservative gegen
      // intermediäre Idle-Timeouts: Bun.serve default ist 10s, viele
      // Reverse-Proxies (Caddy/Nginx default) und CDN-Edges (Cloudflare:
      // 100s, AWS-ALB: 60s) schließen lange ruhige Streams. Mit ping
      // alle 15s bleibt jede Schicht happy. Server-side fast gratis
      // (1 Frame pro Client alle 15s).
      while (true) {
        await stream.writeSSE({ event: "ping", data: "" });
        await stream.sleep(15000);
      }
    });
  });

  return route;
}
