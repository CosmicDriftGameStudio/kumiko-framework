import { describe, expect, test } from "bun:test";
import type { BulkRowOutcome } from "../../data-table-bulk-types.ts";
import type { ListRowViewModel } from "../../headless/index.ts";
import { BULK_WRITE_CONCURRENCY, runBulkWrites } from "../use-bulk-run.ts";

function rowsOf(count: number): readonly ListRowViewModel[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `r${index + 1}`,
    values: { id: `r${index + 1}`, locked: index === 1 },
  }));
}

const SUCCEEDED: BulkRowOutcome = { kind: "succeeded" };

// Writes stay pending until the test settles them, so concurrency and cancel are observable.
function heldWrites() {
  const pending: { readonly rowId: string; readonly settle: (outcome: BulkRowOutcome) => void }[] =
    [];
  let peak = 0;
  let running = 0;
  return {
    pending,
    peak: () => peak,
    writeRow: (row: ListRowViewModel) =>
      new Promise<BulkRowOutcome>((resolve) => {
        running += 1;
        peak = Math.max(peak, running);
        pending.push({
          rowId: row.id,
          settle: (outcome) => {
            running -= 1;
            resolve(outcome);
          },
        });
      }),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("runBulkWrites", () => {
  test("writes every row once with at most four writes in flight", async () => {
    const writes = heldWrites();
    const run = runBulkWrites({
      rows: rowsOf(10),
      action: { appliesTo: () => true, writeRow: writes.writeRow },
      isCancelled: () => false,
    });
    let settled = 0;
    while (settled < 10) {
      await flush();
      const batch = writes.pending.splice(0);
      for (const write of batch) write.settle(SUCCEEDED);
      settled += batch.length;
    }
    const result = await run;
    expect(writes.peak()).toBe(BULK_WRITE_CONCURRENCY);
    expect([...result.succeededIds].sort()).toEqual(
      rowsOf(10)
        .map((row) => row.id)
        .sort(),
    );
    expect(result.failedIds).toEqual([]);
  });

  test("counts rows the action does not apply to as skipped without writing them", async () => {
    const written: string[] = [];
    const result = await runBulkWrites({
      rows: rowsOf(3),
      action: {
        appliesTo: (row) => row.values["locked"] !== true,
        writeRow: async (row) => {
          written.push(row.id);
          return SUCCEEDED;
        },
      },
      isCancelled: () => false,
    });
    expect(written).toEqual(["r1", "r3"]);
    expect(result.skippedIds).toEqual(["r2"]);
    expect(result.succeededIds).toEqual(["r1", "r3"]);
  });

  test("a rejected or throwing write fails only its own row and keeps the first message", async () => {
    const result = await runBulkWrites({
      rows: rowsOf(3),
      action: {
        appliesTo: () => true,
        writeRow: async (row) => {
          if (row.id === "r1") return { kind: "failed", message: "No access" };
          if (row.id === "r2") throw new Error("network down");
          return SUCCEEDED;
        },
      },
      isCancelled: () => false,
      concurrency: 1,
    });
    expect(result.failedIds).toEqual(["r1", "r2"]);
    expect(result.succeededIds).toEqual(["r3"]);
    expect(result.firstFailureMessage).toBe("No access");
  });

  test("cancel lets running writes finish and starts no new ones", async () => {
    const writes = heldWrites();
    let cancelled = false;
    const run = runBulkWrites({
      rows: rowsOf(10),
      action: { appliesTo: () => true, writeRow: writes.writeRow },
      isCancelled: () => cancelled,
    });
    await flush();
    expect(writes.pending.map((write) => write.rowId)).toEqual(["r1", "r2", "r3", "r4"]);
    cancelled = true;
    for (const write of writes.pending.splice(0)) write.settle(SUCCEEDED);
    const result = await run;
    expect(writes.pending).toEqual([]);
    expect(result.succeededIds).toEqual(["r1", "r2", "r3", "r4"]);
    expect(result.notStartedIds).toEqual(["r5", "r6", "r7", "r8", "r9", "r10"]);
  });
});
