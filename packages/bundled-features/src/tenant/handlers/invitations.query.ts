import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { decryptStoredPii, mapWithConcurrency } from "../../shared";
import { INVITATION_STATUS, tenantInvitationsTable } from "../invitation-table";

// Bounded, not Promise.all/sequential: each decrypt hits the KMS adapter's
// own small dedicated pool (PgKmsAdapter default max: 4). Promise.all fires
// one call per row unbounded and exhausts the pool once invitation counts
// exceed a handful, surfacing as "the connection was closed"; a strict
// sequential loop caps concurrency at 1 and leaves 3 pool slots idle.
const KMS_POOL_CONCURRENCY = 4;

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
  handler: async (query, ctx) => {
    const rows = await selectMany<Record<string, unknown>>(ctx.db, tenantInvitationsTable, {
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
      return { ...row, email: decryptedEmail, invitedBy: decryptedInvitedBy };
    });
  },
});
