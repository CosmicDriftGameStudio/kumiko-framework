import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { mapWithConcurrency } from "@cosmicdrift/kumiko-framework/utils";
import {
  decryptStoredPii,
  KMS_POOL_CONCURRENCY,
  requireSystemDb,
} from "../../shared/index.ts";
import { INVITATION_STATUS, tenantInvitationsTable } from "../invitation-table.ts";
import { isSystemAdmin } from "./is-system-admin.ts";

// Pending invitations for the current tenant, admin-only, filtered to
// status="pending" — accepted/cancelled/expired don't belong in this UI
// (historical entries belong in a separate audit feature).
//
// SQL-side filter (was JS-side .filter): a tenant with many historical
// invitations would otherwise load every row into the node process just to
// discard most of them — the DB indexes on (tenantId, …), a JS filter is redundant.
export const invitationsQuery = defineQueryHandler({
  name: "invitations",
  schema: z.object({}),
  access: { roles: access.admin },
  description:
    "Lists the still-pending invitations of the caller's own tenant with their email and inviter decrypted; accepted, cancelled and expired ones are left out.",
  // Decrypted invitee and inviter email.
  agent: { risk: "high" },
  handler: async (query, ctx) => {
    const systemDb = requireSystemDb(ctx, "tenant:query:invitations");
    const db = systemDb.assertTenantMatch(query.user.tenantId);
    const rows = await selectMany<Record<string, unknown>>(db, tenantInvitationsTable, {
      tenantId: query.user.tenantId,
      status: INVITATION_STATUS.pending,
    });
    return mapWithConcurrency(rows ?? [], KMS_POOL_CONCURRENCY, async (row) => {
      const email = row["email"];
      const decryptedEmail =
        typeof email === "string"
          ? await decryptStoredPii(email, "email", "tenant:invitations")
          : email;
      const invitedBy = row["invitedBy"];
      // `userOwned` alone marks a field as a PII subject field, so invitedBy
      // is encrypted at write time even without `pii: true`.
      const decryptedInvitedBy =
        typeof invitedBy === "string"
          ? await decryptStoredPii(invitedBy, "invitedBy", "tenant:invitations")
          : invitedBy;
      // Explicit allowlist: the raw row also carries blind-index columns and
      // globalRoles, which only a SystemAdmin may see.
      return {
        id: row["id"],
        tenantId: row["tenantId"],
        email: decryptedEmail,
        role: row["role"],
        status: row["status"],
        invitedBy: decryptedInvitedBy,
        expiresAt: row["expiresAt"],
        insertedAt: row["insertedAt"],
        version: row["version"],
        ...(isSystemAdmin(query.user) && { globalRoles: row["globalRoles"] }),
      };
    });
  },
});
