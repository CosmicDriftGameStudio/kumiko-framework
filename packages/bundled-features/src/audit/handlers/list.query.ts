// Audit query — reads the event-store's `events` table directly. The event-
// log IS the audit trail by construction: every entity write appends at least
// one event with createdBy (who), createdAt (when), tenantId (where),
// aggregateType + aggregateId (what), type (action), and payload (delta).
//
// No projection, no separate audit table. Queryable with the same filter
// surface any audit UI needs; tenant-isolated at the WHERE level so cross-
// tenant peeking is structurally impossible for non-SystemAdmin callers.
// A SystemAdmin can pass scope "system" to read the app-instance system events
// (e.g. app.started); list-all-tenants is the one other cross-tenant read.

import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { AUDIT_SCOPE_VALUES } from "../constants.ts";
import {
  AUDIT_DATE_RANGE_CHECK,
  auditListPayloadShape,
  buildAuditWhere,
  listAuditEvents,
} from "./audit-events.ts";
import { requireAuditSystemDb } from "./audit-system-db.ts";
import { resolveAuditScopeFilter } from "./resolve-audit-tenant.ts";

export const listQuery = defineQueryHandler({
  name: "list",
  description:
    'Lists the tenant\'s audit-trail events newest-first with cursor paging, filterable by aggregate type, aggregate id, event type, actor and time range; use it to answer who changed what and when. A SystemAdmin can set scope "system" to read the app-instance system events (e.g. app.started) instead of the own tenant.',
  schema: z
    .object({ ...auditListPayloadShape, scope: z.enum(AUDIT_SCOPE_VALUES).optional() })
    .refine(AUDIT_DATE_RANGE_CHECK.isValid, AUDIT_DATE_RANGE_CHECK.params),
  access: { roles: access.admin },
  handler: async (query, ctx) => {
    const p = query.payload;
    const scopeFilter = resolveAuditScopeFilter(query.user, p.scope);
    const direction = p.sortDirection ?? "desc";
    const where = buildAuditWhere(
      scopeFilter.tenantId,
      { ...p, aggregateType: scopeFilter.aggregateType ?? p.aggregateType },
      direction,
    );
    const db = requireAuditSystemDb(ctx.systemDb, "audit:query:list").assertTenantMatch(
      query.user.tenantId,
    );
    return listAuditEvents(db, where, p, direction);
  },
});
