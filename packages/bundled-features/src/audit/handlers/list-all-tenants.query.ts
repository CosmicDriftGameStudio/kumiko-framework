// SystemAdmin view of the audit trail across every tenant (the system tenant excluded, see
// allTenantsCondition). Rows carry their tenantId so the screen can label the tenant.

import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import {
  AUDIT_DATE_RANGE_CHECK,
  auditListPayloadShape,
  buildAuditWhere,
  createEntityNounKeyResolver,
  includesTechnicalEntries,
  listAuditEvents,
  technicalEntriesFilterSchema,
} from "./audit-events.ts";
import { requireAuditSystemDb } from "./audit-system-db.ts";
import { allTenantsCondition, assertMayReadAllTenants } from "./resolve-audit-tenant.ts";

const MAX_TENANT_FILTER_IDS = 100;

// The reference facet on the tenant column sends exactly this shape.
const tenantIdFilterSchema = z.strictObject({
  field: z.literal("tenantId"),
  op: z.literal("in"),
  value: z.array(z.uuid()).max(MAX_TENANT_FILTER_IDS),
});

const auditFiltersSchema = z
  .array(z.union([tenantIdFilterSchema, technicalEntriesFilterSchema]))
  .max(2);

export const listAllTenantsQuery = defineQueryHandler({
  name: "list-all-tenants",
  description:
    "Lists audit-trail events of every tenant newest-first with cursor paging, each row carrying its tenantId; filterable by tenant, aggregate type, aggregate id, event type, actor and time range. SystemAdmin only; events of the system tenant are not included.",
  schema: z
    .object({ ...auditListPayloadShape, filters: auditFiltersSchema.optional() })
    .refine(AUDIT_DATE_RANGE_CHECK.isValid, AUDIT_DATE_RANGE_CHECK.params),
  access: { roles: access.systemAdmin },
  handler: async (query, ctx) => {
    assertMayReadAllTenants(query.user);
    const p = query.payload;
    const direction = p.sortDirection ?? "desc";
    const requestedTenantIds = p.filters?.find((f) => f.field === "tenantId")?.value;
    const where = buildAuditWhere(
      allTenantsCondition(requestedTenantIds),
      { ...p, includeTechnical: includesTechnicalEntries(p.filters) },
      direction,
    );
    const db = requireAuditSystemDb(
      ctx.systemDb,
      "audit:query:list-all-tenants",
    ).acknowledgeCrossTenant("SystemAdmin reads the audit trail of every tenant");
    return listAuditEvents(db, where, p, direction, createEntityNounKeyResolver(ctx.registry));
  },
});
