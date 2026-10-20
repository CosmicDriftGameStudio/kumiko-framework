// SystemAdmin view of the audit trail across every tenant (the system tenant excluded, see
// allTenantsCondition). Rows carry their tenantId so the screen can label the tenant.

import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import {
  AUDIT_DATE_RANGE_CHECK,
  auditListPayloadShape,
  buildAuditWhere,
  listAuditEvents,
} from "./audit-events.ts";
import { requireAuditSystemDb } from "./audit-system-db.ts";
import { allTenantsCondition, assertMayReadAllTenants } from "./resolve-audit-tenant.ts";

const MAX_TENANT_FILTER_IDS = 100;

// The reference facet on the tenant column sends exactly this shape.
const tenantIdFiltersSchema = z
  .array(
    z.strictObject({
      field: z.literal("tenantId"),
      op: z.literal("in"),
      value: z.array(z.uuid()).max(MAX_TENANT_FILTER_IDS),
    }),
  )
  .max(1);

export const listAllTenantsQuery = defineQueryHandler({
  name: "list-all-tenants",
  description:
    "Lists audit-trail events of every tenant newest-first with cursor paging, each row carrying its tenantId; filterable by tenant, aggregate type, aggregate id, event type, actor and time range. SystemAdmin only; events of the system tenant are not included.",
  schema: z
    .object({ ...auditListPayloadShape, filters: tenantIdFiltersSchema.optional() })
    .refine(AUDIT_DATE_RANGE_CHECK.isValid, AUDIT_DATE_RANGE_CHECK.params),
  access: { roles: access.systemAdmin },
  handler: async (query, ctx) => {
    assertMayReadAllTenants(query.user);
    const p = query.payload;
    const direction = p.sortDirection ?? "desc";
    const where = buildAuditWhere(allTenantsCondition(p.filters?.[0]?.value), p, direction);
    const db = requireAuditSystemDb(
      ctx.systemDb,
      "audit:query:list-all-tenants",
    ).acknowledgeCrossTenant("SystemAdmin reads the audit trail of every tenant");
    return listAuditEvents(db, where, p, direction);
  },
});
