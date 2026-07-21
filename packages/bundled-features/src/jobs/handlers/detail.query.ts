import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";

export const detailQuery = defineQueryHandler({
  name: "details",
  // Post-ES: runId is the uuid aggregate-id of the jobRun event-stream.
  // Pre-ES callers passed the serial row-id; the migration is breaking
  // for API callers (intentional — jobs is framework-ops, no external
  // contract). z.uuid() guards against accidental number-id passing.
  schema: z.object({ runId: z.uuid() }),
  access: { roles: ["SystemAdmin"] },
  handler: async (query, ctx) => {
    const db = ctx.db;

    const row = await fetchOne(db, jobRunsTable, { id: query.payload.runId });

    if (!row) return null;

    // payload is stored encrypted under the triggering user's DEK (#799).
    if (typeof row["payload"] === "string") {
      row["payload"] = await decryptStoredPii(row["payload"], "payload", "job-run-detail");
    }

    const logs = await selectMany(
      db,
      jobRunLogsTable,
      { runId: query.payload.runId },
      {
        orderBy: { col: "id", direction: "asc" },
      },
    );

    return { ...row, logs };
  },
});
