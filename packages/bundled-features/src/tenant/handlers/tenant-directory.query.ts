import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  access,
  definePagedQueryHandler,
  MAX_LIST_LIMIT,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { tenantTable } from "../schema/tenant";
import { isSystemAdmin } from "./is-system-admin";

// Label source behind every `tenant:tenant` reference column (fw#3142). The
// entity-convention lookup, tenant:query:tenant:list, is a SystemAdmin-only
// entity-list handler, so a TenantAdmin got a 403 and every tenant cell fell
// back to the raw UUID. A SystemAdmin keeps the global reach tenant:list gave
// them; a TenantAdmin only ever sees their own tenant.
// ponytail: capped at `limit` (200 list lookup, 50 combobox) like every
// reference lookup; beyond that the cell falls back to the raw id.
export const tenantDirectoryQuery = definePagedQueryHandler({
  name: "tenantDirectory",
  schema: z.object({
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(MAX_LIST_LIMIT),
  }),
  access: { roles: access.admin },
  description:
    "Lists tenants as id/label pairs for resolving tenant references to display names: the caller's own tenant for an admin, every tenant for a SystemAdmin.",
  agent: { expose: false },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:query:tenant-directory requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const { limit } = query.payload;
    let tenants: readonly { id: unknown; name?: unknown }[];
    if (isSystemAdmin(query.user)) {
      const db = ctx.systemDb.acknowledgeCrossTenant(
        "SystemAdmin reference labels span every tenant, as tenant:query:tenant:list did",
      );
      tenants = await selectMany(db, tenantTable, undefined, { limit });
    } else {
      const db = ctx.systemDb.assertTenantMatch(query.user.tenantId);
      const row = await fetchOne(db, tenantTable, { id: query.user.tenantId });
      tenants = row ? [row] : [];
    }
    const rows = tenants.map((tenant) => {
      const id = String(tenant.id);
      return { id, label: typeof tenant.name === "string" ? tenant.name : id };
    });
    return { rows, nextCursor: null };
  },
});
