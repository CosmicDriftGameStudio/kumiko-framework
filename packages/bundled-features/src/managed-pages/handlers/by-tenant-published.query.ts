import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { castTenantRows } from "@cosmicdrift/kumiko-framework/db";
import {
  crossTenantOverrideDenied,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { type PageRow, pagesTable } from "../table";

// Public-Read aller published Pages eines Tenants — Discovery-Quelle für
// sitemap.xml/llms.txt (siehe seo-Feature). Anders als by-slug (single-row,
// nur der angefragte Slug) listet dies alle published Slugs auf einmal, SQL-
// seitig auf `published = true` gefiltert (Drafts nie im Ergebnis, kein
// Body-Content — Discovery-Zweck braucht nur Slug/Title/updatedAt).
// Anonymous: explizit in roles, symmetrisch zu text-content's by-tenant.
export type PublishedPageSummary = {
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly updatedAt: Date;
};

export const byTenantPublishedQuery = defineQueryHandler({
  name: "by-tenant-published",
  schema: z.object({
    /** Optional cross-tenant read — nur für SystemAdmin. Symmetrisch zur
     *  by-slug.query Override-Logik. */
    tenantIdOverride: z.string().min(1).optional(),
  }),
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const override = query.payload.tenantIdOverride;
    const overrideDenied = crossTenantOverrideDenied(
      query.user,
      override,
      "managedPages.errors.tenantOverrideRequiresSystemAdmin",
    );
    if (overrideDenied) throw overrideDenied;
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
