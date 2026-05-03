import { defineQueryHandler } from "@kumiko/framework/engine";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
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
    const rows = await ctx.db
      ?.select()
      .from(tenantInvitationsTable)
      .where(
        and(
          eq(tenantInvitationsTable.tenantId, query.user.tenantId),
          eq(tenantInvitationsTable.status, INVITATION_STATUS.pending),
        ),
      );
    return rows ?? [];
  },
});
