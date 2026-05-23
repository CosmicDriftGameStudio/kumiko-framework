import { selectMany, type WhereObject } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { jobRunsTable } from "../job-run-table";

export const listQuery = defineQueryHandler({
  name: "list",
  schema: z.object({
    jobName: z.string().optional(),
    status: z.enum(["queued", "running", "completed", "failed"]).optional(),
    limit: z.number().optional(),
  }),
  access: { roles: ["SystemAdmin"] },
  handler: async (query, ctx) => {
    const where: WhereObject = {};
    if (query.payload.jobName) where["jobName"] = query.payload.jobName;
    if (query.payload.status) where["status"] = query.payload.status;
    const rows = await selectMany(ctx.db, jobRunsTable, where, {
      orderBy: { col: "id", direction: "desc" },
      limit: query.payload.limit ?? 50,
    });
    return { rows };
  },
});
