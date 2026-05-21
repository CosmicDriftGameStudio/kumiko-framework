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

      await ctx.systemWriteAs(
        "tenant:write:update-member-roles", // kebab-case QN — wird vom Dry-Run-Validator gecheckt
        {
          userId: admin.id,
          tenantId: m.tenantId,
          roles: Array.from(new Set([...m.roles, "TenantAdmin"])),
        },
        // tenantIdOverride: stream-tenant aus kumiko_events.v1 — NICHT
        // m.tenantId (payload-tenant). Beide stimmen oft überein, weichen
        // aber ab wenn das Aggregate ursprünglich von einem fremden
        // Executor angelegt wurde (seedTenantMembership by=systemAdmin —
        // publicstatus-Pattern). findMembershipsOfUser liefert beide,
        // kein eigener JOIN nötig.
        m.streamTenantId,
      );
    }
  },
} satisfies SeedMigration;
