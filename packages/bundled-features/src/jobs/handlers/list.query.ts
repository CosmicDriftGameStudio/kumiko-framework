import { decodeKeysetCursor, encodeKeysetCursor } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler, isUuid, MAX_LIST_LIMIT } from "@cosmicdrift/kumiko-framework/engine";
import { ValidationError } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { WhereObject, WhereOperator } from "@cosmicdrift/kumiko-types/where-clause-types";
import * as z from "zod";
import { mapWithConcurrency } from "@cosmicdrift/kumiko-framework/utils";
import { decryptStoredPii, KMS_POOL_CONCURRENCY, requireSystemDb } from "../../shared/index.ts";
import { jobRunsTable } from "../job-run-table.ts";

const DEFAULT_PAGE_SIZE = 50;

const jobRunStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
const jobRunSortColumnSchema = z.enum(["jobName", "status", "startedAt", "duration"]);

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

type JobRunStatus = z.infer<typeof jobRunStatusSchema>;
type JobRunSortColumn = z.infer<typeof jobRunSortColumnSchema>;
type SortDirection = "asc" | "desc";
type SortValue = string | number | Temporal.Instant;
type KeysetPosition = { readonly sortValue: SortValue | null; readonly id: string };
// sortCondition: undefined = no condition on the sort column, null = IS NULL.
type KeysetSegment = {
  readonly sortCondition: WhereOperator | null | undefined;
  readonly afterId: string | undefined;
};

// Filters are operators, not plain equality, so a keyset condition on the same column joins them with AND.
function buildFilterOperators(payload: {
  readonly jobName?: string | undefined;
  readonly status?: JobRunStatus | undefined;
  readonly filters?: readonly { readonly value: readonly JobRunStatus[] }[] | undefined;
}): Record<string, WhereOperator> {
  const operators: Record<string, WhereOperator> = {};
  if (payload.jobName) operators["jobName"] = { in: [payload.jobName] };
  const statuses = payload.filters?.[0]?.value ?? (payload.status ? [payload.status] : []);
  if (statuses.length > 0) operators["status"] = { in: statuses };
  return operators;
}

// The page continues after `after` in ORDER BY <column> <direction>, id <direction>. Postgres sorts NULL last ascending and first descending; only `duration` is nullable (queued and running runs).
function keysetSegments(
  direction: SortDirection,
  after: KeysetPosition | undefined,
): readonly KeysetSegment[] {
  if (after === undefined) return [{ sortCondition: undefined, afterId: undefined }];
  if (after.sortValue === null) {
    const tiedNulls: KeysetSegment = { sortCondition: null, afterId: after.id };
    return direction === "desc"
      ? [tiedNulls, { sortCondition: { ne: null }, afterId: undefined }]
      : [tiedNulls];
  }
  const value = after.sortValue;
  const segments: KeysetSegment[] = [
    { sortCondition: { gte: value, lte: value }, afterId: after.id },
    { sortCondition: direction === "asc" ? { gt: value } : { lt: value }, afterId: undefined },
  ];
  if (direction === "asc") segments.push({ sortCondition: null, afterId: undefined });
  return segments;
}

function segmentWhere(
  filters: Record<string, WhereOperator>,
  column: JobRunSortColumn,
  direction: SortDirection,
  segment: KeysetSegment,
): WhereObject {
  const where: WhereObject = { ...filters };
  if (segment.sortCondition === null) where[column] = null;
  else if (segment.sortCondition !== undefined) {
    where[column] = { ...filters[column], ...segment.sortCondition };
  }
  if (segment.afterId !== undefined) {
    where["id"] = direction === "asc" ? { gt: segment.afterId } : { lt: segment.afterId };
  }
  return where;
}

function invalidCursorError(): ValidationError {
  return new ValidationError({
    fields: [{ path: "cursor", code: "invalid_cursor", i18nKey: "jobs.errors.invalidCursor" }],
  });
}

function decodeSortValue(column: JobRunSortColumn, raw: string): SortValue | undefined {
  if (column === "startedAt") {
    try {
      return Temporal.Instant.from(raw);
    } catch {
      return undefined;
    }
  }
  if (column === "duration") {
    const duration = Number(raw);
    return Number.isInteger(duration) ? duration : undefined;
  }
  return raw;
}

function parseKeysetCursor(column: JobRunSortColumn, cursor: string): KeysetPosition {
  let decoded: ReturnType<typeof decodeKeysetCursor>;
  try {
    decoded = decodeKeysetCursor(cursor);
  } catch {
    throw invalidCursorError();
  }
  // An id-only cursor (the earlier offset format) carries no sort position.
  if (decoded.sortValue === undefined || !isUuid(decoded.id)) throw invalidCursorError();
  if (decoded.sortValue === null) {
    if (column !== "duration") throw invalidCursorError();
    return { sortValue: null, id: decoded.id };
  }
  const sortValue = decodeSortValue(column, decoded.sortValue);
  if (sortValue === undefined) throw invalidCursorError();
  return { sortValue, id: decoded.id };
}

function encodeJobRunCursor(column: JobRunSortColumn, row: Record<string, unknown>): string {
  const value = row[column];
  return encodeKeysetCursor(
    value === null || value === undefined ? null : String(value),
    String(row["id"]),
  );
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
    sort: jobRunSortColumnSchema.optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
    cursor: z.string().optional(),
    totalCount: z.boolean().optional(),
  }),
  access: { roles: ["SystemAdmin"] },
  handler: async (query, ctx) => {
    const systemDb = requireSystemDb(ctx, "jobs:query:list");
    const db = systemDb.acknowledgeCrossTenant(
      "cross-tenant job monitoring: SystemAdmin lists job runs of every tenant",
    );
    const filters = buildFilterOperators(query.payload);
    const sortColumn = query.payload.sort ?? "startedAt";
    const direction = query.payload.sortDirection ?? "desc";
    const limit = query.payload.limit ?? DEFAULT_PAGE_SIZE;
    const after = query.payload.cursor
      ? parseKeysetCursor(sortColumn, query.payload.cursor)
      : undefined;
    // One probe row past the page tells whether a next page exists.
    const fetched: Record<string, unknown>[] = [];
    for (const segment of keysetSegments(direction, after)) {
      if (fetched.length > limit) break;
      fetched.push(
        ...(await db.selectMany(
          jobRunsTable,
          segmentWhere(filters, sortColumn, direction, segment),
          {
            orderBy: [
              { col: sortColumn, direction },
              { col: "id", direction },
            ],
            limit: limit + 1 - fetched.length,
          },
        )),
      );
    }
    const rows = fetched.slice(0, limit);
    const lastRow = rows[rows.length - 1];
    // count reruns the SAME filters without the limit — `rows.length` is
    // capped at the page size and would silently undercount the total.
    const total =
      query.payload.totalCount === true ? await db.count(jobRunsTable, filters) : undefined;
    // payload/error are stored encrypted under the triggering user's DEK.
    return {
      rows: await mapWithConcurrency(rows, KMS_POOL_CONCURRENCY, decryptRunRow),
      nextCursor:
        fetched.length > limit && lastRow ? encodeJobRunCursor(sortColumn, lastRow) : null,
      ...(total !== undefined && { total }),
    };
  },
});
