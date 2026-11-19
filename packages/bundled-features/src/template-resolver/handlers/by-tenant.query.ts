import { castTenantRows, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { filterDeliveredTo } from "../api.ts";
import { deliverableTextBlockContent } from "../stored-template-body.ts";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import { deliveryPolicyOf } from "../template-delivery-policy.ts";
import { TEXT_BLOCK_KIND } from "../web/constants.ts";

// All text-blocks of one tenant — feeds the public content tree sidebar.
// Anonymous is listed explicitly so no-JWT visitors get the sidebar on public
// pages; `kind` is pinned to text-block for the same reason as in by-slug and
// takes no parameter. Trees for any other kind go through `collection-list`,
// which is admin-only by its access rule.
//
// Unlike by-slug this returns summaries for every slug. The body travels along
// because the tree marks empty blocks as stubs; full render content for a
// single block still comes from by-slug.

// Bounds the anonymous content-tree read; a larger tree would need paging.
const MAX_LISTED_TEXT_BLOCKS = 1_000;

// meta stays because the delivery policy reads it (isTenantLayout); content stays because the tree marks stubs; id, version, scope and contentFormat feed the cached body check.
const TEXT_BLOCK_LIST_FIELDS = [
  "id",
  "version",
  "scope",
  "contentFormat",
  "tenantId",
  "kind",
  "slug",
  "meta",
  "locale",
  "title",
  "content",
  "folder",
  "modifiedAt",
] as const satisfies readonly (keyof TemplateResourceRow)[];

type TextBlockListRow = Pick<TemplateResourceRow, (typeof TEXT_BLOCK_LIST_FIELDS)[number]>;

export type TextBlockSummary = {
  readonly slug: string;
  readonly locale: string;
  readonly title: string | null;
  readonly content: string | null;
  readonly folder: string | null;
  readonly modifiedAt: Temporal.Instant | null;
};

export const byTenantQuery = defineQueryHandler({
  name: "by-tenant",
  schema: z.object({
    /** Narrows the read to the SYSTEM reference rows — SystemAdmin only. See by-slug. */
    tenantIdOverride: z.literal(SYSTEM_TENANT_ID).optional(),
  }),
  access: { roles: ["anonymous"], anySignedIn: true },
  rateLimit: { per: "ip+handler", limit: 60, windowSeconds: 60 },
  description:
    "Lists every text-block of a tenant with slug, locale, title and body, sorted by slug and locale, at most 1,000 blocks, so a public content tree can be rendered in one call; use it for the whole sidebar, and by-slug when only one block is needed.",
  handler: async (query, ctx) => {
    const override = query.payload.tenantIdOverride;
    const tenantId = override ?? query.user.tenantId;
    const rows = castTenantRows<TextBlockListRow>(
      await selectMany(
        ctx.db,
        templateResourcesTable,
        { tenantId, kind: TEXT_BLOCK_KIND },
        {
          fields: TEXT_BLOCK_LIST_FIELDS,
          orderBy: [{ col: "slug" }, { col: "locale" }],
          limit: MAX_LISTED_TEXT_BLOCKS,
        },
      ),
    );
    const policy = deliveryPolicyOf(ctx.registry);
    const served = await filterDeliveredTo(ctx.db, policy, query.user, rows);
    return {
      blocks: served.map(
        // guard:dup-ok block field selection; only the object-literal shape matches other mappers
        (row) => ({
          slug: row.slug,
          locale: row.locale,
          title: row.title,
          content: deliverableTextBlockContent(row),
          folder: row.folder,
          modifiedAt: row.modifiedAt,
        }),
      ),
    };
  },
});
