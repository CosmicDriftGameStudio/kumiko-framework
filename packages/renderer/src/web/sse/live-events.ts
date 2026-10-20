import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import {
  isSessionEndedError,
  LIVE_RESYNC_EVENT_TYPE,
  type LiveEvent,
  type LiveEventSubscriber,
} from "../../index.ts";

// EventSource-backed Live-Events für den Web-Renderer. Der shared
// Layer konsumiert nur das `LiveEventSubscriber`-Interface; diese Datei
// liefert eine Factory die intern eine EventSource auf /api/sse aufbaut,
// pro Entity EINEN addEventListener verdrahtet (Server benennt den Frame
// nach dem aggregateType, siehe sse-route.ts) und subscriptions routet.
//
// Verbindungs-Lifecycle: lazy beim ersten subscribe, close wenn der
// letzte unsubscribe feuert. Ein vom Browser aufgegebener Stream (CLOSED)
// wird nach einer Session-Probe mit Backoff neu aufgebaut; nach jedem
// Wiederaufbau bekommen die Listener ein Resync-Signal, weil Frames
// während der Lücke verloren sind. Mehrere Consumer teilen sich dieselbe
// EventSource, sparen CPU + Server-Load.

type EntitySubscriber = {
  readonly entityName: string;
  readonly listener: (event: LiveEvent) => void;
};

export type CreateEventSourceLiveEventsOptions = {
  /** URL des SSE-Endpoints. Default: /api/sse (das ist wo
   *  createSseRoute im Kumiko-Server mountet). Override wenn der
   *  Mountpath divergiert. */
  readonly url?: string;
  /** Fires once per connection when the session ended: the server refused the SSE
   *  handshake, or opened the stream with a `session-ended` frame (stale auth
   *  cookie downgraded to anonymous). Same codes as the dispatcher path. */
  readonly onSessionEnded?: () => void;
  /** Reconnect-timer seam; defaults to the global setTimeout/clearTimeout. */
  readonly timers?: LiveEventTimers;
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

/** Liefert einen `LiveEventSubscriber` der EventSource-backed ist.
 *  Normalerweise einmal im App-Bootstrap gerufen und als value an
 *  `<LiveEventsProvider>` durchgereicht — createKumikoApp tut das. */
export function createEventSourceLiveEvents(
  options: CreateEventSourceLiveEventsOptions = {},
): LiveEventSubscriber {
  const url = options.url ?? "/api/sse";
  const timers = options.timers ?? defaultTimers;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  const subscribers = new Set<EntitySubscriber>();
  let source: EventSource | undefined;
  const wiredEntities = new Set<string>();
  let cancelReconnect: (() => void) | undefined;
  let reconnectAttempt = 0;
  let needsResync = false;

  // `subscribers` is a flat Set across all entities — the browser-side
  // addEventListener(entityName, ...) gate below only filters which frames
  // arrive at all, not which subscriber a given frame is for. Without this
  // filter, an `invoice` subscriber would also fire on every `user` frame.
  const handleEvent = (raw: string): void => {
    let parsed: LiveEvent["data"];
    try {
      parsed = JSON.parse(raw) as LiveEvent["data"];
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
      if (typeof data === "string") handleEvent(data);
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
    connection.addEventListener("open", () => {
      reconnectAttempt = 0;
      // skip: first connect, nothing was missed
      if (!needsResync) return;
      needsResync = false;
      emitResync();
    });
    connection.addEventListener(SESSION_ENDED_EVENT, (e) => {
      const code = sessionEndedFrameCode(e);
      if (code !== undefined && isSessionEndedError({ code, httpStatus: 401 }))
        signalSessionEnded();
    });
    connection.addEventListener("error", () => {
      needsResync = true;
      // skip: CONNECTING means a dropped stream the browser retries itself;
      // only a refused handshake (non-200) closes the EventSource for good.
      if (connection.readyState !== EventSource.CLOSED) return;
      void (
        onSessionEnded === undefined ? Promise.resolve(false) : isSessionEndedRejection(url)
      ).then((sessionEnded) => {
        // skip: closeIfEmpty or a newer connection took over while probing
        if (source !== connection) return;
        if (sessionEnded) {
          signalSessionEnded();
          // skip: the session ended, reconnecting would only be refused again
          return;
        }
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
    needsResync = false;
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
