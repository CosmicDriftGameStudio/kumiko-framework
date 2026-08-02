import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { castTenantRows } from "@cosmicdrift/kumiko-framework/db";
import {
  crossTenantOverrideDenied,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { TEXT_BLOCK_KIND } from "../constants";
import { type TemplateResourceRow, templateResourcesTable } from "../table";

// All text-blocks of one tenant — feeds the public content tree sidebar.
// Anonymous is listed explicitly so no-JWT visitors get the sidebar on public
// pages; `kind` is pinned to text-block for the same reason as in by-slug and
// takes no parameter. Trees for any other kind go through `collection-list`,
// which is admin-only by its access rule.
//
// Unlike by-slug this returns summaries for every slug. The body travels along
// because the tree marks empty blocks as stubs; full render content for a
// single block still comes from by-slug.
export type TextBlockSummary = {
  readonly slug: string;
  readonly locale: string;
  readonly title: string | null;
  readonly content: string | null;
  readonly folder: string | null;
  readonly updatedAt: Date;
};

export const byTenantQuery = defineQueryHandler({
  name: "by-tenant",
  schema: z.object({
    /** Optional cross-tenant read — SystemAdmin only. Symmetric to by-slug. */
    tenantIdOverride: z.string().min(1).optional(),
  }),
  access: { roles: ["anonymous", "User", "TenantAdmin", "SystemAdmin"] },
  handler: async (query, ctx) => {
    const override = query.payload.tenantIdOverride;
    const overrideDenied = crossTenantOverrideDenied(
      query.user,
      override,
      "templateResolver.errors.tenantOverrideRequiresSystemAdmin",
    );
    if (overrideDenied) throw overrideDenied;
    const tenantId = override ?? query.user.tenantId;
    const rows = castTenantRows<TemplateResourceRow>(
      await selectMany(ctx.db, templateResourcesTable, { tenantId, kind: TEXT_BLOCK_KIND }),
    );
    return {
      blocks: rows.map((row) => ({
        slug: row.slug,
        locale: row.locale,
        title: row.title,
        content: row.content,
        folder: row.folder,
        updatedAt: row.updatedAt,
      })),
    };
  },
});
