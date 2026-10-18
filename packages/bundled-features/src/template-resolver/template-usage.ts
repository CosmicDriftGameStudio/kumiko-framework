import {
  type NotificationDefinition,
  parseQn,
  type Registry,
} from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_MAIL_LAYOUT_SLUG, type TemplateKind } from "./constants.js";

type UsageRole = "template" | "layout";

export type TemplateUsageEntry = {
  readonly qualifiedName: string;
  readonly feature: string;
  readonly notification: string;
  readonly trigger: string | null;
  readonly role: UsageRole;
  /** The mail goes through the tenant's own transport when it has a provider. */
  readonly tenantTransport: boolean;
};

/** Layout slug of the effective stored mail template, by notification qualified
 *  name and locale. The renderer reads the layout from the stored row's meta,
 *  so it wins over the code-registered notification meta. */
export type EffectiveMailLayoutSlugs = ReadonlyMap<string, ReadonlyMap<string, string>>;

function layoutSlugsOf(
  qualifiedName: string,
  notification: NotificationDefinition,
  effectiveLayouts: EffectiveMailLayoutSlugs,
): string[] {
  const stored = effectiveLayouts.get(qualifiedName);
  const locales = new Set([
    ...Object.keys(notification.template ?? {}),
    ...Object.keys(notification.meta ?? {}),
    ...(stored?.keys() ?? []),
  ]);
  return [...locales].map(
    (locale) =>
      stored?.get(locale) ?? notification.meta?.[locale]?.layoutSlug ?? DEFAULT_MAIL_LAYOUT_SLUG,
  );
}

export function collectTemplateUsage(
  registry: Registry,
  slug: string,
  kind: TemplateKind,
  effectiveLayouts: EffectiveMailLayoutSlugs = new Map(),
): TemplateUsageEntry[] {
  const usedBy: TemplateUsageEntry[] = [];
  if (kind === "mail" || kind === "mail-layout") {
    for (const [qualifiedName, notification] of registry.getAllNotifications()) {
      const role: UsageRole = kind === "mail" ? "template" : "layout";
      // Notifications without a code template are not rendered through the resolver.
      const isUsed =
        kind === "mail"
          ? qualifiedName === slug && notification.template !== undefined
          : layoutSlugsOf(qualifiedName, notification, effectiveLayouts).includes(slug);
      if (!isUsed) continue;
      const parsed = parseQn(qualifiedName);
      usedBy.push({
        qualifiedName,
        feature: parsed.scope,
        notification: parsed.name,
        trigger: notification.trigger?.on ?? null,
        role,
        tenantTransport: notification.tenantTransport === true,
      });
    }
  }
  usedBy.sort((a, b) => a.qualifiedName.localeCompare(b.qualifiedName));
  return usedBy;
}
