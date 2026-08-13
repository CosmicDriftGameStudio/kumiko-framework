import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LiveEvent } from "@cosmicdrift/kumiko-renderer";
import { createEventSourceLiveEvents } from "../live-events";

// happy-dom doesn't provide EventSource, and this module only needs
// `typeof window !== "undefined"` to unlock — no real DOM required. Stub
// both globals directly instead of pulling in the project's DOM test config.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  private readonly listeners = new Map<string, Set<(e: MessageEvent) => void>>();

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

  dispatch(entityName: string, data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(entityName) ?? []) listener(event);
  }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalEventSource = Object.getOwnPropertyDescriptor(globalThis, "EventSource");

beforeEach(() => {
  FakeEventSource.instances.length = 0;
  // biome-ignore lint/suspicious/noExplicitAny: test-only global stub
  (globalThis as any).window = globalThis;
  // biome-ignore lint/suspicious/noExplicitAny: test-only global stub
  (globalThis as any).EventSource = FakeEventSource;
});

afterEach(() => {
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
    payload: {},
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
    source?.dispatch("invoice", entityEvent({ id: "forgotten-1" }));

    expect(received).toHaveLength(2);
    expect(received[0]?.type).toBe("invoice");
    expect(received[1]?.data.id).toBe("forgotten-1");

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
