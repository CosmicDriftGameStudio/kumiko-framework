// Single audit event by its event-store id — backs the audit-log-detail
// screen. Tenant-isolated at the WHERE level like list.query, so a caller
// can only read events in their own tenant; a SystemAdmin can pass scope
// "system" to read app-instance system events (e.g. app.started).

import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { AUDIT_SCOPE_VALUES } from "../web/constants.ts";
import {
  aggregateTypeCondition,
  auditEventIdSchema,
  createEntityNounKeyResolver,
  loadAuditEvent,
} from "./audit-events.ts";
import { requireAuditSystemDb } from "./audit-system-db.ts";
import { resolveAuditScopeFilter } from "./resolve-audit-tenant.ts";

export const detailsQuery = defineQueryHandler({
  name: "details",
  description:
    'Returns one audit-trail event of the caller\'s tenant by its event-store id, with full payload and metadata; use it to inspect the exact change behind a row of the audit log list. A SystemAdmin can set scope "system" to read an app-instance system event (e.g. app.started).',
  schema: z.object({
    id: auditEventIdSchema,
    scope: z.enum(AUDIT_SCOPE_VALUES).optional(),
  }),
  access: { roles: access.admin },
  handler: async (query, ctx) => {
    const scopeFilter = resolveAuditScopeFilter(query.user, query.payload.scope);
    const db = requireAuditSystemDb(ctx.systemDb, "audit:query:details").assertTenantMatch(
      query.user.tenantId,
    );
    const aggregateType = aggregateTypeCondition(
      scopeFilter.aggregateType,
      scopeFilter.hiddenAggregateTypes,
    );
    return loadAuditEvent(
      db,
      {
        tenantId: scopeFilter.tenantId,
        ...(aggregateType !== undefined && { aggregateType }),
        id: BigInt(query.payload.id),
      },
      createEntityNounKeyResolver(ctx.registry),
    );
  },
});
