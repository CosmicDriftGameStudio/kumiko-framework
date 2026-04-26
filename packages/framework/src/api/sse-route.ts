import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { tenantChannel } from "../engine/constants";
import { Routes } from "./api-constants";
import { getUser } from "./auth-middleware";
import type { SseBroker } from "./sse-broker";

/**
 * Heartbeat-Cadence für SSE-Streams.
 *
 * Spec: muss UNTER jedem realistischen Idle-Timeout der Hop-by-Hop-Layer
 * liegen, sonst killt einer davon die Connection und der Browser sieht
 * ERR_HTTP2_PROTOCOL_ERROR. Bekannte Limits:
 *   - Bun.serve default: 10 s (lokal disabled via idleTimeout: 0,
 *     aber Spec-konform auch ohne Override)
 *   - Caddy reverse_proxy: kein default-Timeout für SSE (auto-detect
 *     via Content-Type), aber langlebige idle Streams können von
 *     Connection-Tracking dichtgemacht werden
 *   - Cloudflare Edge: 100 s
 *   - AWS ALB: 60 s
 *
 * 15 s liegt komfortabel unter allen davon. Server-side Cost ist
 * marginal (1 Frame pro Client alle 15 s).
 *
 * Spec-Test in __tests__/sse-route-spec.test.ts pinst diesen Wert
 * gegen versehentliches Hochsetzen.
 */
export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

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

      // Keep connection alive with heartbeat — siehe SSE_HEARTBEAT_INTERVAL_MS
      // header für die Layer-für-Layer-Begründung der 15s-Cadence.
      while (true) {
        await stream.writeSSE({ event: "ping", data: "" });
        await stream.sleep(SSE_HEARTBEAT_INTERVAL_MS);
      }
    });
  });

  return route;
}
