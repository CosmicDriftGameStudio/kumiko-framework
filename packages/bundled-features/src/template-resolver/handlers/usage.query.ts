import { defineQueryHandler } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { TEMPLATE_KINDS } from "../constants.js";
import { templateSlugSchema } from "../template-meta.js";
import { collectTemplateUsage } from "../template-usage.js";

export const usageQuery = defineQueryHandler({
  name: "usage",
  schema: z.object({ slug: templateSlugSchema, kind: z.enum(TEMPLATE_KINDS) }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Lists the code-registered notifications that use one template: a mail template is used by the notification whose qualified name is its slug, a mail layout by every mail notification that names it in its meta or falls back to the default layout; use it to show what a change to a template affects.",
  handler: async (query, ctx) => {
    const { slug, kind } = query.payload;
    return { usedBy: collectTemplateUsage(ctx.registry, slug, kind) };
  },
});
