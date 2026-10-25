// Driver pattern: add a missing role to existing memberships.
// Mirrors the real publicstatus bug of 2026-05-20 (admin@publicstatus.eu
// had "Admin" but not "TenantAdmin" → text-content + legal-pages
// access_denied because bundled-features expect TenantAdmin).
//
// Works for any app with the same pattern: user lookup by
// email → go through all memberships → correct via the existing
// updateMemberRoles handler if needed.

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
        // tenantIdOverride: stream tenant from kumiko_events.v1 — NOT
        // m.tenantId (payload tenant). The two often match, but differ
        // when the aggregate was originally created by a foreign
        // executor (seedTenantMembership by=systemAdmin —
        // publicstatus pattern). findMembershipsOfUser returns both,
        // no separate JOIN needed.
        m.streamTenantId,
      );
    }
  },
} satisfies SeedMigration;
