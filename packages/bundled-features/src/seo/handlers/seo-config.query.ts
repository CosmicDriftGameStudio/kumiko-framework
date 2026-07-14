import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { SEO_CONFIG_QN } from "../constants";

// Public read of the seo feature's own tenant-config values, for the
// anonymous sitemap.xml/llms.txt routes (a Response is per-request; those
// routes only get `{ app }`, not `ctx.config` directly, so they reach this
// the same way managed-pages' render route reaches its branding query — an
// internal app.fetch with X-Tenant set to the resolved tenant).
//
// config:query:values (the generic config feature query) is NOT usable here:
// it requires an authenticated caller (any role) even though its per-key
// access defaults to read:all — a genuinely anonymous visitor gets 403 before
// per-key filtering ever runs. This mirrors managed-pages' branding query
// instead (`access: { roles: ["anonymous", ...] }`), the pattern actually
// proven to work for anonymous-served pages.
export const seoConfigQuery = defineQueryHandler({
  name: "config",
  schema: z.object({}),
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
  handler: async (_query, ctx) => {
    const read = async (qualifiedKey: string): Promise<string> => {
      if (!ctx.config) return "";
      const value = await ctx.config(qualifiedKey);
      return typeof value === "string" ? value : "";
    };
    return {
      organizationName: await read(SEO_CONFIG_QN.organizationName),
      organizationLogoUrl: await read(SEO_CONFIG_QN.organizationLogoUrl),
      twitterSite: await read(SEO_CONFIG_QN.twitterSite),
      llmsSummary: await read(SEO_CONFIG_QN.llmsSummary),
      defaultOgImage: await read(SEO_CONFIG_QN.defaultOgImage),
    };
  },
});
