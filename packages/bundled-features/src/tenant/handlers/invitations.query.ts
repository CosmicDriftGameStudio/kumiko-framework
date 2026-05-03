import { defineQueryHandler } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenantInvitationsTable } from "../invitation-table";

// Pending-Invitations-Liste für den aktuellen Tenant. Admin-only.
// Filter: status="pending" — accepted/cancelled/expired sind für die
// UI uninteressant (UI zeigt nur "ausstehende Einladungen"; Audit-Log
// für historische gehört in ein separates Audit-Feature).
export const invitationsQuery = defineQueryHandler({
  name: "invitations",
  schema: z.object({}),
  access: { roles: ["Admin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const rows = await ctx.db
      ?.select()
      .from(tenantInvitationsTable)
      .where(eq(tenantInvitationsTable.tenantId, query.user.tenantId));
    return (rows ?? []).filter((row) => row["status"] === "pending");
  },
});
