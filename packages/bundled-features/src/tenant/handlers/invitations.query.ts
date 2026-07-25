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

// Pending-Invitations-Liste für den aktuellen Tenant. Admin-only.
// Filter: status="pending" — accepted/cancelled/expired sind für die
// UI uninteressant (UI zeigt nur "ausstehende Einladungen"; Audit-Log
// für historische gehört in ein separates Audit-Feature).
//
// SQL-side filter (vorher JS-side .filter): bei Tenants mit vielen
// historischen invitations lädt die Query sonst alle Rows in den
// Node-process um die meisten wegzuwerfen — DB indexed das auf den
// (tenantId, …)-key, JS-filter ist redundant.
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
      // invitedBy is a plain userId (invitation-table.ts: no `pii: true`) —
      // never encrypted at write time, so it needs no decrypt (#1252).
      return { ...row, email: decryptedEmail };
    });
  },
});
