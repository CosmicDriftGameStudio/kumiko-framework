import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { BRANDING_CSS_FEATURE } from "../constants.ts";
import { readBranding, readCustomCss } from "../keys.ts";

// Public branding read for the server-render path. Anonymous-capable: the
// render route reaches this via internal app.fetch with X-Tenant = host-
// resolved tenant, so `query.user.tenantId` (and thus `ctx.config`, which is
// minted from it) carries that tenant — identical to how by-slug resolves the
// page. Branding keys are read:all → an anonymous caller may read them (they
// are rendered on a public page). No payload: the tenant is implicit.
//
// custom CSS is gated twice: the app must opt in (allowCustomCss, baked into
// this factory) AND the per-tenant `branding-css` toggle must be on
// (ctx.hasFeature). Note ctx.hasFeature returns true when no feature-toggles/
// tier-engine runtime is wired, so without that runtime allowCustomCss alone
// governs. Even when emitted, the value is RAW — render re-sanitizes it.
export function createBrandingTokensQuery(opts: { readonly allowCustomCss: boolean }) {
  return defineQueryHandler({
    name: "tokens",
    schema: z.object({}),
    access: { roles: ["anonymous"], anySignedIn: true },
    rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
    description:
      "Reads the tenant's public branding values for rendered pages, mail and PDFs, adding the raw custom CSS only when the app opted in and the per-tenant CSS toggle is on; anonymous callers may read it because it dresses public pages.",
    handler: async (_query, ctx) => {
      const base = await readBranding(ctx.config);
      if (!opts.allowCustomCss || !ctx.config || !(await ctx.hasFeature(BRANDING_CSS_FEATURE))) {
        return base;
      }
      return { ...base, customCss: await readCustomCss(ctx.config) };
    },
  });
}
