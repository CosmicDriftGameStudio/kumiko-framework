import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { type AccessLogDetails, accessLogTable } from "../access-log.ts";
import { AuditQueries } from "../web/constants.ts";
import { requireAuditSystemDb } from "./audit-system-db.ts";

const DEFAULT_LIMIT = 50;

type AccessLogRow = {
  readonly id: string;
  readonly occurredAt: Temporal.Instant;
  readonly actorId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly action: string;
  readonly details: AccessLogDetails;
};

export const accessLogQuery = defineQueryHandler({
  name: "access-log",
  description:
    "Lists the tenant's recorded read accesses (who opened or used which object, e.g. a portal link) newest-first with cursor paging, filterable by subject type, subject id, actor and action; rows are kept per the tenant's compliance profile audit-log retention.",
  schema: z.object({
    subjectType: z.string().max(64).optional(),
    subjectId: z.string().max(128).optional(),
    actorId: z.string().max(128).optional(),
    action: z.string().max(64).optional(),
    before: z.uuid().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  access: { roles: access.admin },
  handler: async (query, ctx) => {
    const p = query.payload;
    const limit = p.limit ?? DEFAULT_LIMIT;
    const db = requireAuditSystemDb(ctx.systemDb, AuditQueries.accessLog).assertTenantMatch(
      query.user.tenantId,
    );
    const where = {
      tenantId: query.user.tenantId,
      ...(p.subjectType !== undefined && { subjectType: p.subjectType }),
      ...(p.subjectId !== undefined && { subjectId: p.subjectId }),
      ...(p.actorId !== undefined && { actorId: p.actorId }),
      ...(p.action !== undefined && { action: p.action }),
      ...(p.before !== undefined && { id: { lt: p.before } }),
    };
    // Ordering by id is chronological: generateId yields UUIDv7, so ids sort by creation time.
    const rows = await db.selectMany<AccessLogRow>(accessLogTable, where, {
      orderBy: { col: "id", direction: "desc" },
      limit,
    });
    const last = rows[rows.length - 1];
    return {
      rows: rows.map((r) => ({
        id: r.id,
        occurredAt: r.occurredAt.toString(),
        actorId: r.actorId,
        subjectType: r.subjectType,
        subjectId: r.subjectId,
        action: r.action,
        details: r.details,
      })),
      nextBefore: last && rows.length === limit ? last.id : null,
    };
  },
});
