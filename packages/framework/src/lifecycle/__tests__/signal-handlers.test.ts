import { describe, expect, mock, test } from "bun:test";
import { createLifecycle } from "../lifecycle";
import { attachSignalHandlers } from "../signal-handlers";
import { createTestLifecycle } from "./create-test-lifecycle";

describe("attachSignalHandlers", () => {
  test("SIGTERM triggers drain and calls exit(0)", async () => {
    const lc = createLifecycle({ startReady: true });
    const exit = mock();
    const hookCalls: string[] = [];
    lc.registerShutdownHook("spy", async (signal) => {
      hookCalls.push(signal);
    });

    const handle = attachSignalHandlers(lc, { exit, timeoutMs: 50 });
    try {
      process.emit("SIGTERM");
      await waitFor(() => lc.state() === "stopped");
      expect(hookCalls).toEqual(["SIGTERM"]);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      handle.detach();
    }
  });

  test("SIGINT path drains with the right signal label", async () => {
    const lc = createLifecycle({ startReady: true });
    const exit = mock();
    const seen: string[] = [];
    lc.registerShutdownHook("spy", async (signal) => {
      seen.push(signal);
    });

    const handle = attachSignalHandlers(lc, { exit, timeoutMs: 50, signals: ["SIGINT"] });
    try {
      process.emit("SIGINT");
      await waitFor(() => lc.state() === "stopped");
      expect(seen).toEqual(["SIGINT"]);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      handle.detach();
    }
  });

  test("multiple SIGTERMs still call exit exactly once", async () => {
    const lc = createLifecycle({ startReady: true });
    const exit = mock();
    // Slow hook so we can fire additional signals while drain is in-flight.
    lc.registerShutdownHook("slow", async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    const handle = attachSignalHandlers(lc, { exit, timeoutMs: 500 });
    try {
      process.emit("SIGTERM");
      process.emit("SIGTERM");
      process.emit("SIGTERM");
      await waitFor(() => lc.state() === "stopped");
      // Without the exitScheduled guard this would be 3 — the `.then` chains
      // would each fire exit(0) independently.
      expect(exit).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      handle.detach();
    }
  });

  test("exit(1) is called when drain rejects", async () => {
    // Our real lifecycle swallows hook errors internally so drain() always
    // resolves. Mock a drain that rejects to cover the .catch branch —
    // defensive code still needs a test or it rots.
    const brokenLifecycle = createTestLifecycle({
      drain: async () => {
        throw new Error("drain itself exploded");
      },
    });
    const exit = mock();
    const handle = attachSignalHandlers(brokenLifecycle, { exit, signals: ["SIGTERM"] });
    try {
      process.emit("SIGTERM");
      await waitFor(() => exit.mock.calls.length > 0);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      handle.detach();
    }
  });

  test("detach() removes the process listeners", () => {
    const lc = createLifecycle({ startReady: true });
    const exit = mock();
    const before = process.listenerCount("SIGTERM");
    const handle = attachSignalHandlers(lc, { exit, signals: ["SIGTERM"] });
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    handle.detach();
    expect(process.listenerCount("SIGTERM")).toBe(before);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("waitFor timed out");
}
