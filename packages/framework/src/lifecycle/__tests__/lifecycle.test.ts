import { describe, expect, test, vi } from "vitest";
import { createLifecycle } from "../lifecycle";

describe("lifecycle — state machine", () => {
  test("starts in 'starting' by default", () => {
    const lc = createLifecycle();
    expect(lc.state()).toBe("starting");
  });

  test("startReady option skips 'starting'", () => {
    const lc = createLifecycle({ startReady: true });
    expect(lc.state()).toBe("ready");
  });

  test("markReady transitions starting → ready", () => {
    const lc = createLifecycle();
    lc.markReady();
    expect(lc.state()).toBe("ready");
  });

  test("markReady from 'ready' is a no-op", () => {
    const lc = createLifecycle({ startReady: true });
    const listener = vi.fn();
    lc.onStateChange(listener);
    lc.markReady();
    expect(listener).not.toHaveBeenCalled();
    expect(lc.state()).toBe("ready");
  });

  test("drain cannot move backwards — ready → draining → stopped, then stopped sticks", async () => {
    const lc = createLifecycle({ startReady: true });
    const transitions: string[] = [];
    lc.onStateChange((_, to) => transitions.push(to));
    await lc.drain({ timeoutMs: 100 });
    expect(lc.state()).toBe("stopped");
    expect(transitions).toEqual(["draining", "stopped"]);

    // Second drain is a no-op — hooks must not run twice on double-SIGTERM.
    await lc.drain({ timeoutMs: 100 });
    expect(transitions).toEqual(["draining", "stopped"]);
  });
});

describe("lifecycle — shutdown hooks", () => {
  test("hooks run in LIFO order", async () => {
    const lc = createLifecycle({ startReady: true });
    const calls: string[] = [];
    lc.registerShutdownHook("first", async () => {
      calls.push("first");
    });
    lc.registerShutdownHook("second", async () => {
      calls.push("second");
    });
    lc.registerShutdownHook("third", async () => {
      calls.push("third");
    });
    await lc.drain({ timeoutMs: 100 });
    expect(calls).toEqual(["third", "second", "first"]);
  });

  test("one failing hook does not block the others", async () => {
    const lc = createLifecycle({ startReady: true });
    const calls: string[] = [];
    lc.registerShutdownHook("healthy-a", async () => {
      calls.push("healthy-a");
    });
    lc.registerShutdownHook("broken", async () => {
      throw new Error("boom");
    });
    lc.registerShutdownHook("healthy-b", async () => {
      calls.push("healthy-b");
    });
    await expect(lc.drain({ timeoutMs: 100 })).resolves.toBeUndefined();
    expect(calls).toEqual(["healthy-b", "healthy-a"]);
    expect(lc.state()).toBe("stopped");
  });

  test("registering after draining throws", async () => {
    const lc = createLifecycle({ startReady: true });
    await lc.drain({ timeoutMs: 50 });
    expect(() => lc.registerShutdownHook("too-late", async () => {})).toThrow(/already stopped/);
  });

  test("hook receives the signal name that triggered drain", async () => {
    const lc = createLifecycle({ startReady: true });
    const seen: string[] = [];
    lc.registerShutdownHook("spy", async (signal) => {
      seen.push(signal);
    });
    await lc.drain({ signal: "SIGTERM", timeoutMs: 50 });
    expect(seen).toEqual(["SIGTERM"]);
  });
});

describe("lifecycle — drain timeout", () => {
  test("timeout forces state to 'stopped' even if hook hangs", async () => {
    const lc = createLifecycle({ startReady: true });
    // Hook that never resolves — drain must force-stop via its timer.
    lc.registerShutdownHook("hangs-forever", () => new Promise<void>(() => {}));

    await lc.drain({ timeoutMs: 20 });
    expect(lc.state()).toBe("stopped");
  });

  test("concurrent drain calls share the in-flight promise", async () => {
    const lc = createLifecycle({ startReady: true });
    let runs = 0;
    lc.registerShutdownHook("count", async () => {
      runs++;
    });
    const [a, b, c] = await Promise.all([
      lc.drain({ timeoutMs: 100 }),
      lc.drain({ timeoutMs: 100 }),
      lc.drain({ timeoutMs: 100 }),
    ]);
    expect(runs).toBe(1);
    expect([a, b, c]).toEqual([undefined, undefined, undefined]);
  });
});

describe("lifecycle — onStateChange", () => {
  test("subscribers receive from/to pairs", async () => {
    const lc = createLifecycle();
    const events: Array<[string, string]> = [];
    lc.onStateChange((from, to) => events.push([from, to]));
    lc.markReady();
    await lc.drain({ timeoutMs: 50 });
    expect(events).toEqual([
      ["starting", "ready"],
      ["ready", "draining"],
      ["draining", "stopped"],
    ]);
  });

  test("unsubscribe stops further callbacks", () => {
    const lc = createLifecycle();
    const cb = vi.fn();
    const unsubscribe = lc.onStateChange(cb);
    lc.markReady();
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
    // No more state changes expected to reach cb.
    cb.mockClear();
    // Trigger another transition — should not call cb.
    void lc.drain({ timeoutMs: 50 });
    expect(cb).not.toHaveBeenCalled();
  });

  test("broken listener does not break others or the state machine", () => {
    const lc = createLifecycle();
    const healthy = vi.fn();
    lc.onStateChange(() => {
      throw new Error("subscriber exploded");
    });
    lc.onStateChange(healthy);
    lc.markReady();
    expect(lc.state()).toBe("ready");
    expect(healthy).toHaveBeenCalledTimes(1);
  });
});

describe("lifecycle — uptimeSec", () => {
  test("counts seconds since construction using injected clock", () => {
    let t = 1_000_000;
    const lc = createLifecycle({ now: () => t });
    expect(lc.uptimeSec()).toBe(0);
    t += 3_500;
    expect(lc.uptimeSec()).toBe(3);
  });
});
