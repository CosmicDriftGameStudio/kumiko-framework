import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  definePagedQueryHandler,
  MAX_LIST_LIMIT,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { decryptTenantNames, takeTenantsMatchingDecryptedName } from "../decrypt-tenant-names.ts";
import { tenantTable } from "../schema/tenant.ts";
import { isSystemAdmin } from "./is-system-admin.ts";

// Label source for every `tenant:tenant` reference column. The
// entity-convention lookup, tenant:query:tenant:list, is a SystemAdmin-only
// entity-list handler, so a TenantAdmin got a 403 and every tenant cell fell
// back to the raw UUID. A SystemAdmin keeps the global reach tenant:list gave
// them; a TenantAdmin only ever sees their own tenant.
// ponytail: capped at `limit` (200 list lookup, 50 combobox) like every
// reference lookup; beyond that the cell falls back to the raw id.
// A search filters in memory over a bounded scan so the combobox can reach
// tenants beyond the first `limit`; the cap keeps it from reading every tenant.
const SEARCH_SCAN_CAP = 1000;

export const tenantDirectoryQuery = definePagedQueryHandler({
  name: "tenantDirectory",
  schema: z.object({
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(MAX_LIST_LIMIT),
    // Sent by the reference combobox while the user types.
    search: z.string().trim().min(1).optional(),
    // Resolves exactly these tenants; callers that know their ids must not depend on the cap.
    ids: z.array(z.string().min(1)).max(MAX_LIST_LIMIT).optional(),
  }),
  access: { roles: access.admin },
  description:
    "Lists tenants as id/label pairs for resolving tenant references to display names: the caller's own tenant for an admin, every tenant for a SystemAdmin. A search returns the first `limit` matches in tenant-key order (sorted by label afterwards), not the alphabetically best matches.",
  agent: { expose: false },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:query:tenant-directory requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const { limit, search, ids } = query.payload;
    if (ids?.length === 0) return { rows: [], nextCursor: null };
    const scanLimit = search === undefined ? limit : SEARCH_SCAN_CAP;
    let tenants: readonly { id: unknown; name?: unknown }[];
    if (isSystemAdmin(query.user)) {
      const db = ctx.systemDb.acknowledgeCrossTenant(
        "SystemAdmin reference labels span every tenant, as tenant:query:tenant:list did",
      );
      tenants = await selectMany(db, tenantTable, ids === undefined ? undefined : { id: ids }, {
        limit: scanLimit,
        orderBy: [
          { col: "key", direction: "asc" },
          { col: "id", direction: "asc" },
        ],
      });
    } else {
      const db = ctx.systemDb.assertTenantMatch(query.user.tenantId);
      const row = await fetchOne(db, tenantTable, { id: query.user.tenantId });
      tenants = row && (ids === undefined || ids.includes(query.user.tenantId)) ? [row] : [];
    }
    // name is ciphertext at rest, so the SQL page is keyed by the plaintext
    // `key`; label order and search happen in memory after decrypting.
    const needle = search?.toLowerCase();
    const named =
      needle === undefined
        ? await decryptTenantNames(tenants, "tenant:tenant-directory")
        : await takeTenantsMatchingDecryptedName(
            tenants,
            (label) => label.toLowerCase().includes(needle),
            limit,
            "tenant:tenant-directory",
          );
    const rows = named
      .map((tenant) => {
        const id = String(tenant.id);
        return { id, label: typeof tenant.name === "string" ? tenant.name : id };
      })
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    return { rows, nextCursor: null };
  },
});
