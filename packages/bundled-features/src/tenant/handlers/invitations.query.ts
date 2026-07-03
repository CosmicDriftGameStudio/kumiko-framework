import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
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
  access: { roles: ["Admin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const rows = await selectMany<Record<string, unknown>>(ctx.db, tenantInvitationsTable, {
      tenantId: query.user.tenantId,
      status: INVITATION_STATUS.pending,
    });
    return Promise.all(
      (rows ?? []).map(async (row) => {
        const email = row["email"];
        return typeof email === "string"
          ? { ...row, email: await decryptStoredPii(email, "tenant:invitations") }
          : row;
      }),
    );
  },
});
