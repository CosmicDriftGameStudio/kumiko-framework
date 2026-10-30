import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LIVE_RESYNC_EVENT_TYPE, type LiveEvent } from "../../../index.ts";
import {
  createEventSourceLiveEvents,
  type LiveEventTimers,
  RECONNECT_MAX_DELAY_MS,
  reconnectDelayMs,
  SSE_STALL_TIMEOUT_MS,
} from "../live-events.ts";

// happy-dom doesn't provide EventSource, and this module only needs
// `typeof window !== "undefined"` to unlock — no real DOM required. Stub
// both globals directly instead of pulling in the project's DOM test config.
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  private readonly listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  readyState: number = FakeEventSource.CONNECTING;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (e: MessageEvent) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  closed = false;

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.readyState = FakeEventSource.OPEN;
    for (const listener of this.listeners.get("open") ?? []) listener({} as MessageEvent);
  }

  fail(readyState: number): void {
    this.readyState = readyState;
    for (const listener of this.listeners.get("error") ?? []) listener({} as MessageEvent);
  }

  ping(): void {
    for (const listener of this.listeners.get("ping") ?? []) listener({ data: "" } as MessageEvent);
  }

  dispatch(entityName: string, data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(entityName) ?? []) listener(event);
  }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalEventSource = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
const originalFetch = globalThis.fetch;
let probedUrls: string[] = [];

beforeEach(() => {
  FakeEventSource.instances.length = 0;
  probedUrls = [];
  // biome-ignore lint/suspicious/noExplicitAny: test-only global stub
  (globalThis as any).window = globalThis;
  // biome-ignore lint/suspicious/noExplicitAny: test-only global stub
  (globalThis as any).EventSource = FakeEventSource;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete (globalThis as { window?: unknown }).window;
  if (originalEventSource) Object.defineProperty(globalThis, "EventSource", originalEventSource);
  else delete (globalThis as { EventSource?: unknown }).EventSource;
});

function entityEvent(overrides: Partial<LiveEvent["data"]> = {}): LiveEvent["data"] {
  return {
    id: "e1",
    aggregateType: "invoice",
    version: 1,
    eventType: "updated",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("createEventSourceLiveEvents", () => {
  test("a frame without an aggregateType reaches the subscriber named after the frame", () => {
    const subscribe = createEventSourceLiveEvents();
    const received: LiveEvent[] = [];
    subscribe("channel-in-app:event:delivered", (event) => received.push(event));
    FakeEventSource.instances[0]?.dispatch("channel-in-app:event:delivered", {
      id: 5,
      userId: "u1",
      notificationType: "t:notify:a",
    });
    expect(received).toHaveLength(1);
    expect(received[0]?.data.aggregateType).toBe("channel-in-app:event:delivered");
  });

  test("any verb — including business verbs and the auto-verb 'forgotten' — triggers the entity listener", () => {
    const liveEvents = createEventSourceLiveEvents();
    const received: LiveEvent[] = [];
    const unsubscribe = liveEvents("invoice", (event) => received.push(event));

    const source = FakeEventSource.instances.at(-1);
    expect(source).toBeDefined();
    // The server now names every frame after the entity, not the verb — a
    // business verb like "archived" or the auto-verb "forgotten" never
    // needed its own listener because no verb-specific listener exists.
    source?.dispatch("invoice", entityEvent({ id: "archived-1" }));
    source?.dispatch("invoice", entityEvent({ id: "forgotten-1", eventType: "invoice.forgotten" }));

    expect(received).toHaveLength(2);
    expect(received[0]?.type).toBe("invoice");
    expect(received[1]?.data.id).toBe("forgotten-1");
    expect(received[1]?.data.eventType).toBe("invoice.forgotten");
    expect(received[1]?.data).not.toHaveProperty("payload");

    unsubscribe();
  });

  test("a subscriber for one entity does not receive another entity's frame", () => {
    const liveEvents = createEventSourceLiveEvents();
    const invoiceEvents: LiveEvent[] = [];
    const userEvents: LiveEvent[] = [];
    const unsubInvoice = liveEvents("invoice", (event) => invoiceEvents.push(event));
    const unsubUser = liveEvents("user", (event) => userEvents.push(event));

    const source = FakeEventSource.instances.at(-1);
    source?.dispatch("invoice", entityEvent({ aggregateType: "invoice" }));

    expect(invoiceEvents).toHaveLength(1);
    expect(userEvents).toHaveLength(0);

    unsubInvoice();
    unsubUser();
  });
});

function stubSseProbe(status: number, body: unknown): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    probedUrls.push(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createEventSourceLiveEvents — session end", () => {
  test("a refused handshake answered with a session 401 ends the session once", async () => {
    stubSseProbe(401, { error: { code: "invalid_token", httpStatus: 401 } });
    let sessionEndedCount = 0;
    const liveEvents = createEventSourceLiveEvents({
      onSessionEnded: () => {
        sessionEndedCount += 1;
      },
    });
    liveEvents("invoice", () => {});
    liveEvents("user", () => {});

    FakeEventSource.instances.at(-1)?.fail(FakeEventSource.CLOSED);
    await nextTick();

    expect(probedUrls).toEqual(["/api/sse"]);
    expect(sessionEndedCount).toBe(1);
    expect(FakeEventSource.instances).toHaveLength(1);

    liveEvents("order", () => {});
    await nextTick();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(probedUrls).toEqual(["/api/sse"]);
    expect(sessionEndedCount).toBe(1);
  });

  test("a session-ended frame ends the session exactly once, without any probe", async () => {
    let sessionEndedCount = 0;
    const liveEvents = createEventSourceLiveEvents({
      onSessionEnded: () => {
        sessionEndedCount += 1;
      },
    });
    liveEvents("invoice", () => {});

    const source = FakeEventSource.instances.at(-1);
    source?.dispatch("session-ended", { code: "invalid_token" });
    source?.dispatch("session-ended", { code: "invalid_token" });
    await nextTick();

    expect(sessionEndedCount).toBe(1);
    expect(probedUrls).toEqual([]);
  });

  test("a session-ended frame with a non-session code leaves the session alone", async () => {
    let sessionEnded = false;
    const liveEvents = createEventSourceLiveEvents({
      onSessionEnded: () => {
        sessionEnded = true;
      },
    });
    liveEvents("invoice", () => {});

    FakeEventSource.instances.at(-1)?.dispatch("session-ended", { code: "something_else" });
    await nextTick();

    expect(sessionEnded).toBe(false);
  });

  test("a refused handshake that is not a session 401 leaves the session alone", async () => {
    stubSseProbe(503, { error: { code: "unavailable", httpStatus: 503 } });
    let sessionEnded = false;
    const liveEvents = createEventSourceLiveEvents({
      onSessionEnded: () => {
        sessionEnded = true;
      },
    });
    liveEvents("invoice", () => {});

    FakeEventSource.instances.at(-1)?.fail(FakeEventSource.CLOSED);
    await nextTick();

    expect(probedUrls).toEqual(["/api/sse"]);
    expect(sessionEnded).toBe(false);
  });

  test("a 401 with a non-session code leaves the session alone", async () => {
    stubSseProbe(401, { error: { code: "something_else", httpStatus: 401 } });
    let sessionEnded = false;
    const liveEvents = createEventSourceLiveEvents({
      onSessionEnded: () => {
        sessionEnded = true;
      },
    });
    liveEvents("invoice", () => {});

    FakeEventSource.instances.at(-1)?.fail(FakeEventSource.CLOSED);
    await nextTick();

    expect(sessionEnded).toBe(false);
  });

  test("a dropped stream the browser retries itself is not probed", async () => {
    stubSseProbe(401, { error: { code: "invalid_token", httpStatus: 401 } });
    let sessionEnded = false;
    const liveEvents = createEventSourceLiveEvents({
      onSessionEnded: () => {
        sessionEnded = true;
      },
    });
    liveEvents("invoice", () => {});

    FakeEventSource.instances.at(-1)?.fail(FakeEventSource.CONNECTING);
    await nextTick();

    expect(probedUrls).toEqual([]);
    expect(sessionEnded).toBe(false);
  });
});

type ScheduledTimer = { readonly callback: () => void; readonly delayMs: number; cleared: boolean };

function createManualTimers(): { timers: LiveEventTimers; scheduled: ScheduledTimer[] } {
  const scheduled: ScheduledTimer[] = [];
  return {
    scheduled,
    timers: {
      set: (callback, delayMs) => {
        const timer: ScheduledTimer = { callback, delayMs, cleared: false };
        scheduled.push(timer);
        return () => {
          timer.cleared = true;
        };
      },
    },
  };
}

function pendingTimers(scheduled: readonly ScheduledTimer[]): ScheduledTimer[] {
  return scheduled.filter((t) => !t.cleared);
}

describe("createEventSourceLiveEvents — reconnect", () => {
  const noJitter = () => 0;

  test("a CLOSED stream reconnects with exponential backoff and resets after open", async () => {
    stubSseProbe(503, { error: { code: "unavailable", httpStatus: 503 } });
    const { timers, scheduled } = createManualTimers();
    const liveEvents = createEventSourceLiveEvents({
      onSessionEnded: () => {},
      timers,
      random: noJitter,
    });
    liveEvents("invoice", () => {});

    FakeEventSource.instances.at(-1)?.fail(FakeEventSource.CLOSED);
    await nextTick();
    expect(scheduled.map((t) => t.delayMs)).toEqual([500]);

    scheduled[0]?.callback();
    expect(FakeEventSource.instances).toHaveLength(2);

    FakeEventSource.instances.at(-1)?.fail(FakeEventSource.CLOSED);
    await nextTick();
    expect(scheduled.map((t) => t.delayMs)).toEqual([500, 1000]);

    scheduled[1]?.callback();
    FakeEventSource.instances.at(-1)?.open();
    FakeEventSource.instances.at(-1)?.fail(FakeEventSource.CLOSED);
    await nextTick();
    expect(scheduled.map((t) => t.delayMs)).toEqual([500, 1000, 500]);
  });

  test("the delay grows to the cap and jitter stays within the exponential window", () => {
    expect(reconnectDelayMs(0, 0)).toBe(500);
    expect(reconnectDelayMs(0, 0.999)).toBeLessThanOrEqual(1000);
    expect(reconnectDelayMs(30, 0)).toBe(RECONNECT_MAX_DELAY_MS / 2);
    expect(reconnectDelayMs(30, 0.999)).toBeLessThanOrEqual(RECONNECT_MAX_DELAY_MS);
  });

  test("a CLOSED stream reconnects without a probe when no session-end consumer exists", async () => {
    const { timers, scheduled } = createManualTimers();
    const liveEvents = createEventSourceLiveEvents({ timers, random: noJitter });
    liveEvents("invoice", () => {});

    FakeEventSource.instances.at(-1)?.fail(FakeEventSource.CLOSED);
    await nextTick();

    expect(probedUrls).toEqual([]);
    expect(scheduled).toHaveLength(1);
  });

  test("a session end signals once and never reconnects", async () => {
    stubSseProbe(401, { error: { code: "invalid_token", httpStatus: 401 } });
    const { timers, scheduled } = createManualTimers();
    let sessionEndedCount = 0;
    const liveEvents = createEventSourceLiveEvents({
      onSessionEnded: () => {
        sessionEndedCount += 1;
      },
      timers,
      random: noJitter,
    });
    liveEvents("invoice", () => {});

    FakeEventSource.instances.at(-1)?.fail(FakeEventSource.CLOSED);
    await nextTick();

    expect(sessionEndedCount).toBe(1);
    expect(scheduled).toEqual([]);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  test("after a reconnect every subscribed entity is rewired on the new source", async () => {
    stubSseProbe(503, { error: { code: "unavailable", httpStatus: 503 } });
    const { timers, scheduled } = createManualTimers();
    const liveEvents = createEventSourceLiveEvents({
      onSessionEnded: () => {},
      timers,
      random: noJitter,
    });
    const invoiceEvents: LiveEvent[] = [];
    const userEvents: LiveEvent[] = [];
    liveEvents("invoice", (event) => invoiceEvents.push(event));
    liveEvents("user", (event) => userEvents.push(event));

    FakeEventSource.instances.at(-1)?.fail(FakeEventSource.CLOSED);
    await nextTick();
    scheduled[0]?.callback();
    const reconnected = FakeEventSource.instances.at(-1);
    reconnected?.dispatch("invoice", entityEvent({ aggregateType: "invoice", id: "i1" }));
    reconnected?.dispatch("user", entityEvent({ aggregateType: "user", id: "u1" }));

    expect(invoiceEvents.map((e) => e.data.id)).toEqual(["i1"]);
    expect(userEvents.map((e) => e.data.id)).toEqual(["u1"]);
  });

  test("every open sends one resync event per subscribed entity, the first one included", async () => {
    stubSseProbe(503, { error: { code: "unavailable", httpStatus: 503 } });
    const { timers, scheduled } = createManualTimers();
    const liveEvents = createEventSourceLiveEvents({
      onSessionEnded: () => {},
      timers,
      random: noJitter,
      now: () => Date.parse("2026-02-03T04:05:06.000Z"),
    });
    const invoiceEvents: LiveEvent[] = [];
    const userEvents: LiveEvent[] = [];
    liveEvents("invoice", (event) => invoiceEvents.push(event));
    liveEvents("user", (event) => userEvents.push(event));

    const resyncOf = (entity: string): LiveEvent => ({
      type: entity,
      data: {
        aggregateType: entity,
        eventType: LIVE_RESYNC_EVENT_TYPE,
        createdAt: "2026-02-03T04:05:06Z",
      },
    });

    FakeEventSource.instances.at(-1)?.open();
    expect(invoiceEvents).toEqual([resyncOf("invoice")]);
    expect(userEvents).toEqual([resyncOf("user")]);

    FakeEventSource.instances.at(-1)?.fail(FakeEventSource.CLOSED);
    await nextTick();
    scheduled[0]?.callback();
    FakeEventSource.instances.at(-1)?.open();

    expect(invoiceEvents).toEqual([resyncOf("invoice"), resyncOf("invoice")]);
    expect(userEvents.map((e) => e.data.eventType)).toEqual([
      LIVE_RESYNC_EVENT_TYPE,
      LIVE_RESYNC_EVENT_TYPE,
    ]);
  });

  test("a browser-side retry (CONNECTING) also resyncs once the stream is open again", () => {
    const liveEvents = createEventSourceLiveEvents({ onSessionEnded: () => {} });
    const received: LiveEvent[] = [];
    liveEvents("invoice", (event) => received.push(event));

    const source = FakeEventSource.instances.at(-1);
    source?.fail(FakeEventSource.CONNECTING);
    source?.open();

    expect(received.map((e) => e.data.eventType)).toEqual([LIVE_RESYNC_EVENT_TYPE]);
  });

  test("the last unsubscribe cancels a pending reconnect", async () => {
    stubSseProbe(503, { error: { code: "unavailable", httpStatus: 503 } });
    const { timers, scheduled } = createManualTimers();
    const liveEvents = createEventSourceLiveEvents({
      onSessionEnded: () => {},
      timers,
      random: noJitter,
    });
    const unsubscribe = liveEvents("invoice", () => {});

    FakeEventSource.instances.at(-1)?.fail(FakeEventSource.CLOSED);
    await nextTick();
    expect(pendingTimers(scheduled)).toHaveLength(1);

    unsubscribe();

    expect(pendingTimers(scheduled)).toHaveLength(0);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  test("a probe finishing after the last unsubscribe schedules nothing", async () => {
    stubSseProbe(503, { error: { code: "unavailable", httpStatus: 503 } });
    const { timers, scheduled } = createManualTimers();
    const liveEvents = createEventSourceLiveEvents({
      onSessionEnded: () => {},
      timers,
      random: noJitter,
    });
    const unsubscribe = liveEvents("invoice", () => {});

    FakeEventSource.instances.at(-1)?.fail(FakeEventSource.CLOSED);
    unsubscribe();
    await nextTick();

    expect(scheduled).toEqual([]);
  });
});

describe("createEventSourceLiveEvents — stall watchdog", () => {
  const noJitter = () => 0;
  const SERVER_HEARTBEAT_INTERVAL_MS = 15_000;

  // Fake clock: stall timers fire when advanced past their deadline, reconnect timers are manual.
  function setup() {
    const reconnect = createManualTimers();
    let clock = 0;
    type Stall = { callback: () => void; at: number; cleared: boolean };
    const stalls: Stall[] = [];
    const stallTimers: LiveEventTimers = {
      set: (callback, delayMs) => {
        const stall: Stall = { callback, at: clock + delayMs, cleared: false };
        stalls.push(stall);
        return () => {
          stall.cleared = true;
        };
      },
    };
    const advance = (ms: number): void => {
      const target = clock + ms;
      for (;;) {
        const due = stalls
          .filter((t) => !t.cleared && t.at <= target)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        clock = due.at;
        due.cleared = true;
        due.callback();
      }
      clock = target;
    };
    const events: LiveEvent[] = [];
    const liveEvents = createEventSourceLiveEvents({
      timers: reconnect.timers,
      stallTimers,
      random: noJitter,
    });
    const unsubscribe = liveEvents("invoice", (e) => events.push(e));
    return { reconnect, stalls, advance, events, unsubscribe };
  }

  test("the stall timeout is two server heartbeats (15 s, SSE_HEARTBEAT_INTERVAL_MS)", () => {
    expect(SSE_STALL_TIMEOUT_MS).toBe(2 * SERVER_HEARTBEAT_INTERVAL_MS);
  });

  test("no frame for 30 s closes the stream and reconnects with a resync", () => {
    const { reconnect, advance, events } = setup();
    const first = FakeEventSource.instances.at(-1);
    first?.open();
    events.length = 0;

    advance(SSE_STALL_TIMEOUT_MS);
    expect(first?.closed).toBe(true);
    expect(pendingTimers(reconnect.scheduled)).toHaveLength(1);

    reconnect.scheduled[0]?.callback();
    expect(FakeEventSource.instances).toHaveLength(2);
    FakeEventSource.instances.at(-1)?.open();
    expect(events.map((e) => e.data.eventType)).toEqual([LIVE_RESYNC_EVENT_TYPE]);
  });

  test("a ping every 15 s keeps the stream open", () => {
    const { reconnect, advance } = setup();
    const source = FakeEventSource.instances.at(-1);
    source?.open();
    for (let elapsed = 0; elapsed < 120_000; elapsed += SERVER_HEARTBEAT_INTERVAL_MS) {
      advance(SERVER_HEARTBEAT_INTERVAL_MS);
      source?.ping();
    }
    expect(source?.closed).toBe(false);
    expect(reconnect.scheduled).toHaveLength(0);
  });

  test("entity frames also reset the watchdog", () => {
    const { advance } = setup();
    const source = FakeEventSource.instances.at(-1);
    source?.open();
    advance(25_000);
    source?.dispatch("invoice", entityEvent());
    advance(25_000);
    expect(source?.closed).toBe(false);
    advance(5_000);
    expect(source?.closed).toBe(true);
  });

  test("the last unsubscribe leaves no watchdog timer running", () => {
    const { stalls, advance, unsubscribe } = setup();
    const source = FakeEventSource.instances.at(-1);
    source?.open();
    unsubscribe();
    expect(stalls.filter((t) => !t.cleared)).toHaveLength(0);
    advance(120_000);
    expect(source?.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  test("an error and the watchdog together schedule only one reconnect", async () => {
    stubSseProbe(503, { error: { code: "unavailable", httpStatus: 503 } });
    const { reconnect, advance } = setup();
    const source = FakeEventSource.instances.at(-1);
    source?.open();
    advance(SSE_STALL_TIMEOUT_MS);
    source?.fail(FakeEventSource.CLOSED);
    await nextTick();
    expect(pendingTimers(reconnect.scheduled)).toHaveLength(1);
  });

  test("a session-ended frame disarms the watchdog instead of reconnecting", () => {
    const { reconnect, advance } = setup();
    const source = FakeEventSource.instances.at(-1);
    source?.open();
    source?.dispatch("session-ended", { code: "invalid_token" });
    advance(120_000);
    expect(source?.closed).toBe(false);
    expect(pendingTimers(reconnect.scheduled)).toHaveLength(0);
  });
});
