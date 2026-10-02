import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { tenantChannel } from "../engine/constants.js";
import { isAnonymousSessionUser } from "../engine/system-user.js";
import type { SessionUser } from "../engine/types/index.js";
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

export type SseRouteOptions = {
  readonly anonymousLiveEntities: ReadonlySet<string>;
};

type EntitySignalWire = {
  readonly id: unknown;
  readonly aggregateType: string;
  readonly eventType: string;
  readonly version: unknown;
  readonly createdAt: unknown;
};

// Whitelist, never a spread: the wire frame is a signal without field
// values even if a broker or pusher put a payload into event.data.
function toEntitySignalWire(
  event: SseEvent,
  data: { aggregateType: string } & Record<string, unknown>,
): EntitySignalWire {
  return {
    id: data["id"],
    aggregateType: data.aggregateType,
    eventType: event.type,
    version: data["version"],
    createdAt: data["createdAt"],
  };
}

// The tenant channel fans out to every member, so a frame without an entity
// (e.g. channel-in-app:event:delivered) reaches only its addressee; a frame
// lacking userId is dropped (fail-closed).
function isAddressedTo(event: SseEvent, userId: string): boolean {
  const addressee = event.data["userId"];
  return typeof addressee === "string" && addressee === userId;
}

function mayReceiveEntitySignal(
  user: SessionUser,
  aggregateType: string,
  options: SseRouteOptions,
): boolean {
  return !isAnonymousSessionUser(user) || options.anonymousLiveEntities.has(aggregateType);
}

type SseWireFrame = { readonly name: string; readonly data: unknown };

function decideWireFrame(
  event: SseEvent,
  user: SessionUser,
  options: SseRouteOptions,
): SseWireFrame | undefined {
  const data = event.data;
  if (isEntityEventData(data)) {
    // skip: anonymous connections only get signals for entities an anonymous query declares
    if (!mayReceiveEntitySignal(user, data.aggregateType, options)) return undefined;
    return { name: data.aggregateType, data: toEntitySignalWire(event, data) };
  }
  // skip: frames without an entity belong to their addressee only
  if (!isAddressedTo(event, user.id)) return undefined;
  return { name: event.type, data };
}

export function createSseRoute(broker: SseBroker, options: SseRouteOptions) {
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
          const frame = decideWireFrame(event, user, options);
          // skip: decideWireFrame withholds frames this user must not see
          if (!frame) return;
          stream.writeSSE({ event: frame.name, data: JSON.stringify(frame.data) });
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
