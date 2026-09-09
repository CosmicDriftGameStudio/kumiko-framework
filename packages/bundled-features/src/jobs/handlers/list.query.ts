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
  description:
    "Lists job runs across all tenants newest-first, optionally filtered by job name and status; use it to check whether a job ran and whether it succeeded.",
  schema: z.object({
    jobName: z.string().optional(),
    status: z.enum(["queued", "running", "completed", "failed"]).optional(),
    filters: z
      .array(z.object({ field: z.string(), op: z.literal("in"), value: z.array(z.string()) }))
      .optional(),
    sort: z.enum(["jobName", "status", "startedAt", "duration"]).optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
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
    const statusFilter = query.payload.filters?.find((filter) => filter.field === "status");
    const statuses = statusFilter?.value ?? (query.payload.status ? [query.payload.status] : []);
    if (statuses.length === 1) where["status"] = statuses[0];
    const sortColumn = query.payload.sort ?? "startedAt";
    const rows = await selectMany(db, jobRunsTable, where, {
      orderBy: { col: sortColumn, direction: query.payload.sortDirection ?? "desc" },
      limit: query.payload.limit ?? 50,
    });
    // payload/error are stored encrypted under the triggering user's DEK (#799, #2307).
    return { rows: await mapWithConcurrency(rows, KMS_POOL_CONCURRENCY, decryptRunRow), nextCursor: null };
  },
});
