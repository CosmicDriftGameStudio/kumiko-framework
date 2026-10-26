import { describe, expect, test } from "bun:test";
import { type InFlightSyncs, runExclusivePerAccount } from "../sync-account-now.ts";

describe("runExclusivePerAccount", () => {
  test("a second caller for the same account joins the running sync", async () => {
    const inFlight: InFlightSyncs = new Map();
    const gate = Promise.withResolvers<void>();
    let runs = 0;
    const run = async () => {
      runs++;
      await gate.promise;
    };

    const first = runExclusivePerAccount(inFlight, "a", run);
    const second = runExclusivePerAccount(inFlight, "a", run);
    gate.resolve();
    await Promise.all([first, second]);

    expect(runs).toBe(1);
    expect(inFlight.size).toBe(0);
  });

  test("different accounts run side by side, a finished sync can run again", async () => {
    const inFlight: InFlightSyncs = new Map();
    let runs = 0;
    const run = async () => {
      runs++;
    };

    await Promise.all([
      runExclusivePerAccount(inFlight, "a", run),
      runExclusivePerAccount(inFlight, "b", run),
    ]);
    await runExclusivePerAccount(inFlight, "a", run);

    expect(runs).toBe(3);
  });

  test("a failing sync is released so the next one can start", async () => {
    const inFlight: InFlightSyncs = new Map();

    await expect(
      runExclusivePerAccount(inFlight, "a", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(inFlight.size).toBe(0);
  });
});
