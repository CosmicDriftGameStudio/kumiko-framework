import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { decryptStoredPii } from "../../shared";
import { INVITATION_STATUS, tenantInvitationsTable } from "../invitation-table";

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
    // Sequential, not Promise.all: each decrypt hits the KMS adapter's own
    // small dedicated pool (PgKmsAdapter default max: 4) — firing 2 calls
    // per row concurrently for every row exhausts it once invitation counts
    // exceed a handful, surfacing as "the connection was closed".
    const out: Record<string, unknown>[] = [];
    for (const row of rows ?? []) {
      const email = row["email"];
      const invitedBy = row["invitedBy"];
      const decryptedEmail =
        typeof email === "string" ? await decryptStoredPii(email, "tenant:invitations") : email;
      const decryptedInvitedBy =
        typeof invitedBy === "string"
          ? await decryptStoredPii(invitedBy, "tenant:invitations")
          : invitedBy;
      out.push({ ...row, email: decryptedEmail, invitedBy: decryptedInvitedBy });
    }
    return out;
  },
});
