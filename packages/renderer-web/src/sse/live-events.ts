import {
  isSessionEndedError,
  type LiveEvent,
  type LiveEventSubscriber,
} from "@cosmicdrift/kumiko-renderer";

// EventSource-backed Live-Events für den Web-Renderer. Der shared
// Layer konsumiert nur das `LiveEventSubscriber`-Interface; diese Datei
// liefert eine Factory die intern eine EventSource auf /api/sse aufbaut,
// pro Entity EINEN addEventListener verdrahtet (Server benennt den Frame
// nach dem aggregateType, siehe sse-route.ts) und subscriptions routet.
//
// Verbindungs-Lifecycle: lazy beim ersten subscribe, close wenn der
// letzte unsubscribe feuert. Mehrere Consumer teilen sich dieselbe
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
  /** Fires when the server refuses the SSE handshake because the session
   *  ended (same 401 codes as the dispatcher path). */
  readonly onSessionEnded?: () => void;
};

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
    // guard-allow: same-origin fetch — url is the app's own SSE endpoint, probed with same-origin credentials
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

  const subscribers = new Set<EntitySubscriber>();
  let source: EventSource | undefined;
  const wiredEntities = new Set<string>();

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

  const ensureConnected = (): void => {
    // skip: EventSource already connected
    if (source !== undefined) return;
    // skip: no window/EventSource available (SSR/non-browser), nothing to connect
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    const connection = new EventSource(url);
    source = connection;
    const { onSessionEnded } = options;
    // skip: no session-end consumer, a refused handshake needs no probe
    if (onSessionEnded === undefined) return;
    connection.addEventListener("error", () => {
      // skip: CONNECTING means a dropped stream the browser retries itself;
      // only a refused handshake (non-200) closes the EventSource for good.
      if (connection.readyState !== EventSource.CLOSED) return;
      void isSessionEndedRejection(url).then((sessionEnded) => {
        if (sessionEnded) onSessionEnded();
      });
    });
  };

  const ensureListenersForEntity = (entityName: string): void => {
    // skip: not connected yet, listeners get wired once ensureConnected runs
    if (source === undefined) return;
    // skip: already wired for this entity
    if (wiredEntities.has(entityName)) return;
    source.addEventListener(entityName, (e) => {
      handleEvent((e as MessageEvent).data);
    });
    wiredEntities.add(entityName);
  };

  const closeIfEmpty = (): void => {
    // skip: subscribers remain, connection still needed
    if (subscribers.size > 0) return;
    // skip: already closed, nothing to close
    if (source === undefined) return;
    source.close();
    source = undefined;
    wiredEntities.clear();
  };

  return (entityName, listener) => {
    ensureConnected();
    ensureListenersForEntity(entityName);
    const sub: EntitySubscriber = { entityName, listener };
    subscribers.add(sub);
    return () => {
      subscribers.delete(sub);
      closeIfEmpty();
    };
  };
}
