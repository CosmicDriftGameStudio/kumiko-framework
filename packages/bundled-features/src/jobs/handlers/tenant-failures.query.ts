import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantJobFailuresTable } from "../tenant-job-failure-table";

type TenantJobFailureRow = {
  readonly tenantId: string;
  readonly jobName: string;
  readonly subject: string | null;
  readonly messageKey: string;
  readonly failedAt: Temporal.Instant;
};

const DEFAULT_LIMIT = 50;

// Mirrors job-runner.ts's jobSubjectKey: sorted field names, so a caller that
// passes the same subject values gets the same string the writer stored.
function subjectKey(subject: Record<string, string | number | boolean | null>): string {
  return JSON.stringify(
    Object.keys(subject)
      .sort()
      .map((field) => [field, subject[field] ?? null]),
  );
}

function parseSubject(stored: string | null): Record<string, unknown> | null {
  if (stored === null) return null;
  // @cast-boundary stored-json — written by jobSubjectKey as an entry array
  return Object.fromEntries(JSON.parse(stored) as [string, unknown][]);
}

export const tenantFailuresQuery = defineQueryHandler({
  name: "failures",
  description:
    "Lists the calling tenant's own failed jobs — one record per job and subject, newest first, each carrying a translation key for the reason, never the provider's own error message; use it to tell a tenant that their asynchronous job failed instead of leaving the screen waiting.",
  schema: z.object({
    jobName: z.string().optional(),
    subject: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    limit: z.number().min(1).max(200).optional(),
  }),
  // Every membership rank: a failure record carries a job name and a
  // translation key, nothing a team member of the tenant may not see.
  access: { roles: access.roles("User", "Editor", ...access.admin) },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message: "jobs:query:failures requires ctx.systemDb (feature must declare r.systemScope())",
      });
    }
    // assertTenantMatch is a self-check on the caller and returns the same
    // unfiltered system-mode db (tenant-db.ts) — the explicit tenantId below
    // is the filter, assertRowsTenant the second net. There is no
    // cross-tenant mode here: SystemAdmin reads runs via jobs:query:list.
    const db = ctx.systemDb.assertTenantMatch(query.user.tenantId);
    const where: Record<string, unknown> = { tenantId: [query.user.tenantId] };
    if (query.payload.jobName) where["jobName"] = query.payload.jobName;
    if (query.payload.subject) where["subject"] = subjectKey(query.payload.subject);
    const rows = await selectMany<TenantJobFailureRow>(db, tenantJobFailuresTable, where, {
      orderBy: { col: "failedAt", direction: "desc" },
      limit: query.payload.limit ?? DEFAULT_LIMIT,
    });
    return {
      rows: ctx.systemDb.assertRowsTenant(rows, "tenantId").map((row) => ({
        jobName: row.jobName,
        subject: parseSubject(row.subject),
        messageKey: row.messageKey,
        failedAt: row.failedAt,
      })),
      nextCursor: null,
    };
  },
});
