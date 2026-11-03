import { describe, expect, test } from "bun:test";
import {
  openSerializedSavepoint,
  runStatementBehindPendingUnits,
} from "../transaction-serialization.ts";

type FakeTransaction = {
  savepoint: <R>(fn: (sp: unknown) => Promise<R>) => Promise<R>;
};

function createFakeTransaction(log: string[]): FakeTransaction {
  return {
    savepoint: async (fn) => {
      log.push("savepoint:open");
      try {
        return await fn({});
      } finally {
        log.push("savepoint:release");
      }
    },
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 5));

describe("runStatementBehindPendingUnits", () => {
  test("inside a running unit, a plain statement queues behind a sibling unit started in the same unit", async () => {
    const log: string[] = [];
    const tx = createFakeTransaction(log);

    await openSerializedSavepoint(tx, async () => {
      await Promise.all([
        openSerializedSavepoint(tx, async () => {
          log.push("B:start");
          await tick();
          log.push("B:end");
        }),
        runStatementBehindPendingUnits(tx, async () => {
          log.push("plain");
        }),
      ]);
    });

    expect(log.filter((entry) => !entry.startsWith("savepoint"))).toEqual([
      "B:start",
      "B:end",
      "plain",
    ]);
  });

  test("with no unit pending, a plain statement runs directly", async () => {
    const log: string[] = [];
    const tx = createFakeTransaction(log);

    await runStatementBehindPendingUnits(tx, async () => {
      log.push("plain");
    });

    expect(log).toEqual(["plain"]);
  });
});
