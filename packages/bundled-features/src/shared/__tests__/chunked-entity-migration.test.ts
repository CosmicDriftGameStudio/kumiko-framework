import { describe, expect, test } from "bun:test";
import { runChunkedMigration } from "../chunked-entity-migration";

describe("runChunkedMigration", () => {
  test("processes all batches and stops with 'done' when nextBatch returns empty", async () => {
    const batches: readonly number[][] = [[1, 2], [3], []];
    let call = 0;
    const migrated: number[] = [];

    const result = await runChunkedMigration<number>({
      nextBatch: async () => batches[call++] ?? [],
      migrateRow: async (row) => {
        migrated.push(row);
        return "migrated";
      },
      maxFailures: 10,
      deadlineAt: Number.POSITIVE_INFINITY,
    });

    expect(migrated).toEqual([1, 2, 3]);
    expect(result).toEqual({
      migrated: 3,
      skipped: 0,
      failed: 0,
      batchesProcessed: 2,
      stoppedReason: "done",
    });
  });

  test("counts skipped and failed outcomes separately from migrated", async () => {
    let call = 0;
    const rows = [
      { id: 1, outcome: "migrated" as const },
      { id: 2, outcome: "skipped" as const },
      { id: 3, outcome: "failed" as const },
    ];

    const result = await runChunkedMigration({
      nextBatch: async () => (call++ === 0 ? rows : []),
      migrateRow: async (row) => row.outcome,
      maxFailures: 10,
      deadlineAt: Number.POSITIVE_INFINITY,
    });

    expect(result.migrated).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.stoppedReason).toBe("done");
  });

  test("a thrown migrateRow counts as failed and invokes onRowError", async () => {
    let call = 0;
    const errors: unknown[] = [];
    const boom = new Error("boom");

    const result = await runChunkedMigration<number>({
      nextBatch: async () => (call++ === 0 ? [1] : []),
      migrateRow: async () => {
        throw boom;
      },
      maxFailures: 10,
      deadlineAt: Number.POSITIVE_INFINITY,
      onRowError: (row, err) => errors.push([row, err]),
    });

    expect(result.failed).toBe(1);
    expect(errors).toEqual([[1, boom]]);
  });

  test("stops with 'too_many_failures' once failed >= maxFailures, mid-batch", async () => {
    let call = 0;
    const seen: number[] = [];

    const result = await runChunkedMigration<number>({
      nextBatch: async () => (call++ === 0 ? [1, 2, 3] : []),
      migrateRow: async (row) => {
        seen.push(row);
        return "failed";
      },
      maxFailures: 2,
      deadlineAt: Number.POSITIVE_INFINITY,
    });

    // The circuit-breaker checks before each row — row 3 is never attempted.
    expect(seen).toEqual([1, 2]);
    expect(result.failed).toBe(2);
    expect(result.stoppedReason).toBe("too_many_failures");
  });

  test("stops with 'too_many_failures' checked between batches too", async () => {
    let call = 0;
    const batches = [["a"], ["b"], ["c"]];

    const result = await runChunkedMigration<string>({
      nextBatch: async () => batches[call++] ?? [],
      migrateRow: async () => "failed",
      maxFailures: 1,
      deadlineAt: Number.POSITIVE_INFINITY,
    });

    // Batch 1 processes "a" and pushes failed to 1; the breaker is only
    // checked at the TOP of the loop, so batch 2 is fetched (batchesProcessed
    // becomes 2) before the breaker trips and its row is never touched.
    expect(result.batchesProcessed).toBe(2);
    expect(result.stoppedReason).toBe("too_many_failures");
  });

  test("stops with 'timeout' once the deadline has passed, without calling nextBatch again", async () => {
    let nextBatchCalls = 0;

    const result = await runChunkedMigration<number>({
      nextBatch: async () => {
        nextBatchCalls++;
        return [];
      },
      migrateRow: async () => "migrated",
      maxFailures: 10,
      deadlineAt: Date.now() - 1,
    });

    expect(nextBatchCalls).toBe(0);
    expect(result.batchesProcessed).toBe(0);
    expect(result.stoppedReason).toBe("timeout");
  });

  test("stops with 'signal' when the AbortSignal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let nextBatchCalls = 0;

    const result = await runChunkedMigration<number>({
      nextBatch: async () => {
        nextBatchCalls++;
        return [];
      },
      migrateRow: async () => "migrated",
      maxFailures: 10,
      deadlineAt: Number.POSITIVE_INFINITY,
      signal: controller.signal,
    });

    expect(nextBatchCalls).toBe(0);
    expect(result.stoppedReason).toBe("signal");
  });
});
