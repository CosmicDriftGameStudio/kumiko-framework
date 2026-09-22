import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  definePagedQueryHandler,
  MAX_LIST_LIMIT,
} from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { decryptStoredPii, mapWithConcurrency } from "../../shared";
import { userTable } from "../../user";
import { tenantMembershipsTable } from "../membership-table";

// Shares the KMS adapter's small dedicated pool, same rationale as
// members.query.ts.
const KMS_POOL_CONCURRENCY = 4;

function isSystemAdmin(roles: readonly string[]): boolean {
  return access.systemAdmin.some((role) => roles.includes(role));
}

async function loadMemberUserIds(db: TenantDb, tenantId: string): Promise<readonly string[]> {
  const memberships = await selectMany(db, tenantMembershipsTable, { tenantId });
  return [...new Set(memberships.map((row) => String(row["userId"])))];
}

// Label source behind every `user:user` reference column (fw#3107). The
// entity-convention lookup, user:query:user:list, is a SystemAdmin
// cross-tenant roster, so a TenantAdmin got a 403 and every actor cell fell
// back to the raw UUID. Deliberately narrower than tenant:query:members:
// id + display name only, no email, so the screens that only need a name
// never decrypt an address.
//
// A SystemAdmin keeps the global scope the roster gave them: operators act in
// tenants they are no member of, and their own audit entries and sessions must
// still resolve. A TenantAdmin only ever sees their own tenant's members.
// ponytail: capped at `limit` (200 list lookup, 50 combobox) like every
// reference lookup; beyond that the cell falls back to the raw id.
export const memberDirectoryQuery = definePagedQueryHandler({
  name: "memberDirectory",
  schema: z.object({
    limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(MAX_LIST_LIMIT),
  }),
  access: { roles: access.admin },
  description:
    "Lists users as id/label pairs for resolving user references to display names: the caller's own tenant members for an admin, every user for a SystemAdmin; carries no email or role data.",
  agent: { expose: false },
  handler: async (query, ctx) => {
    if (!ctx.systemDb) {
      throw new InternalError({
        message:
          "tenant:query:member-directory requires ctx.systemDb — is r.systemScope() still set on the tenant feature?",
      });
    }
    const { limit } = query.payload;
    let users: readonly { id: unknown; displayName?: unknown }[];
    if (isSystemAdmin(query.user.roles)) {
      const db = ctx.systemDb.acknowledgeCrossTenant(
        "SystemAdmin reference labels span every tenant, as user:query:user:list did",
      );
      users = await selectMany(db, userTable, undefined, { limit });
    } else {
      const db = ctx.systemDb.assertTenantMatch(query.user.tenantId);
      const userIds = (await loadMemberUserIds(db, query.user.tenantId)).slice(0, limit);
      users = userIds.length > 0 ? await selectMany(db, userTable, { id: [...userIds] }) : [];
    }
    const rows = await mapWithConcurrency(users, KMS_POOL_CONCURRENCY, async (user) => {
      const id = String(user.id);
      const label =
        typeof user.displayName === "string"
          ? await decryptStoredPii(user.displayName, "displayName", "tenant:member-directory")
          : null;
      return { id, label: label ?? id };
    });
    return { rows, nextCursor: null };
  },
});
