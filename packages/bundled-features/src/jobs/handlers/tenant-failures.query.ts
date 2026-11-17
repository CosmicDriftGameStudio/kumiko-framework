import { scopeTenantDbToTenant, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { serializeJobSubject } from "@cosmicdrift/kumiko-framework/jobs";
import * as z from "zod";
import { parseSubject } from "../parse-subject.ts";
import { tenantJobFailuresTable } from "../tenant-job-failure-table.ts";

type TenantJobFailureRow = {
  readonly tenantId: string;
  readonly jobName: string;
  readonly subject: string | null;
  readonly messageKey: string;
  readonly failedAt: Temporal.Instant;
};

const DEFAULT_LIMIT = 50;

export function createTenantFailuresQuery(readRoles: readonly string[]) {
  return defineQueryHandler({
    name: "failures",
    description:
      "Lists the calling tenant's own failed jobs — one record per job and subject, newest first, each carrying a translation key for the reason, never the provider's own error message; the optional subject filter matches exactly: all declared subjectFields with the same JSON types as the job payload; use it to tell a tenant that their asynchronous job failed instead of leaving the screen waiting.",
    schema: z.object({
      jobName: z.string().optional(),
      subject: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }),
    // Every membership rank: a failure record carries a job name and a
    // translation key, nothing a team member of the tenant may not see.
    access: {
      roles: [...new Set([...access.roles("User", "Editor", ...access.admin), ...readRoles])],
    },
    systemScope: true,
    handler: async (query, ctx) => {
      const { systemDb } = ctx;
      // Tenant-mode db so filter and RLS are restricted to the caller's tenant;
      // the explicit tenantId filter below also excludes SYSTEM_TENANT_ID rows,
      // which tenant-mode reads let through. There is no cross-tenant mode
      // here: SystemAdmin reads runs via jobs:query:list.
      const db = scopeTenantDbToTenant(
        systemDb.assertTenantMatch(query.user.tenantId),
        query.user.tenantId,
      );
      const where: Record<string, unknown> = { tenantId: [query.user.tenantId] };
      if (query.payload.jobName) where["jobName"] = query.payload.jobName;
      if (query.payload.subject) where["subject"] = serializeJobSubject(query.payload.subject);
      const rows = await selectMany<TenantJobFailureRow>(db, tenantJobFailuresTable, where, {
        orderBy: { col: "failedAt", direction: "desc" },
        limit: query.payload.limit ?? DEFAULT_LIMIT,
      });
      return {
        rows: rows.map((row) => ({
          jobName: row.jobName,
          subject: parseSubject(row.subject),
          messageKey: row.messageKey,
          failedAt: row.failedAt,
        })),
        nextCursor: null,
      };
    },
  });
}
