import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import {
  isSessionEndedError,
  LIVE_RESYNC_EVENT_TYPE,
  type LiveEvent,
  type LiveEventSubscriber,
} from "../../index.ts";

// EventSource-backed live events for the web renderer. The shared
// layer consumes only the `LiveEventSubscriber` interface; this file
// provides a factory that creates an EventSource for /api/sse,
// wires one addEventListener per entity (the server names each frame
// after aggregateType; see sse-route.ts), and routes subscriptions.
//
// Connection lifecycle: lazy on the first subscribe, and closed when the
// last unsubscribe fires. A browser-abandoned stream (CLOSED) is rebuilt
// after a session probe with backoff. Listeners receive a resync signal on
// EVERY open, the first one included: a list loads page 1 in parallel with the
// connection setup, so a change between its query and the stream going live
// would otherwise never reach it. After a rebuild, frames may also have been
// lost during the gap.
// Multiple consumers share the same EventSource to reduce CPU and server load.

type EntitySubscriber = {
  readonly entityName: string;
  readonly listener: (event: LiveEvent) => void;
};

export type CreateEventSourceLiveEventsOptions = {
  /** URL of the SSE endpoint. Defaults to /api/sse, where
   * createSseRoute mounts it on the Kumiko server. Override this when
   * the mount path differs. */
  readonly url?: string;
  /** Fires once per connection when the session ended: the server refused the SSE
   *  handshake, or opened the stream with a `session-ended` frame (stale auth
   *  cookie downgraded to anonymous). Same codes as the dispatcher path. */
  readonly onSessionEnded?: () => void;
  /** Reconnect-timer seam; defaults to the global setTimeout/clearTimeout. */
  readonly timers?: LiveEventTimers;
  /** Stall-watchdog timer seam; defaults to the global setTimeout/clearTimeout. */
  readonly stallTimers?: LiveEventTimers;
  /** Jitter source in [0, 1); defaults to Math.random. */
  readonly random?: () => number;
  /** Clock for synthetic resync events; defaults to Date.now. */
  readonly now?: () => number;
};

export type LiveEventTimers = {
  /** Schedules the callback and returns a function that cancels it. */
  readonly set: (callback: () => void, delayMs: number) => () => void;
};

export const RECONNECT_BASE_DELAY_MS = 1_000;
export const RECONNECT_MAX_DELAY_MS = 30_000;

// Two missed server heartbeats (15 s each, SSE_HEARTBEAT_INTERVAL_MS in framework sse-route.ts).
// A KEDA interceptor can leave the stream hanging without an `error` event (kedacore/http-add-on#1803).
export const SSE_STALL_TIMEOUT_MS = 30_000;

const defaultTimers: LiveEventTimers = {
  set: (callback, delayMs) => {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};

// Equal jitter: half the exponential delay is fixed, half random, so a server
// restart doesn't make every tab reconnect in the same instant.
export function reconnectDelayMs(attempt: number, random: number): number {
  const ceiling = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(ceiling / 2 + (random * ceiling) / 2);
}

// Wire name of the first frame on a stream downgraded from a stale auth cookie (sse-route.ts).
const SESSION_ENDED_EVENT = "session-ended";

function sessionEndedFrameCode(event: unknown): string | undefined {
  const data = propertyOf(event, "data");
  if (typeof data !== "string") return undefined;
  try {
    const code = propertyOf(JSON.parse(data), "code");
    return typeof code === "string" ? code : undefined;
  } catch {
    // skip: malformed frame, not evidence of a session end
    return undefined;
  }
}

function hasErrorCode(body: unknown): body is { readonly error: { readonly code: string } } {
  if (typeof body !== "object" || body === null || !("error" in body)) return false;
  const { error } = body;
  return (
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
  );
}

// EventSource never exposes the HTTP status, so one plain fetch of the same
// URL tells a session end apart from an outage. Aborted right after the
// headers/body so a 200 doesn't hold a second stream open.
async function isSessionEndedRejection(url: string): Promise<boolean> {
  const controller = new AbortController();
  try {
    // kumiko-lint-ignore direct-fetch url is the app's own SSE endpoint, probed with same-origin credentials
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (res.status !== 401) return false;
    const body: unknown = await res.json();
    return hasErrorCode(body) && isSessionEndedError({ code: body.error.code, httpStatus: 401 });
  } catch {
    // skip: probe failed (offline, unparseable body) — not evidence of a session end
    return false;
  } finally {
    controller.abort();
  }
}

/** Returns an EventSource-backed `LiveEventSubscriber`.
 *  Typically called once during app bootstrap and passed as a value to
 *  `<LiveEventsProvider>`; `createKumikoApp` does this. */
export function createEventSourceLiveEvents(
  options: CreateEventSourceLiveEventsOptions = {},
): LiveEventSubscriber {
  const url = options.url ?? "/api/sse";
  const timers = options.timers ?? defaultTimers;
  const stallTimers = options.stallTimers ?? defaultTimers;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  const subscribers = new Set<EntitySubscriber>();
  let source: EventSource | undefined;
  const wiredEntities = new Set<string>();
  let cancelReconnect: (() => void) | undefined;
  let reconnectAttempt = 0;
  let cancelStallWatchdog: (() => void) | undefined;

  const disarmStallWatchdog = (): void => {
    cancelStallWatchdog?.();
    cancelStallWatchdog = undefined;
  };

  const armStallWatchdog = (connection: EventSource): void => {
    // skip: a frame from a connection that is no longer the current one
    if (source !== connection) return;
    disarmStallWatchdog();
    cancelStallWatchdog = stallTimers.set(() => {
      cancelStallWatchdog = undefined;
      // skip: a late timer of a connection that was already replaced
      if (source !== connection) return;
      connection.close();
      scheduleReconnect();
    }, SSE_STALL_TIMEOUT_MS);
  };

  // `subscribers` is a flat Set across all entities — the browser-side
  // addEventListener(entityName, ...) gate below only filters which frames
  // arrive at all, not which subscriber a given frame is for. Without this
  // filter, an `invoice` subscriber would also fire on every `user` frame.
  // Frames without an aggregateType (channel-in-app:event:delivered) are named after their
  // event type, so the frame name is the subscription key and the signal is synthesized.
  const handleEvent = (raw: string, frameName: string): void => {
    let parsed: LiveEvent["data"];
    try {
      const body: unknown = JSON.parse(raw);
      const aggregateType = propertyOf(body, "aggregateType");
      parsed =
        typeof aggregateType === "string"
          ? (body as LiveEvent["data"])
          : {
              aggregateType: frameName,
              eventType: frameName,
              createdAt: Temporal.Instant.fromEpochMilliseconds(now()).toString(),
            };
    } catch {
      // skip: malformed SSE payload, drop it rather than crash all subscribers
      return;
    }
    const event: LiveEvent = { type: parsed.aggregateType, data: parsed };
    for (const sub of subscribers) {
      if (sub.entityName === parsed.aggregateType) sub.listener(event);
    }
  };

  const emitResync = (): void => {
    const createdAt = Temporal.Instant.fromEpochMilliseconds(now()).toString();
    for (const sub of [...subscribers]) {
      sub.listener({
        type: sub.entityName,
        data: { aggregateType: sub.entityName, eventType: LIVE_RESYNC_EVENT_TYPE, createdAt },
      });
    }
  };

  const wireEntity = (connection: EventSource, entityName: string): void => {
    // skip: already wired for this entity on this connection
    if (wiredEntities.has(entityName)) return;
    connection.addEventListener(entityName, (e) => {
      const data = propertyOf(e, "data");
      armStallWatchdog(connection);
      if (typeof data === "string") handleEvent(data, entityName);
    });
    wiredEntities.add(entityName);
  };

  const connect = (): void => {
    // skip: no window/EventSource available (SSR/non-browser), nothing to connect
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const connection = new EventSource(url);
    source = connection;
    wiredEntities.clear();
    for (const sub of subscribers) wireEntity(connection, sub.entityName);
    const { onSessionEnded } = options;
    let sessionEndedSignalled = false;
    const signalSessionEnded = (): void => {
      // skip: the frame and the error probe can both report the same session end
      if (sessionEndedSignalled) return;
      sessionEndedSignalled = true;
      onSessionEnded?.();
    };
    armStallWatchdog(connection);
    connection.addEventListener("ping", () => armStallWatchdog(connection));
    connection.addEventListener("open", () => {
      armStallWatchdog(connection);
      reconnectAttempt = 0;
      emitResync();
    });
    connection.addEventListener(SESSION_ENDED_EVENT, (e) => {
      const code = sessionEndedFrameCode(e);
      if (code !== undefined && isSessionEndedError({ code, httpStatus: 401 })) {
        disarmStallWatchdog();
        signalSessionEnded();
        // skip: a reconnect after a session end would only be refused again
        return;
      }
      armStallWatchdog(connection);
    });
    connection.addEventListener("error", () => {
      // skip: CONNECTING means a dropped stream the browser retries itself;
      // only a refused handshake (non-200) closes the EventSource for good.
      if (connection.readyState !== EventSource.CLOSED) return;
      void (
        onSessionEnded === undefined ? Promise.resolve(false) : isSessionEndedRejection(url)
      ).then((sessionEnded) => {
        // skip: closeIfEmpty or a newer connection took over while probing
        if (source !== connection) return;
        if (sessionEnded) {
          disarmStallWatchdog();
          signalSessionEnded();
          // skip: the session ended, reconnecting would only be refused again
          return;
        }
        disarmStallWatchdog();
        scheduleReconnect();
      });
    });
  };

  const scheduleReconnect = (): void => {
    // skip: a reconnect is already pending
    if (cancelReconnect !== undefined) return;
    const delay = reconnectDelayMs(reconnectAttempt, random());
    reconnectAttempt += 1;
    cancelReconnect = timers.set(() => {
      cancelReconnect = undefined;
      source = undefined;
      connect();
    }, delay);
  };

  const ensureConnected = (): void => {
    // skip: connected, or waiting for the backoff timer to reconnect
    if (source !== undefined || cancelReconnect !== undefined) return;
    connect();
  };

  const closeIfEmpty = (): void => {
    // skip: subscribers remain, connection still needed
    if (subscribers.size > 0) return;
    if (cancelReconnect !== undefined) {
      cancelReconnect();
      cancelReconnect = undefined;
    }
    reconnectAttempt = 0;
    disarmStallWatchdog();
    // skip: already closed, nothing to close
    if (source === undefined) return;
    source.close();
    source = undefined;
    wiredEntities.clear();
  };

  return (entityName, listener) => {
    ensureConnected();
    if (source !== undefined) wireEntity(source, entityName);
    const sub: EntitySubscriber = { entityName, listener };
    subscribers.add(sub);
    return () => {
      subscribers.delete(sub);
      closeIfEmpty();
    };
  };
}
