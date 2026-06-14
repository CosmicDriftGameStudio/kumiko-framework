import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { readBranding } from "../branding";

// Public branding read for the server-render path. Anonymous-capable: the
// render route reaches this via internal app.fetch with X-Tenant = host-
// resolved tenant, so `query.user.tenantId` (and thus `ctx.config`, which is
// minted from it) carries that tenant — identical to how by-slug resolves the
// page. Branding keys are read:all → an anonymous caller may read them (they
// are rendered on a public page). No payload: the tenant is implicit.
export const brandingQuery = defineQueryHandler({
  name: "branding",
  schema: z.object({}),
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
  handler: async (_query, ctx) => {
    return readBranding(ctx.config);
  },
});
