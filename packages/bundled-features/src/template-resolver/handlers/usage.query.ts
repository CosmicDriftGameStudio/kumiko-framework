import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { type TemplateResourceRow, templateResourcesTable } from "../table.ts";
import { deliveryPolicyOf } from "../template-delivery-policy.ts";
import type { TemplateEditPolicy } from "../template-edit-policy.ts";
import { templateSlugSchema } from "../template-meta.ts";
import { collectTemplateUsage } from "../template-usage.ts";
import { TEMPLATE_KINDS } from "../web/constants.ts";
import { effectiveMailLayoutSlugs, isRowVisibleToCaller } from "./overview.query.ts";

const MAIL_ROW_LIMIT = 5000;

export function makeUsageQuery(policy: TemplateEditPolicy) {
  return defineQueryHandler({
    name: "usage",
    schema: z.object({ slug: templateSlugSchema, kind: z.enum(TEMPLATE_KINDS) }),
    access: { roles: ["TenantAdmin", "SystemAdmin"] },
    description:
      "Lists the code-registered notifications that use one template: a mail template is used by the notification whose qualified name is its slug and that has a code template, a mail layout by every mail notification whose effective template (own override, else system) names it, or whose code meta does when no stored template exists, or that falls back to the default layout; use it to show what a change to a template affects.",
    handler: async (query, ctx) => {
      const { slug, kind } = query.payload;
      if (kind !== "mail-layout") return { usedBy: collectTemplateUsage(ctx.registry, slug, kind) };
      const fetchedRows = await selectMany<TemplateResourceRow>(
        ctx.db,
        templateResourcesTable,
        { kind: "mail" },
        { orderBy: { col: "id", direction: "asc" }, limit: MAIL_ROW_LIMIT + 1 },
      );
      if (fetchedRows.length > MAIL_ROW_LIMIT) {
        ctx.obs.log?.warn("template usage: row limit reached, result is incomplete", {
          limit: MAIL_ROW_LIMIT,
        });
      }
      const visibleRows = fetchedRows
        .slice(0, MAIL_ROW_LIMIT)
        .filter((row) => isRowVisibleToCaller(policy, query.user, ctx.registry, row));
      return {
        usedBy: collectTemplateUsage(
          ctx.registry,
          slug,
          kind,
          effectiveMailLayoutSlugs(visibleRows, deliveryPolicyOf(ctx.registry)),
        ),
      };
    },
  });
}
