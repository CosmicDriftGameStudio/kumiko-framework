import { castTenantRows, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { type PageRow, pagesTable } from "../table.ts";

// Public read of all published pages for a tenant, used to discover URLs for
// sitemap.xml/llms.txt (see the seo feature). Unlike by-slug, which fetches one
// slug's content, this lists all published slugs (sorted by slug and lang, capped) in one query, filtered in SQL
// with `published = true`; drafts never appear, and only slug/lang/title and the last-change instant are
// returned because discovery does not require body content.
// Anonymous access is explicit in roles, matching text-content's by-tenant.
// Bounds the anonymous discovery read; a larger site would need a sitemap index.
const MAX_LISTED_PUBLISHED_PAGES = 5_000;

type PublishedPageRow = Pick<PageRow, "slug" | "lang" | "title" | "insertedAt" | "modifiedAt">;

export type PublishedPageSummary = {
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly updatedAt: string;
};

export const byTenantPublishedQuery = defineQueryHandler({
  name: "by-tenant-published",
  schema: z.object({}),
  access: { roles: ["anonymous"], anySignedIn: true },
  rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
  description:
    "Lists every published page of a tenant with slug, language, title and last-change time but no body; use it to enumerate the public pages for sitemap.xml or llms.txt, rather than by-slug which fetches one page's content.",
  handler: async (query, ctx) => {
    const tenantId = query.user.tenantId;
    const rows = castTenantRows<PublishedPageRow>(
      await selectMany(
        ctx.db,
        pagesTable,
        { tenantId: tenantId, published: true },
        {
          fields: ["slug", "lang", "title", "insertedAt", "modifiedAt"],
          orderBy: [{ col: "slug" }, { col: "lang" }],
          limit: MAX_LISTED_PUBLISHED_PAGES,
        },
      ),
    );
    return {
      pages: rows.map((row) => ({
        slug: row.slug,
        lang: row.lang,
        title: row.title,
        updatedAt: (row.modifiedAt ?? row.insertedAt).toString(),
      })),
    };
  },
});
