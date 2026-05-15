import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { and, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { type JobRunStatus, jobRunsTable } from "../job-run-table";

export const listQuery = defineQueryHandler({
  name: "list",
  schema: z.object({
    jobName: z.string().optional(),
    status: z.enum(["queued", "running", "completed", "failed"]).optional(),
    limit: z.number().optional(),
  }),
  access: { roles: ["SystemAdmin"] },
  handler: async (query, ctx) => {
    const db = ctx.db;
    const conditions: SQL[] = [];

    if (query.payload.jobName) {
      conditions.push(eq(jobRunsTable.jobName, query.payload.jobName));
    }
    if (query.payload.status) {
      conditions.push(eq(jobRunsTable.status, query.payload.status as JobRunStatus)); // @cast-boundary engine-payload
    }

    const limit = query.payload.limit ?? 50;

    const rows = await db
      .select()
      .from(jobRunsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(jobRunsTable.id))
      .limit(limit);

    return { rows };
  },
});
