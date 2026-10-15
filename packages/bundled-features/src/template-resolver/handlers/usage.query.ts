import { defineQueryHandler, parseQn } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { DEFAULT_MAIL_LAYOUT_SLUG, TEMPLATE_KINDS } from "../constants.js";
import { templateSlugSchema } from "../template-meta.js";

type UsageRole = "template" | "layout";

type UsageEntry = {
  readonly qualifiedName: string;
  readonly feature: string;
  readonly notification: string;
  readonly trigger: string;
  readonly role: UsageRole;
};

export const usageQuery = defineQueryHandler({
  name: "usage",
  schema: z.object({ slug: templateSlugSchema, kind: z.enum(TEMPLATE_KINDS) }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  description:
    "Lists the code-registered notifications that use one template: a mail template is used by the notification whose qualified name is its slug, a mail layout by every mail notification that names it in its meta or falls back to the default layout; use it to show what a change to a template affects.",
  handler: async (query, ctx) => {
    const { slug, kind } = query.payload;
    const usedBy: UsageEntry[] = [];
    if (kind === "mail" || kind === "mail-layout") {
      for (const [qualifiedName, notification] of ctx.registry.getAllNotifications()) {
        const role: UsageRole = kind === "mail" ? "template" : "layout";
        const isUsed =
          kind === "mail"
            ? qualifiedName === slug
            : [
                ...new Set([
                  ...Object.keys(notification.template ?? {}),
                  ...Object.keys(notification.meta ?? {}),
                ]),
              ].some(
                (locale) =>
                  (notification.meta?.[locale]?.layoutSlug ?? DEFAULT_MAIL_LAYOUT_SLUG) === slug,
              );
        if (!isUsed) continue;
        const parsed = parseQn(qualifiedName);
        usedBy.push({
          qualifiedName,
          feature: parsed.scope,
          notification: parsed.name,
          trigger: notification.trigger.on,
          role,
        });
      }
    }
    usedBy.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
    return { usedBy };
  },
});
