import { castTenantRows, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { type PageRow, pagesTable } from "../table.ts";

// Public read of all published pages for a tenant, used to discover URLs for
// sitemap.xml/llms.txt (see the seo feature). Unlike by-slug, which fetches one
// slug's content, this lists all published slugs in one query, filtered in SQL
// with `published = true`; drafts never appear, and only slug/title/updatedAt are
// returned because discovery does not require body content.
// Anonymous access is explicit in roles, matching text-content's by-tenant.
export type PublishedPageSummary = {
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly updatedAt: Date;
};

export const byTenantPublishedQuery = defineQueryHandler({
  name: "by-tenant-published",
  schema: z.object({
    /** Optional cross-tenant read — only for SystemAdmin. Matches the override
     *  logic in by-slug.query. */
    tenantIdOverride: z.string().min(1).optional(),
  }),
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"], anySignedIn: true },
  rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
  description:
    "Lists every published page of a tenant with slug, language, title and last-change time but no body; use it to enumerate the public pages for sitemap.xml or llms.txt, rather than by-slug which fetches one page's content.",
  handler: async (query, ctx) => {
    const override = query.payload.tenantIdOverride;
    const tenantId = override ?? query.user.tenantId;
    const rows = castTenantRows<PageRow>(
      await selectMany(ctx.db, pagesTable, { tenantId: tenantId, published: true }),
    );
    return {
      pages: rows.map((row) => ({
        slug: row.slug,
        lang: row.lang,
        title: row.title,
        updatedAt: row.updatedAt,
      })),
    };
  },
});
