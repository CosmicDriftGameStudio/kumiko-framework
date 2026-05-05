import type { LiveEvent, LiveEventSubscriber } from "@cosmicdrift/kumiko-renderer";

// EventSource-backed Live-Events für den Web-Renderer. Der shared
// Layer konsumiert nur das `LiveEventSubscriber`-Interface; diese Datei
// liefert eine Factory die intern eine EventSource auf /api/sse aufbaut,
// pro (entity, verb)-Kombi einen addEventListener verdrahtet und
// subscriptions routet.
//
// Verbindungs-Lifecycle: lazy beim ersten subscribe, close wenn der
// letzte unsubscribe feuert. Mehrere Consumer teilen sich dieselbe
// EventSource, sparen CPU + Server-Load.

const VERBS = ["created", "updated", "deleted", "restored"] as const;

type EntitySubscriber = {
  readonly entityName: string;
  readonly listener: (event: LiveEvent) => void;
};

export type CreateEventSourceLiveEventsOptions = {
  /** URL des SSE-Endpoints. Default: /api/sse (das ist wo
   *  createSseRoute im Kumiko-Server mountet). Override wenn der
   *  Mountpath divergiert. */
  readonly url?: string;
};

/** Liefert einen `LiveEventSubscriber` der EventSource-backed ist.
 *  Normalerweise einmal im App-Bootstrap gerufen und als value an
 *  `<LiveEventsProvider>` durchgereicht — createKumikoApp tut das. */
export function createEventSourceLiveEvents(
  options: CreateEventSourceLiveEventsOptions = {},
): LiveEventSubscriber {
  const url = options.url ?? "/api/sse";

  const subscribers = new Set<EntitySubscriber>();
  let source: EventSource | undefined;
  const wiredTypes = new Set<string>();

  const handleEvent = (type: string, raw: string): void => {
    let parsed: LiveEvent["data"];
    try {
      parsed = JSON.parse(raw) as LiveEvent["data"];
    } catch {
      // Malformed payload — drop it. Besser als einen fangenden Listener
      // zu crashen und alle anderen subscribers mitzureißen.
      return;
    }
    const event: LiveEvent = { type, data: parsed };
    for (const sub of subscribers) {
      if (sub.entityName === parsed.aggregateType) sub.listener(event);
    }
  };

  const ensureConnected = (): void => {
    if (source !== undefined) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    source = new EventSource(url);
  };

  const ensureListenersForEntity = (entityName: string): void => {
    if (source === undefined) return;
    for (const verb of VERBS) {
      const type = `${entityName}.${verb}`;
      if (wiredTypes.has(type)) continue;
      source.addEventListener(type, (e) => {
        handleEvent(type, (e as MessageEvent).data);
      });
      wiredTypes.add(type);
    }
  };

  const closeIfEmpty = (): void => {
    if (subscribers.size > 0) return;
    if (source === undefined) return;
    source.close();
    source = undefined;
    wiredTypes.clear();
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
