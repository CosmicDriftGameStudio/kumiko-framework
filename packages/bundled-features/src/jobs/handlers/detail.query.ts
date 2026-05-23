import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
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

    const logs = await db
      .select()
      .from(jobRunLogsTable)
      .where(eq(jobRunLogsTable.runId, query.payload.runId))
      .orderBy(jobRunLogsTable.id);

    return { ...row, logs };
  },
});
