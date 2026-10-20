// One audit event of any tenant by its event-store id, for the all-tenants log's detail screen.

import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { auditEventIdSchema, loadAuditEvent } from "./audit-events.ts";
import { requireAuditSystemDb } from "./audit-system-db.ts";
import { allTenantsCondition, assertMayReadAllTenants } from "./resolve-audit-tenant.ts";

export const detailsAllTenantsQuery = defineQueryHandler({
  name: "details-all-tenants",
  description:
    "Returns one audit-trail event of any tenant by its event-store id, with full payload, metadata and tenantId; SystemAdmin only, system-tenant events are not included.",
  schema: z.object({ id: auditEventIdSchema }),
  access: { roles: access.systemAdmin },
  handler: async (query, ctx) => {
    assertMayReadAllTenants(query.user);
    const db = requireAuditSystemDb(
      ctx.systemDb,
      "audit:query:details-all-tenants",
    ).acknowledgeCrossTenant("SystemAdmin reads one audit event of any tenant");
    return loadAuditEvent(db, {
      tenantId: allTenantsCondition(undefined),
      id: BigInt(query.payload.id),
    });
  },
});
