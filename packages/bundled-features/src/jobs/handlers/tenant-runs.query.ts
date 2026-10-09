import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { serializeJobSubject } from "@cosmicdrift/kumiko-framework/jobs";
import { parseJsonSafe } from "@cosmicdrift/kumiko-framework/utils";
import * as z from "zod";
import { type TenantJobRunStatus, tenantJobRunsTable } from "../tenant-job-run-table.js";

type TenantJobRunRow = {
  readonly tenantId: string;
  readonly jobName: string;
  readonly subject: string | null;
  readonly status: TenantJobRunStatus;
  readonly queuedAt: Temporal.Instant | null;
  readonly startedAt: Temporal.Instant | null;
  readonly finishedAt: Temporal.Instant | null;
  readonly updatedAt: Temporal.Instant;
};

const DEFAULT_LIMIT = 50;

function isSubjectEntry(value: unknown): value is [string, unknown] {
  return Array.isArray(value) && typeof value[0] === "string";
}

function parseSubject(stored: string | null): Record<string, unknown> | null {
  if (stored === null) return null;
  // A corrupt subject must not fail the whole list; parseJsonSafe only
  // survives a SyntaxError, so the shape needs its own check.
  const parsed = parseJsonSafe<unknown>(stored, null);
  if (!Array.isArray(parsed)) return null;
  return Object.fromEntries(parsed.filter(isSubjectEntry));
}

export const tenantRunsQuery = defineQueryHandler({
  name: "tenant-runs",
  description:
    "Lists the calling tenant's own job runs that opted in via tenantVisibleRun — per job and subject every queued or running run plus the latest completed or failed one, active runs first, then newest first; each row carries only status and queuedAt/startedAt/finishedAt, never payloads, error text or logs; the optional subject filter matches exactly: all declared subjectFields with the same JSON types as the job payload; use it to show whether work for a subject is waiting, running or done, and to tell a failed run from a finished one.",
  schema: z.object({
    jobName: z.string().optional(),
    subject: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  }),
  // Every membership rank: a run state carries a job name, a status and
  // times, nothing a team member of the tenant may not see.
  access: { roles: access.roles("User", "Editor", ...access.admin) },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "jobs:query:tenant-runs requires ctx.systemDb (feature must declare r.systemScope())",
      });
    }
    // assertTenantMatch returns the same unfiltered system-mode db — the
    // explicit tenantId below is the filter, assertRowsTenant the second net.
    const db = ctx.systemDb.assertTenantMatch(query.user.tenantId);
    const where: Record<string, unknown> = { tenantId: [query.user.tenantId] };
    if (query.payload.jobName) where["jobName"] = query.payload.jobName;
    if (query.payload.subject) where["subject"] = serializeJobSubject(query.payload.subject);
    const limit = query.payload.limit ?? DEFAULT_LIMIT;
    const newestFirst = { col: "updatedAt", direction: "desc" } as const;
    const activeRows = await selectMany<TenantJobRunRow>(
      db,
      tenantJobRunsTable,
      { ...where, status: { in: ["queued", "running"] } },
      { orderBy: newestFirst, limit },
    );
    const finishedRows = await selectMany<TenantJobRunRow>(
      db,
      tenantJobRunsTable,
      { ...where, status: { in: ["completed", "failed"] } },
      { orderBy: newestFirst, limit },
    );
    const seenFinishedKeys = new Set<string>();
    const finishedNewestPerKey = finishedRows.filter((row) => {
      const key = JSON.stringify([row.jobName, row.subject]);
      if (seenFinishedKeys.has(key)) return false;
      seenFinishedKeys.add(key);
      return true;
    });
    const activeFirst = [...activeRows, ...finishedNewestPerKey];
    return {
      rows: ctx.systemDb.assertRowsTenant(activeFirst.slice(0, limit), "tenantId").map((row) => ({
        jobName: row.jobName,
        subject: parseSubject(row.subject),
        status: row.status,
        queuedAt: row.queuedAt,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
      })),
      nextCursor: null,
    };
  },
});
