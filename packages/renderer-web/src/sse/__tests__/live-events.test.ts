import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LiveEvent } from "@cosmicdrift/kumiko-renderer";
import { createEventSourceLiveEvents } from "../live-events.js";

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

  close(): void {}

  fail(readyState: number): void {
    this.readyState = readyState;
    for (const listener of this.listeners.get("error") ?? []) listener({} as MessageEvent);
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
