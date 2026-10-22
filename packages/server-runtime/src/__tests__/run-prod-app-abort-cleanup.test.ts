import { describe, expect, test } from "bun:test";
import { runWithBootAbortCleanups } from "../run-prod-app-config.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("runWithBootAbortCleanups", () => {
  test("runs cleanups in reverse order and rethrows the same error", async () => {
    const order: number[] = [];
    const bootError = new Error("boot failed");
    const result = runWithBootAbortCleanups((register) => {
      register(() => {
        order.push(1);
      });
      register(() => {
        order.push(2);
      });
      register(() => {
        order.push(3);
      });
      return Promise.reject(bootError);
    });
    await expect(result).rejects.toBe(bootError);
    expect(order).toEqual([3, 2, 1]);
  });

  test("a throwing or rejecting cleanup neither stops the rest nor replaces the boot error", async () => {
    const ran: string[] = [];
    const bootError = new Error("boot failed");
    const result = runWithBootAbortCleanups((register) => {
      register(() => {
        ran.push("first");
      });
      register(() => {
        ran.push("rejecting");
        return Promise.reject(new Error("cleanup rejected"));
      });
      register(() => {
        ran.push("sync-throw");
        throw new Error("cleanup threw");
      });
      return Promise.reject(bootError);
    });
    await expect(result).rejects.toBe(bootError);
    expect(ran).toEqual(["sync-throw", "rejecting", "first"]);
  });

  test("a successful boot runs no cleanup and returns its value", async () => {
    let cleanups = 0;
    const value = await runWithBootAbortCleanups((register) => {
      register(() => {
        cleanups++;
      });
      return Promise.resolve("handle");
    });
    expect(value).toBe("handle");
    expect(cleanups).toBe(0);
  });

  test("async cleanups run one after the other", async () => {
    const gate = deferred();
    const firstStarted = deferred();
    const events: string[] = [];
    const result = runWithBootAbortCleanups((register) => {
      register(() => {
        events.push("second-start");
      });
      register(async () => {
        events.push("first-start");
        firstStarted.resolve();
        await gate.promise;
        events.push("first-end");
      });
      return Promise.reject(new Error("boot failed"));
    });
    const settled = result.catch(() => undefined);
    // A concurrent runner would have started the second cleanup in the same microtask round.
    await firstStarted.promise;
    expect(events).toEqual(["first-start"]);
    gate.resolve();
    await settled;
    expect(events).toEqual(["first-start", "first-end", "second-start"]);
  });
});
