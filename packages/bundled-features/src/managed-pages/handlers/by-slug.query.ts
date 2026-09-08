import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { type PageRow, pagesTable } from "../table";

// Public-Read by (tenantId, slug, lang). Anonymous-capable (Landing-/
// Marketing-Pages). Tenant kommt aus query.user.tenantId — am Render-Pfad
// via X-Tenant = Host-resolved-tenant gesetzt. Liefert NUR published Pages
// mit Body: Drafts + leere Pages sind für anonyme Besucher unsichtbar
// (Route → 404). Admin-Editing nutzt die Entity-List/Edit-Screens, nicht
// diese Query.
export const bySlugQuery = defineQueryHandler({
  name: "by-slug",
  schema: z.object({
    slug: z.string().min(1).max(64),
    lang: z.string().min(2).max(8),
  }),
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
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
