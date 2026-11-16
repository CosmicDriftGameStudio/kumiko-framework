import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { decryptStoredPii, decryptStoredPiiValues, requireSystemDb } from "../../shared/index.ts";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table.ts";

export const detailQuery = defineQueryHandler({
  name: "details",
  description:
    "Returns one job run across all tenants by its run id with status, timings, decrypted payload, error and its full log lines; use it to investigate why a run failed.",
  // Post-ES: runId is the uuid aggregate-id of the jobRun event-stream.
  // Pre-ES callers passed the serial row-id; the migration is breaking
  // for API callers (intentional — jobs is framework-ops, no external
  // contract). z.uuid() guards against accidental number-id passing.
  schema: z.object({ runId: z.uuid() }),
  access: { roles: ["SystemAdmin"] },
  handler: async (query, ctx) => {
    const systemDb = requireSystemDb(ctx, "jobs:query:details");
    const db = systemDb.acknowledgeCrossTenant("cross-tenant job monitoring");

    const row = await fetchOne(db, jobRunsTable, { id: query.payload.runId });

    if (!row) return null;

    // payload is stored encrypted under the triggering user's DEK.
    if (typeof row["payload"] === "string") {
      row["payload"] = await decryptStoredPii(row["payload"], "payload", "job-run-detail");
    }

    // error is stored encrypted under the triggering user's DEK,
    // same mechanism as row.payload above.
    if (typeof row["error"] === "string") {
      row["error"] = await decryptStoredPii(row["error"], "error", "job-run-detail");
    }

    const logs = await selectMany<{ readonly message: string } & Record<string, unknown>>(
      db,
      jobRunLogsTable,
      { runId: query.payload.runId },
      {
        orderBy: { col: "id", direction: "asc" },
      },
    );

    // message is stored encrypted under the triggering user's DEK, same
    // mechanism as row.payload above; one key lookup for all lines.
    const messages = await decryptStoredPiiValues(
      logs.map((log) => log.message),
      "message",
      "job-run-detail-log",
    );
    const decryptedLogs = logs.map((log, index) => ({
      ...log,
      message: messages[index] ?? log.message,
    }));

    return { ...row, logs: decryptedLogs };
  },
});
