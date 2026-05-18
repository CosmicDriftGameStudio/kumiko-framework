import { castTenantRows } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type TextBlockRow, textBlocksTable } from "../table";

// Public-Read aller Text-Blocks für einen Tenant. Use-Case: Visual-Tree-
// Provider lädt die Slug-Liste zur Sidebar-Render. Anonymous: explizit
// in roles damit no-JWT-Visitors auch lesen können (Marketing-Sidebar
// auf Public-Pages). Tenant-Scope kommt aus query.user.tenantId; optional
// `tenantIdOverride` (SystemAdmin-only) — symmetrisch zu by-slug.query.
//
// **Listing statt single-row**: anders als by-slug returnt das hier
// `{ blocks: [...] }` mit allen Slugs des Tenants. Pro Slug nur die
// Summary-Felder (kein full body — den lädt der Editor on-demand via
// by-slug). Hält die Sidebar-Payload klein bei vielen Slugs.
export type TextBlockSummary = {
  readonly slug: string;
  readonly lang: string;
  readonly title: string;
  readonly body: string | null;
  readonly updatedAt: Date;
};

export const byTenantQuery = defineQueryHandler({
  name: "by-tenant",
  schema: z.object({
    /** Optional cross-tenant read — nur für SystemAdmin. Symmetrisch
     *  zur by-slug.query und set.write Override-Logik. */
    tenantIdOverride: z.string().min(1).optional(),
  }),
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const override = query.payload.tenantIdOverride;
    if (override !== undefined && !query.user.roles.includes("SystemAdmin")) {
      throw new AccessDeniedError({
        i18nKey: "textContent.errors.tenantOverrideRequiresSystemAdmin",
        details: { reason: "tenant_override_requires_system_admin" },
      });
    }
    const tenantId = override ?? query.user.tenantId;
    const rows = castTenantRows<TextBlockRow>(
      await ctx.db
        .select()
        .from(textBlocksTable)
        .where(eq(textBlocksTable["tenantId"], tenantId)),
    );
    return {
      blocks: rows.map((row) => ({
        slug: row.slug,
        lang: row.lang,
        title: row.title,
        body: row.body,
        updatedAt: row.updatedAt,
      })),
    };
  },
});
