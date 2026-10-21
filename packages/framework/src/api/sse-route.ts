import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { hasAccess } from "../engine/access.ts";
import { tenantChannel } from "../engine/constants.ts";
import { isAnonymousSessionUser } from "../engine/system-user.ts";
import type { AccessRule, SessionUser } from "../engine/types/index.ts";
import { Routes } from "./api-constants.ts";
import { getAuthTokenExpiry, getStaleCredentialCode, getUser } from "./auth-middleware.ts";
import { clearSessionCookies, getSessionCookies } from "./session-cookies.ts";
import { accessInvalidationCredentialFor, type SseBroker, type SseEvent } from "./sse-broker.ts";
import { scheduleTokenExpiry } from "./token-expiry-timer.ts";

/**
 * Heartbeat cadence for SSE streams.
 *
 * Must stay below every realistic idle timeout in the hop-by-hop layers;
 * otherwise one of them terminates the connection and the browser reports
 * ERR_HTTP2_PROTOCOL_ERROR. Known limits:
 *   - Bun.serve default: 10 s (disabled locally via idleTimeout: 0,
 *     but the cadence also conforms without that override)
 *   - Caddy reverse_proxy: no default timeout for SSE (auto-detects
 *     via Content-Type), but long-lived idle streams may be closed by
 *     connection tracking
 *   - Cloudflare Edge: 100 s
 *   - AWS ALB: 60 s
 *
 * 15 s is comfortably below all of these. The server-side cost is marginal
 * (1 frame per client every 15 s).
 *
 * The spec test in __tests__/sse-route-spec.test.ts pins this value to
 * prevent accidentally increasing it.
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

// First frame on a stream that was downgraded to anonymous because the browser's auth
// cookie is stale. A downgraded stream answers 200, so EventSource never reports the
// session end by itself.
const SESSION_ENDED_SSE_EVENT = "session-ended";

// A broadcast batch legitimately queues many frames at once, so a client is dropped for
// making no progress, not for queue depth.
export const SSE_STALLED_CLIENT_TIMEOUT_MS = SSE_HEARTBEAT_INTERVAL_MS;

// Memory backstop only: a client that still makes progress but queues this many frames is dropped.
export const SSE_MAX_PENDING_WRITES_PER_CLIENT = 10_000;

export type SseRouteOptions = {
  readonly anonymousLiveEntities: ReadonlySet<string>;
  readonly entityReadAccess: ReadonlyMap<string, readonly AccessRule[]>;
  readonly now?: () => number;
};

type AnonymousEntitySignalWire = {
  readonly aggregateType: string;
  readonly eventType: string;
  readonly createdAt: unknown;
};

type EntitySignalWire = AnonymousEntitySignalWire & {
  readonly id: unknown;
  readonly version: unknown;
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

// The signal covers every row of the entity, including rows the anonymous
// query hides, so id and version would leak which hidden rows exist and
// change. Anonymous clients refetch the whole query anyway.
function toAnonymousEntitySignalWire(
  event: SseEvent,
  data: { aggregateType: string } & Record<string, unknown>,
): AnonymousEntitySignalWire {
  return {
    aggregateType: data.aggregateType,
    eventType: event.type,
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

type SignalDetail = "identified" | "anonymous" | "none";

// A role-gated rule means every holder may read every row, so id and version leak nothing.
// An openToAll rule leaves row visibility to the handler (e.g. an owner check on form drafts),
// which the signal cannot know: such a connection only learns that the entity changed.
function entitySignalDetail(
  user: SessionUser,
  aggregateType: string,
  options: SseRouteOptions,
): SignalDetail {
  if (isAnonymousSessionUser(user)) {
    return options.anonymousLiveEntities.has(aggregateType) ? "anonymous" : "none";
  }
  const granting = (options.entityReadAccess.get(aggregateType) ?? []).filter((rule) =>
    hasAccess(user, rule),
  );
  if (granting.length === 0) return "none";
  return granting.some((rule) => "roles" in rule) ? "identified" : "anonymous";
}

type SseWireFrame = { readonly name: string; readonly data: unknown };

function decideWireFrame(
  event: SseEvent,
  user: SessionUser,
  options: SseRouteOptions,
): SseWireFrame | undefined {
  const data = event.data;
  if (isEntityEventData(data)) {
    // skip: connections only get signals for entities a query lets their roles read
    const detail = entitySignalDetail(user, data.aggregateType, options);
    if (detail === "none") return undefined;
    const signal =
      detail === "anonymous"
        ? toAnonymousEntitySignalWire(event, data)
        : toEntitySignalWire(event, data);
    return { name: data.aggregateType, data: signal };
  }
  // skip: frames without an entity belong to their addressee only
  if (!isAddressedTo(event, user.id)) return undefined;
  return { name: event.type, data };
}

export function createSseRoute(broker: SseBroker, options: SseRouteOptions) {
  const now = options.now ?? Date.now;
  const route = new Hono();

  route.get(Routes.sse, async (c) => {
    const user = getUser(c);
    // Channel is server-derived from authenticated user — never trust client input.
    // Allowing ?channel=... would let any authenticated user subscribe to other tenants' feeds.
    const channel = tenantChannel(user.tenantId);
    // JWT expiry raises no access-invalidation event, so the stream must end
    // itself when the token it was opened with expires.
    const tokenExpiresAtSec = getAuthTokenExpiry(c);
    const staleCredentialCode = getStaleCredentialCode(c);
    // JS cannot remove the HttpOnly auth cookie, so the response does.
    if (staleCredentialCode !== undefined) clearSessionCookies(c, getSessionCookies(c));

    return streamSSE(c, async (stream) => {
      if (staleCredentialCode !== undefined) {
        await stream.writeSSE({
          event: SESSION_ENDED_SSE_EVENT,
          data: JSON.stringify({ code: staleCredentialCode }),
        });
      }
      let resolveEnded!: () => void;
      const ended = new Promise<void>((resolve) => {
        resolveEnded = resolve;
      });
      const closeStream = () => {
        resolveEnded();
        void stream.close();
      };

      let pendingWrites = 0;
      let lastProgressAt = now();
      const isStalled = () =>
        pendingWrites > 0 && now() - lastProgressAt > SSE_STALLED_CLIENT_TIMEOUT_MS;
      const clientId = broker.addClient(
        channel,
        (event) => {
          // skip: the stream is already being torn down
          if (stream.aborted || stream.closed) return;
          // The broker loops over all clients synchronously: one bad client must not stop the others.
          try {
            const frame = decideWireFrame(event, user, options);
            // skip: decideWireFrame withholds frames this user must not see
            if (!frame) return;
            if (pendingWrites >= SSE_MAX_PENDING_WRITES_PER_CLIENT || isStalled()) {
              // abort (not close) cancels the pending writes; close would queue behind them
              stream.abort();
              // skip: this client is gone, the frame has no audience
              return;
            }
            const data = JSON.stringify(frame.data);
            if (pendingWrites === 0) lastProgressAt = now();
            pendingWrites += 1;
            stream
              .writeSSE({ event: frame.name, data })
              .catch(closeStream)
              .finally(() => {
                pendingWrites -= 1;
                lastProgressAt = now();
              });
          } catch {
            // skip: an unserializable frame ends this client's stream, not the broadcast
            closeStream();
          }
        },
        closeStream,
      );
      const unsubscribeAccessInvalidation = broker.subscribeAccessInvalidation(
        user.id,
        closeStream,
        accessInvalidationCredentialFor(user),
      );

      const expiryTimer = scheduleTokenExpiry(tokenExpiresAtSec, closeStream);

      let released = false;
      const release = () => {
        // skip: onAbort and the finally block both release, the second call is a no-op
        if (released) return;
        released = true;
        // A client disconnect must also wake the heartbeat sleep, not only a server close.
        resolveEnded();
        clearTimeout(expiryTimer);
        broker.removeClient(channel, clientId);
        unsubscribeAccessInvalidation();
      };

      stream.onAbort(release);

      // Keep the connection alive with a heartbeat — see SSE_HEARTBEAT_INTERVAL_MS
      // for the layer-by-layer rationale for the 15 s cadence.
      try {
        while (!stream.closed && !stream.aborted) {
          if (isStalled()) {
            stream.abort();
            break;
          }
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
