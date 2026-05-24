import { describe, expect, mock, test } from "bun:test";
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
    const listener = mock();
    lc.onStateChange(listener);
    lc.markReady();
    expect(listener).not.toHaveBeenCalled();
    expect(lc.state()).toBe("ready");
  });

  test("drain runs ready → draining → stopped once, second drain is a no-op", async () => {
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

  test("markReady after drain is a no-op (state=stopped sticks)", async () => {
    const lc = createLifecycle();
    lc.markReady();
    await lc.drain({ timeoutMs: 50 });
    expect(lc.state()).toBe("stopped");

    // Late markReady must not resurrect the lifecycle.
    lc.markReady();
    expect(lc.state()).toBe("stopped");
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

  test("one failing hook does not block the others, and the error is logged", async () => {
    const logger = { error: mock() };
    const lc = createLifecycle({ startReady: true, logger });
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

    // Logging makes the failure visible to prod-ops. Silent swallow hid bugs.
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [msg, ctx] = logger.error.mock.calls[0] as [string, { err: unknown }];
    expect(msg).toMatch(/shutdown hook "broken" threw/);
    expect((ctx.err as Error).message).toBe("boom");
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

  test("hookNames() reflects registration order", () => {
    const lc = createLifecycle({ startReady: true });
    expect(lc.hookNames()).toEqual([]);
    lc.registerShutdownHook("a", async () => {});
    lc.registerShutdownHook("b", async () => {});
    expect(lc.hookNames()).toEqual(["a", "b"]);
  });

  test("hookNames() stays populated after drain (post-mortem ops use-case)", async () => {
    // Contract: the name list is not cleared on drain. An operator inspecting
    // a stopped process should still be able to see which hooks were wired.
    const lc = createLifecycle({ startReady: true });
    lc.registerShutdownHook("a", async () => {});
    lc.registerShutdownHook("b", async () => {});
    await lc.drain({ timeoutMs: 50 });
    expect(lc.state()).toBe("stopped");
    expect(lc.hookNames()).toEqual(["a", "b"]);
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
    const cb = mock();
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

  test("broken listener does not break others, and the error is logged", () => {
    const logger = { error: mock() };
    const lc = createLifecycle({ logger });
    const healthy = mock();
    lc.onStateChange(() => {
      throw new Error("subscriber exploded");
    });
    lc.onStateChange(healthy);
    lc.markReady();
    expect(lc.state()).toBe("ready");
    expect(healthy).toHaveBeenCalledTimes(1);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [msg] = logger.error.mock.calls[0] as [string, unknown];
    expect(msg).toMatch(/onStateChange listener threw during starting→ready/);
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
