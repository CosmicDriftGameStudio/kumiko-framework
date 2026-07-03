import { selectMany, type WhereObject } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
import { jobRunsTable } from "../job-run-table";

async function decryptRunPayload<T extends Record<string, unknown>>(row: T): Promise<T> {
  if (typeof row["payload"] !== "string") return row;
  return { ...row, payload: await decryptStoredPii(row["payload"], "job-runs") };
}

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
    // payload is stored encrypted under the triggering user's DEK (#799).
    return { rows: await Promise.all(rows.map(decryptRunPayload)) };
  },
});
