import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { tenantChannel } from "../engine/constants.js";
import { Routes } from "./api-constants.js";
import { getUser } from "./auth-middleware.js";
import { accessInvalidationCredentialFor, type SseBroker, type SseEvent } from "./sse-broker.js";

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

// Entity events carry aggregateType in data (system-hooks.ts's SSE-broadcast
// consumer) — the wire frame is named after the entity so the client can
// wire a single listener per entity instead of one per verb. Non-entity
// events (e.g. channel-in-app:event:delivered) have no aggregateType and
// keep their event.type as the frame name.
function isEntityEventData(data: Record<string, unknown>): data is { aggregateType: string } {
  return typeof data["aggregateType"] === "string";
}

// The tenant channel fans out to every member; user-addressed frames
// (e.g. channel-in-app:event:delivered) would otherwise reach the whole tenant.
function isAddressedToOtherUser(event: SseEvent, userId: string): boolean {
  const addressee = event.data["userId"];
  return typeof addressee === "string" && addressee !== userId;
}

export function createSseRoute(broker: SseBroker) {
  const route = new Hono();

  route.get(Routes.sse, async (c) => {
    const user = getUser(c);
    // Channel is server-derived from authenticated user — never trust client input.
    // Allowing ?channel=... would let any authenticated user subscribe to other tenants' feeds.
    const channel = tenantChannel(user.tenantId);

    return streamSSE(c, async (stream) => {
      let resolveEnded!: () => void;
      const ended = new Promise<void>((resolve) => {
        resolveEnded = resolve;
      });
      const closeStream = () => {
        resolveEnded();
        void stream.close();
      };

      const clientId = broker.addClient(
        channel,
        (event) => {
          // skip: user-addressed frames on the shared tenant channel belong to their recipient only
          if (isAddressedToOtherUser(event, user.id)) return;
          const wireEventName = isEntityEventData(event.data)
            ? event.data.aggregateType
            : event.type;
          stream.writeSSE({ event: wireEventName, data: JSON.stringify(event.data) });
        },
        closeStream,
      );
      const unsubscribeAccessInvalidation = broker.subscribeAccessInvalidation(
        user.id,
        closeStream,
        accessInvalidationCredentialFor(user),
      );

      let released = false;
      const release = () => {
        // skip: onAbort and the finally block both release, the second call is a no-op
        if (released) return;
        released = true;
        // A client disconnect must also wake the heartbeat sleep, not only a server close.
        resolveEnded();
        broker.removeClient(channel, clientId);
        unsubscribeAccessInvalidation();
      };

      stream.onAbort(release);

      // Keep connection alive with heartbeat — siehe SSE_HEARTBEAT_INTERVAL_MS
      // header für die Layer-für-Layer-Begründung der 15s-Cadence.
      try {
        while (!stream.closed && !stream.aborted) {
          await stream.writeSSE({ event: "ping", data: "" });
          await Promise.race([stream.sleep(SSE_HEARTBEAT_INTERVAL_MS), ended]);
        }
      } finally {
        release();
      }
    });
  });

  return route;
}
