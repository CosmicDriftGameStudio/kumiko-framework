import { fetchOne } from "@kumiko/framework/db";
import { defineQueryHandler } from "@kumiko/framework/engine";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type TextBlockRow, textBlocksTable } from "../table";

// Public-Read by (tenantId, slug, lang). Anonymous: muss `anonymous`
// in roles enthalten — openToAll alleine ist auth-only (Regression-
// Guard). Tenant-Scope kommt aus query.user.tenantId (anonymous-context
// setzt SYSTEM_TENANT_ID oder Host-resolved-tenant je nach App-Setup).
export const bySlugQuery = defineQueryHandler({
  name: "by-slug",
  schema: z.object({
    slug: z.string().min(1).max(64),
    lang: z.string().min(2).max(8),
  }),
  // Public-Read: muss explizit `anonymous` enthalten damit no-JWT-
  // Visitors auf Marketing-/Legal-Pages den Text sehen. openToAll
  // alleine ist auth-only (Regression-Guard) — siehe
  // docs/plans/datenschutz/legal-artifacts.md.
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const tenantId = query.user.tenantId;
    const row = await fetchOne<TextBlockRow>(
      ctx.db,
      textBlocksTable,
      eq(textBlocksTable["tenantId"], tenantId),
      eq(textBlocksTable["slug"], query.payload.slug),
      eq(textBlocksTable["lang"], query.payload.lang),
    );

    if (!row) return null;
    return {
      slug: row.slug,
      lang: row.lang,
      title: row.title,
      body: row.body,
      updatedAt: row.updatedAt,
    };
  },
});
