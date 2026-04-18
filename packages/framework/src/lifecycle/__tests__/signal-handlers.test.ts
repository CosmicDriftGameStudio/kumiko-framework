import { describe, expect, test, vi } from "vitest";
import { createLifecycle } from "../lifecycle";
import { attachSignalHandlers } from "../signal-handlers";

describe("attachSignalHandlers", () => {
  test("SIGTERM triggers drain and calls exit(0)", async () => {
    const lc = createLifecycle({ startReady: true });
    const exit = vi.fn();
    const hookCalls: string[] = [];
    lc.registerShutdownHook("spy", async (signal) => {
      hookCalls.push(signal);
    });

    const handle = attachSignalHandlers(lc, { exit, timeoutMs: 50 });
    try {
      process.emit("SIGTERM");
      // Drain is async; wait for the state to settle.
      await waitFor(() => lc.state() === "stopped");
      expect(hookCalls).toEqual(["SIGTERM"]);
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      handle.detach();
    }
  });

  test("detach() removes the process listeners", () => {
    const lc = createLifecycle({ startReady: true });
    const exit = vi.fn();
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
