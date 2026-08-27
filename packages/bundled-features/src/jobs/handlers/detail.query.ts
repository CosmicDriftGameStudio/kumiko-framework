import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { decryptStoredPii, mapWithConcurrency } from "../../shared";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";

// Matches job-run-logger.ts's KMS_POOL_CONCURRENCY / the tenant handlers'
// KMS_POOL_CONCURRENCY — bounds concurrent decrypt calls against the KMS
// adapter's connection pool.
const KMS_POOL_CONCURRENCY = 4;

export const detailQuery = defineQueryHandler({
  name: "details",
  // Post-ES: runId is the uuid aggregate-id of the jobRun event-stream.
  // Pre-ES callers passed the serial row-id; the migration is breaking
  // for API callers (intentional — jobs is framework-ops, no external
  // contract). z.uuid() guards against accidental number-id passing.
  schema: z.object({ runId: z.uuid() }),
  access: { roles: ["SystemAdmin"] },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message: "jobs:query:details requires ctx.systemDb (feature must declare r.systemScope())",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant("cross-tenant job monitoring");

    const row = await fetchOne(db, jobRunsTable, { id: query.payload.runId });

    if (!row) return null;

    // payload is stored encrypted under the triggering user's DEK (#799).
    if (typeof row["payload"] === "string") {
      row["payload"] = await decryptStoredPii(row["payload"], "payload", "job-run-detail");
    }

    // error is stored encrypted under the triggering user's DEK (#2307),
    // same mechanism as row.payload above.
    if (typeof row["error"] === "string") {
      row["error"] = await decryptStoredPii(row["error"], "error", "job-run-detail");
    }

    const logs = await selectMany(
      db,
      jobRunLogsTable,
      { runId: query.payload.runId },
      {
        orderBy: { col: "id", direction: "asc" },
      },
    );

    // message is stored encrypted under the triggering user's DEK (#2247),
    // same mechanism as row.payload above. Bounded concurrency (#2307) —
    // unbounded Promise.all would fire one decrypt per log line at once
    // against the KMS adapter's pool.
    const decryptedLogs = await mapWithConcurrency(logs, KMS_POOL_CONCURRENCY, async (log) => {
      if (typeof log["message"] !== "string") return log;
      return {
        ...log,
        message: await decryptStoredPii(log["message"], "message", "job-run-detail-log"),
      };
    });

    return { ...row, logs: decryptedLogs };
  },
});
