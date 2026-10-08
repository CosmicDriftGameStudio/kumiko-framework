import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  access,
  definePagedQueryHandler,
  MAX_LIST_LIMIT,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { decryptTenantNames } from "../decrypt-tenant-names.js";
import { tenantTable } from "../schema/tenant.js";
import { isSystemAdmin } from "./is-system-admin.js";

// Label source behind every `tenant:tenant` reference column (fw#3142). The
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
    const { limit, search } = query.payload;
    const scanLimit = search === undefined ? limit : SEARCH_SCAN_CAP;
    let tenants: readonly { id: unknown; name?: unknown }[];
    if (isSystemAdmin(query.user)) {
      const db = ctx.systemDb.acknowledgeCrossTenant(
        "SystemAdmin reference labels span every tenant, as tenant:query:tenant:list did",
      );
      tenants = await selectMany(db, tenantTable, undefined, {
        limit: scanLimit,
        orderBy: [
          { col: "key", direction: "asc" },
          { col: "id", direction: "asc" },
        ],
      });
    } else {
      const db = ctx.systemDb.assertTenantMatch(query.user.tenantId);
      const row = await fetchOne(db, tenantTable, { id: query.user.tenantId });
      tenants = row ? [row] : [];
    }
    // name is ciphertext at rest, so the SQL page is keyed by the plaintext
    // `key`; label order and search happen in memory after decrypting.
    const decrypted = await decryptTenantNames(tenants, "tenant:tenant-directory");
    const labeled = decrypted
      .map((tenant) => {
        const id = String(tenant.id);
        return { id, label: typeof tenant.name === "string" ? tenant.name : id };
      })
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    const needle = search?.toLowerCase();
    const rows =
      needle === undefined
        ? labeled
        : labeled.filter((row) => row.label.toLowerCase().includes(needle)).slice(0, limit);
    return { rows, nextCursor: null };
  },
});
