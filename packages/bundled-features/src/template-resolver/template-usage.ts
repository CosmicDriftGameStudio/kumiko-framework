import { parseQn, type Registry } from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_MAIL_LAYOUT_SLUG, type TemplateKind } from "./constants.js";

type UsageRole = "template" | "layout";

export type TemplateUsageEntry = {
  readonly qualifiedName: string;
  readonly feature: string;
  readonly notification: string;
  readonly trigger: string | null;
  readonly role: UsageRole;
};

export function collectTemplateUsage(
  registry: Registry,
  slug: string,
  kind: TemplateKind,
): TemplateUsageEntry[] {
  const usedBy: TemplateUsageEntry[] = [];
  if (kind === "mail" || kind === "mail-layout") {
    for (const [qualifiedName, notification] of registry.getAllNotifications()) {
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
        trigger: notification.trigger?.on ?? null,
        role,
      });
    }
  }
  usedBy.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
  return usedBy;
}
