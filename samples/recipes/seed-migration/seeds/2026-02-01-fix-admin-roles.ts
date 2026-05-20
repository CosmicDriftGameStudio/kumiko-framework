// Driver-Pattern: ergänze fehlende Rolle auf existierenden Memberships.
// Spiegelt den realen publicstatus-Bug 2026-05-20 (admin@publicstatus.eu
// hatte "Admin" aber nicht "TenantAdmin" → text-content + legal-pages
// access_denied weil bundled-features TenantAdmin erwarten).
//
// Funktioniert für jede App mit dem gleichen Pattern: User-Lookup per
// E-Mail → alle Memberships durchgehen → bei Bedarf via existierendem
// updateMemberRoles-Handler korrigieren.

import type { SeedMigration } from "@cosmicdrift/kumiko-framework/es-ops";

export default {
  description: "ergänze TenantAdmin-Rolle für admin@example.com auf allen Memberships",
  run: async (ctx) => {
    const admin = await ctx.findUserByEmail("admin@example.com");
    if (!admin) return; // idempotent: admin nicht (mehr) vorhanden

    for (const m of await ctx.findMembershipsOfUser(admin.id)) {
      if (m.roles.includes("TenantAdmin")) continue; // bereits korrigiert

      await ctx.systemWriteAs("tenant:write:updateMemberRoles", {
        userId: admin.id,
        tenantId: m.tenantId,
        roles: Array.from(new Set([...m.roles, "TenantAdmin"])),
      });
    }
  },
} satisfies SeedMigration;
