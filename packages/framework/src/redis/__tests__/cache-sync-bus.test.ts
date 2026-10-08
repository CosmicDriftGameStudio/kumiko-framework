import { describe, expect, test } from "bun:test";
import { createCacheSyncBusOverSignal, createLocalCacheSyncBus } from "../cache-sync-bus.js";
import type { PubSubSignal } from "../pubsub-signal.js";

// Loopback "Redis": every signal sharing a hub receives every publish, own
// publishes included (like a real psubscribe on the publisher's channel).
function createHub() {
  const signals: FakeSignal[] = [];
  return {
    create(): FakeSignal {
      const signal = createFakeSignal((channel, payload) => {
        for (const other of signals) other.receive(channel, payload);
      });
      signals.push(signal);
      return signal;
    },
  };
}

type FakeSignal = PubSubSignal & {
  receive(channel: string, payload: unknown): void;
  reconnect(): void;
  closeCalls(): number;
};

function createFakeSignal(onPublish: (channel: string, payload: unknown) => void): FakeSignal {
  const messageListeners: Array<(channel: string, payload: unknown) => void> = [];
  const reconnectListeners: Array<() => void> = [];
  let closes = 0;
  return {
    publish: onPublish,
    publishConfirmed: async (channel, payload) => onPublish(channel, payload),
    onMessage: (listener) => {
      messageListeners.push(listener);
    },
    onReconnect: (listener) => {
      reconnectListeners.push(listener);
    },
    async close() {
      closes += 1;
    },
    receive(channel, payload) {
      for (const listener of messageListeners) listener(channel, payload);
    },
    reconnect() {
      for (const listener of reconnectListeners) listener();
    },
    closeCalls: () => closes,
  };
}

const CHANNEL = "kumiko:cache-sync";

describe("local cache sync bus", () => {
  test("delivers synchronously to subscribers of the topic only", () => {
    const bus = createLocalCacheSyncBus();
    const seen: unknown[] = [];
    const other: unknown[] = [];
    bus.subscribe("a", (message) => seen.push(message));
    bus.subscribe("b", (message) => other.push(message));
    bus.publish("a", { n: 1 });
    expect(seen).toEqual([{ n: 1 }]);
    expect(other).toEqual([]);
  });

  test("unsubscribe stops delivery", () => {
    const bus = createLocalCacheSyncBus();
    const seen: unknown[] = [];
    const unsubscribe = bus.subscribe("a", (message) => seen.push(message));
    bus.publish("a", 1);
    unsubscribe();
    bus.publish("a", 2);
    expect(seen).toEqual([1]);
  });
});

describe("cache sync bus over a pub/sub signal", () => {
  test("publish reaches local subscribers synchronously and other processes via the channel", () => {
    const hub = createHub();
    const busA = createCacheSyncBusOverSignal(hub.create(), { channel: CHANNEL, originId: "a" });
    const busB = createCacheSyncBusOverSignal(hub.create(), { channel: CHANNEL, originId: "b" });
    const onA: unknown[] = [];
    const onB: unknown[] = [];
    busA.subscribe("t", (message) => onA.push(message));
    busB.subscribe("t", (message) => onB.push(message));

    busA.publish("t", { tenantId: "x" });

    expect(onA).toEqual([{ tenantId: "x" }]);
    expect(onB).toEqual([{ tenantId: "x" }]);
  });

  test("a process does not receive its own echo", () => {
    const hub = createHub();
    const bus = createCacheSyncBusOverSignal(hub.create(), { channel: CHANNEL, originId: "a" });
    const seen: unknown[] = [];
    bus.subscribe("t", (message) => seen.push(message));
    bus.publish("t", 1);
    expect(seen).toEqual([1]);
  });

  test("malformed or foreign envelopes are dropped", () => {
    const signal = createFakeSignal(() => {});
    const bus = createCacheSyncBusOverSignal(signal, { channel: CHANNEL, originId: "a" });
    const seen: unknown[] = [];
    bus.subscribe("t", (message) => seen.push(message));

    for (const payload of [
      null,
      "text",
      42,
      {},
      { topic: "t", message: 1 },
      { origin: "b", message: 1 },
      { origin: "b", topic: 7, message: 1 },
      { origin: "b", topic: "t" },
    ]) {
      signal.receive(CHANNEL, payload);
    }
    expect(seen).toEqual([]);

    signal.receive(CHANNEL, { origin: "b", topic: "t", message: "ok" });
    expect(seen).toEqual(["ok"]);
  });

  test("unsubscribe stops remote delivery", () => {
    const signal = createFakeSignal(() => {});
    const bus = createCacheSyncBusOverSignal(signal, { channel: CHANNEL, originId: "a" });
    const seen: unknown[] = [];
    const unsubscribe = bus.subscribe("t", (message) => seen.push(message));
    unsubscribe();
    signal.receive(CHANNEL, { origin: "b", topic: "t", message: 1 });
    expect(seen).toEqual([]);
  });

  test("a throwing remote listener does not stop the others", () => {
    const signal = createFakeSignal(() => {});
    const bus = createCacheSyncBusOverSignal(signal, { channel: CHANNEL, originId: "a" });
    const seen: unknown[] = [];
    bus.subscribe("t", () => {
      throw new Error("boom");
    });
    bus.subscribe("t", (message) => seen.push(message));
    signal.receive(CHANNEL, { origin: "b", topic: "t", message: 1 });
    expect(seen).toEqual([1]);
  });

  test("close closes the signal", async () => {
    const signal = createFakeSignal(() => {});
    const bus = createCacheSyncBusOverSignal(signal, { channel: CHANNEL });
    await bus.close();
    expect(signal.closeCalls()).toBe(1);
  });
});

describe("cache sync bus resync", () => {
  test("a reconnect fires resync listeners once; unsubscribed listeners stay quiet", () => {
    const signal = createFakeSignal(() => {});
    const bus = createCacheSyncBusOverSignal(signal, { channel: CHANNEL });
    let kept = 0;
    let dropped = 0;
    bus.onResync(() => {
      kept += 1;
    });
    const unsubscribe = bus.onResync(() => {
      dropped += 1;
    });
    unsubscribe();
    signal.reconnect();
    expect(kept).toBe(1);
    expect(dropped).toBe(0);
  });

  test("reconnects inside the debounce window collapse into one trailing resync", () => {
    const signal = createFakeSignal(() => {});
    let clock = 1_000_000;
    const bus = createCacheSyncBusOverSignal(signal, {
      channel: CHANNEL,
      resyncMinIntervalMs: 60_000,
      now: () => clock,
    });
    let fired = 0;
    bus.onResync(() => {
      fired += 1;
    });

    signal.reconnect();
    clock += 1_000;
    signal.reconnect();
    signal.reconnect();
    expect(fired).toBe(1);
    return bus.close();
  });

  test("a deferred resync still fires after the window", async () => {
    const signal = createFakeSignal(() => {});
    const bus = createCacheSyncBusOverSignal(signal, {
      channel: CHANNEL,
      resyncMinIntervalMs: 30,
    });
    let fired = 0;
    bus.onResync(() => {
      fired += 1;
    });
    signal.reconnect();
    signal.reconnect();
    expect(fired).toBe(1);
    const { waitFor } = await import("../../testing/wait-for.js");
    await waitFor(async () => fired === 2);
    await bus.close();
  });
});
