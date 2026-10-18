// @runtime client
import { DEFAULT_LAYOUT_SLUG } from "../constants.js";
import type { OverviewRowView, OverviewUsageView } from "./overview-row.js";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

// t() returns the key itself when no translation exists.
function translateOrRaw(t: Translate, key: string, raw: string): string {
  const translated = t(key);
  return translated === key ? raw : translated;
}

// A declared label is an i18n key or plain text; without one the variable name stands in.
export function variableLabelText(t: Translate, name: string, label: string | undefined): string {
  return label === undefined ? name : translateOrRaw(t, label, label);
}

const NOTIFICATION_SLUG = /^([^:]+):notify:([^:]+)$/;

// A seeded system mail has no stored title, so its notification label from the
// owning feature names it; the slug stays the last resort.
export function templateTitle(
  t: Translate,
  row: Pick<OverviewRowView, "title" | "slug" | "kind">,
): string {
  if (row.title !== row.slug) return row.title;
  const match = row.kind === "mail" ? NOTIFICATION_SLUG.exec(row.slug) : null;
  if (match === null) return row.slug;
  return usageParts(t, { feature: match[1] ?? "", notification: match[2] ?? "" }).notification;
}

export function usageParts(
  t: Translate,
  usage: OverviewUsageView,
): { readonly feature: string; readonly notification: string } {
  return {
    feature: translateOrRaw(t, `${usage.feature}:feature.label`, usage.feature),
    notification: translateOrRaw(
      t,
      `${usage.feature}:notify.${usage.notification}.label`,
      usage.notification,
    ),
  };
}

export function usageLabel(t: Translate, usage: OverviewUsageView): string {
  const { feature, notification } = usageParts(t, usage);
  return usage.feature === "" ? notification : `${feature} · ${notification}`;
}

export function usedByLabel(t: Translate, row: OverviewRowView): string {
  const emptyMark = "–";
  if (row.kind === "mail-layout" || row.kind === "pdf-layout") {
    if (row.slug === DEFAULT_LAYOUT_SLUG) {
      return t(
        row.kind === "mail-layout"
          ? "documentDesigner.usedBy.allMails"
          : "documentDesigner.usedBy.allPdfs",
      );
    }
    return row.usedByCount === 0
      ? emptyMark
      : t("documentDesigner.usedBy.templates", { count: row.usedByCount });
  }
  const first = row.usedBy[0];
  return first === undefined ? emptyMark : usageLabel(t, first);
}
