import { fetchOne } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { type PageRow, pagesTable } from "../table.ts";

// Public read by (tenantId, slug, lang), including anonymous access for landing and
// marketing pages. The tenant comes from query.user.tenantId, set on the render path
// via X-Tenant = Host-resolved-tenant. Returns ONLY published pages with a body:
// drafts and empty pages are invisible to anonymous visitors (the route returns 404).
// Admin editing uses the entity list/edit screens instead of this query.
export const bySlugQuery = defineQueryHandler({
  name: "by-slug",
  schema: z.object({
    slug: z.string().min(1).max(64),
    lang: z.string().min(2).max(8),
  }),
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
  rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
  description:
    "Reads the body and metadata of one published managed page of the caller's tenant by slug and language, returning null for drafts and bodyless pages; use it to render a public page, not to load one for editing.",
  handler: async (query, ctx) => {
    const row = await fetchOne<PageRow>(ctx.db, pagesTable, {
      tenantId: query.user.tenantId,
      slug: query.payload.slug,
      lang: query.payload.lang,
    });
    if (!row?.published || !row.body) return null;
    return {
      slug: row.slug,
      lang: row.lang,
      title: row.title,
      body: row.body,
      description: row.description,
      ogImage: row.ogImage,
      version: row.version,
      updatedAt: row.updatedAt,
    };
  },
});
