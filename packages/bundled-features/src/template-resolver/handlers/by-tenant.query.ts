import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { castTenantRows } from "@cosmicdrift/kumiko-framework/db";
import {
  crossTenantOverrideDenied,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";
import { z } from "zod";
import { TEMPLATE_KINDS, TEXT_BLOCK_KIND } from "../constants";
import { type TemplateResourceRow, templateResourcesTable } from "../table";
import { isTemplateAdmin } from "./shared";

// All resources of one kind for one tenant — feeds the content tree sidebar.
// Anonymous is listed explicitly so no-JWT visitors get the sidebar on public
// pages, which is why `kind` defaults to text-block and any other kind
// requires an admin role: mail templates and AI prompts are operator content
// and must not be readable through the anonymous path.
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
    /** Which kind to list. Defaults to text-block, the only kind the
     *  anonymous path may read. */
    kind: z.enum(TEMPLATE_KINDS).optional(),
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
    const kind = query.payload.kind ?? TEXT_BLOCK_KIND;
    if (kind !== TEXT_BLOCK_KIND && !isTemplateAdmin(query.user)) {
      throw new AccessDeniedError({
        i18nKey: "templateResolver.errors.kindRequiresAdmin",
        details: { reason: "non_text_block_kind_requires_admin", kind },
      });
    }
    const tenantId = override ?? query.user.tenantId;
    const rows = castTenantRows<TemplateResourceRow>(
      await selectMany(ctx.db, templateResourcesTable, { tenantId, kind }),
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
