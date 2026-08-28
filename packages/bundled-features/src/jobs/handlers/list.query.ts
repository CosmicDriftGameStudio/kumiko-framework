import { selectMany, type WhereObject } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { decryptStoredPii, mapWithConcurrency } from "../../shared";
import { jobRunsTable } from "../job-run-table";

const KMS_POOL_CONCURRENCY = 4;

async function decryptRunRow<T extends Record<string, unknown>>(row: T): Promise<T> {
  let result = row;
  if (typeof result["payload"] === "string") {
    result = {
      ...result,
      payload: await decryptStoredPii(result["payload"], "payload", "job-runs"),
    };
  }
  if (typeof result["error"] === "string") {
    result = { ...result, error: await decryptStoredPii(result["error"], "error", "job-runs") };
  }
  return result;
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
    if (!ctx.systemDb) {
      throw new InternalError({
        message: "jobs:query:list requires ctx.systemDb (feature must declare r.systemScope())",
      });
    }
    const db = ctx.systemDb.acknowledgeCrossTenant("cross-tenant job monitoring");
    const where: WhereObject = {};
    if (query.payload.jobName) where["jobName"] = query.payload.jobName;
    if (query.payload.status) where["status"] = query.payload.status;
    const rows = await selectMany(db, jobRunsTable, where, {
      orderBy: { col: "id", direction: "desc" },
      limit: query.payload.limit ?? 50,
    });
    // payload/error are stored encrypted under the triggering user's DEK (#799, #2307).
    return { rows: await mapWithConcurrency(rows, KMS_POOL_CONCURRENCY, decryptRunRow) };
  },
});
