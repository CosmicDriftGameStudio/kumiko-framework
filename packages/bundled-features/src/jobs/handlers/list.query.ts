import { countWhere, selectMany, type WhereObject } from "@cosmicdrift/kumiko-framework/bun-db";
import { decodeCursor, encodeCursor } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError, ValidationError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { decryptStoredPii, mapWithConcurrency } from "../../shared/index.js";
import { jobRunsTable } from "../job-run-table.js";

const KMS_POOL_CONCURRENCY = 4;
const DEFAULT_PAGE_SIZE = 50;

const jobRunStatusSchema = z.enum(["queued", "running", "completed", "failed"]);

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
    status: jobRunStatusSchema.optional(),
    filters: z
      .array(
        z.object({
          field: z.literal("status"),
          op: z.literal("in"),
          value: z.array(jobRunStatusSchema),
        }),
      )
      .optional(),
    sort: z.enum(["jobName", "status", "startedAt", "duration"]).optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
    limit: z.number().optional(),
    cursor: z.string().optional(),
    totalCount: z.boolean().optional(),
  }),
  access: { roles: ["SystemAdmin"] },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message: "jobs:query:list requires ctx.systemDb (feature must declare r.systemScope())",
      });
    }
    const db = ctx.systemDb.unsafeRaw(
      "cross-tenant job monitoring: SystemAdmin lists job runs of every tenant",
    );
    const where: WhereObject = {};
    if (query.payload.jobName) where["jobName"] = query.payload.jobName;
    const statusFilter = query.payload.filters?.find((filter) => filter.field === "status");
    const statuses = statusFilter?.value ?? (query.payload.status ? [query.payload.status] : []);
    if (statuses.length === 1) where["status"] = statuses[0];
    else if (statuses.length > 1) where["status"] = { in: statuses };
    const sortColumn = query.payload.sort ?? "startedAt";
    const limit = query.payload.limit ?? DEFAULT_PAGE_SIZE;
    const offset = query.payload.cursor ? Number(decodeCursor(query.payload.cursor)) : 0;
    if (!Number.isInteger(offset) || offset < 0) {
      throw new ValidationError({
        fields: [{ path: "cursor", code: "invalid_cursor", i18nKey: "jobs.errors.invalidCursor" }],
      });
    }
    const direction = query.payload.sortDirection ?? "desc";
    // selectMany has no OFFSET: read through the end of the page plus one probe
    // row, then slice. `id` as tiebreaker keeps pages stable for non-unique sorts.
    const fetched = await selectMany(db, jobRunsTable, where, {
      orderBy: [
        { col: sortColumn, direction },
        { col: "id", direction },
      ],
      limit: offset + limit + 1,
    });
    const hasMore = fetched.length > offset + limit;
    const rows = fetched.slice(offset, offset + limit);
    // countWhere reruns the SAME `where` without the limit — `rows.length` is
    // capped at the page size and would silently undercount the total.
    const total =
      query.payload.totalCount === true ? await countWhere(db, jobRunsTable, where) : undefined;
    // payload/error are stored encrypted under the triggering user's DEK (#799, #2307).
    return {
      rows: await mapWithConcurrency(rows, KMS_POOL_CONCURRENCY, decryptRunRow),
      nextCursor: hasMore ? encodeCursor(String(offset + limit)) : null,
      ...(total !== undefined && { total }),
    };
  },
});
