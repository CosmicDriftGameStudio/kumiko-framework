import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { castTenantRows } from "@cosmicdrift/kumiko-framework/db";
import {
  crossTenantOverrideDenied,
  defineQueryHandler,
} from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";
import { TEMPLATE_KINDS } from "../constants";
import { type TemplateResourceRow, templateResourcesTable } from "../table";

// The content tree of one r.contentCollection() — same summary shape as
// by-tenant, but for an arbitrary `kind` and behind an admin access rule.
//
// Deliberately a separate handler rather than a `kind` parameter on by-tenant:
// that one is anonymous-reachable so public legal pages can render their
// sidebar, and a kind parameter there would have made mail templates and AI
// prompts one payload field away from the anonymous path. Splitting moves the
// rule from a branch in the handler body into `access`, where a new kind
// cannot accidentally become public.
//
// `list` doesn't serve this: its kind enum is RENDER_KINDS (no text-block, no
// ai-prompt), it returns no title/folder/content, and it admits `User`.
export const collectionListQuery = defineQueryHandler({
  name: "collection-list",
  schema: z.object({
    kind: z.enum(TEMPLATE_KINDS),
    /** Optional cross-tenant read — SystemAdmin only. Symmetric to by-tenant. */
    tenantIdOverride: z.string().min(1).optional(),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
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
      await selectMany(ctx.db, templateResourcesTable, { tenantId, kind: query.payload.kind }),
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
