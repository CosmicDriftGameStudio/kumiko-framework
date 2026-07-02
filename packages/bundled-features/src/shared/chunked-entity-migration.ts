// Shared loop for chunked, idempotent row migrations (secrets KEK rotation,
// config re-encrypt, future entity-field re-encrypts). Owns the operational
// mechanics — abort signal, deadline, failure circuit-breaker, batch
// accounting — while the caller owns the domain: what a batch is and how a
// single row migrates.
//
// Contract notes:
//   - nextBatch() returning an empty array ends the run ("done"). Callers
//     whose batch query re-evaluates (WHERE kek_version != current) converge
//     naturally; full-scan callers return their one batch, then [].
//   - migrateRow returns "migrated" | "skipped" (already current, lost a
//     version_conflict race) | "failed" (counted against maxFailures);
//     throws count as "failed" too and go through onRowError.
//   - Rows that keep failing MAY be re-served by a re-evaluating nextBatch —
//     the circuit-breaker (maxFailures) is what terminates that loop, same
//     semantics the secrets rotate job always had.

export type MigrationRowOutcome = "migrated" | "skipped" | "failed";

export type ChunkedMigrationStopReason = "done" | "timeout" | "signal" | "too_many_failures";

export type ChunkedMigrationResult = {
  readonly migrated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly batchesProcessed: number;
  readonly stoppedReason: ChunkedMigrationStopReason;
};

export type ChunkedMigrationOptions<Row> = {
  readonly nextBatch: () => Promise<readonly Row[]>;
  readonly migrateRow: (row: Row) => Promise<MigrationRowOutcome>;
  readonly maxFailures: number;
  // Epoch ms; Number.POSITIVE_INFINITY for no time bound.
  readonly deadlineAt: number;
  readonly signal?: AbortSignal | undefined;
  readonly onRowError?: (row: Row, err: unknown) => void;
};

export async function runChunkedMigration<Row>(
  opts: ChunkedMigrationOptions<Row>,
): Promise<ChunkedMigrationResult> {
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let batchesProcessed = 0;
  let stoppedReason: ChunkedMigrationStopReason = "done";

  outer: while (true) {
    if (opts.signal?.aborted) {
      stoppedReason = "signal";
      break;
    }
    if (Date.now() >= opts.deadlineAt) {
      stoppedReason = "timeout";
      break;
    }

    const batch = await opts.nextBatch();
    if (batch.length === 0) break;

    batchesProcessed++;

    if (failed >= opts.maxFailures) {
      stoppedReason = "too_many_failures";
      break;
    }

    for (const row of batch) {
      if (failed >= opts.maxFailures) {
        stoppedReason = "too_many_failures";
        break outer;
      }
      let outcome: MigrationRowOutcome;
      try {
        outcome = await opts.migrateRow(row);
      } catch (err) {
        opts.onRowError?.(row, err);
        failed++;
        continue;
      }
      if (outcome === "migrated") migrated++;
      else if (outcome === "skipped") skipped++;
      else failed++;
    }
  }

  return { migrated, skipped, failed, batchesProcessed, stoppedReason };
}
