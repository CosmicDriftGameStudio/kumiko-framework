// Initial seed: create demo tenants.
//
// Note: in real apps "initial tenants" would probably not be implemented as a
// seed migration but as `r.config({seeds})` or `auth.admin`
// config — those run idempotently on every boot. Here it is shown as a
// seed migration to demonstrate the pattern.
//
// Pattern: every seed migration works write-only via `systemWriteAs`
// so everything is persisted as an event stream. Read-only lookups
// (find*) on the context or directly via ctx.db.

import type { SeedMigration } from "@cosmicdrift/kumiko-framework/es-ops";

export default {
  description: "initial demo tenants (alice-corp, beta-inc)",
  run: async (ctx) => {
    // Idempotency check: if tenants already exist (e.g. via an auth.admin
    // seed), skip this migration. Prevents a conflict on re-boot if
    // someone deleted the marker manually.
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
