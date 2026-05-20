// Initial-Seed: Demo-Tenants anlegen.
//
// Note: in real apps wäre "initial tenants" wahrscheinlich nicht als
// seed-migration sondern als `r.config({seeds})` oder `auth.admin`-
// Config umgesetzt — die laufen jedes-Boot idempotent. Hier ist es als
// seed-migration gezeigt um das Pattern zu demonstrieren.
//
// Pattern: jede seed-migration arbeitet write-only via `systemWriteAs`
// damit alles als Event-Stream persistiert wird. Read-only Lookups
// (find*) am Context oder direkt via ctx.db.

import type { SeedMigration } from "@cosmicdrift/kumiko-framework/es-ops";

export default {
  description: "initial demo tenants (alice-corp, beta-inc)",
  run: async (ctx) => {
    // Idempotent-Check: wenn Tenants schon existieren (z.B. via auth.admin-
    // seed), skip diese Migration. Verhindert Konflikt beim re-boot wenn
    // jemand den Marker manuell gelöscht hat.
    const existing = await ctx.findTenants();
    if (existing.some((t) => t.tenantKey === "alice-corp")) return;

    await ctx.systemWriteAs("tenant:write:create", {
      name: "Alice Corp",
      tenantKey: "alice-corp",
    });
    await ctx.systemWriteAs("tenant:write:create", {
      name: "Beta Inc",
      tenantKey: "beta-inc",
    });
  },
} satisfies SeedMigration;
