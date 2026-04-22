import { fetchOne } from "@kumiko/framework/db";
import { defineQueryHandler } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";

export const detailQuery = defineQueryHandler({
  name: "details",
  schema: z.object({ runId: z.number() }),
  access: { roles: ["SystemAdmin"] },
  handler: async (query, ctx) => {
    const db = ctx.db;

    const row = await fetchOne(db, jobRunsTable, eq(jobRunsTable.id, query.payload.runId));

    if (!row) return null;

    const logs = await db
      .select()
      .from(jobRunLogsTable)
      .where(eq(jobRunLogsTable.runId, query.payload.runId))
      .orderBy(jobRunLogsTable.id);

    return { ...row, logs };
  },
});
