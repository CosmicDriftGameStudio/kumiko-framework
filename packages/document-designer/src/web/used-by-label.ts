// @runtime client
import { DEFAULT_LAYOUT_SLUG } from "../constants.js";
import type { OverviewRowView, OverviewUsageView } from "./overview-row.js";

type Translate = (key: string, params?: Readonly<Record<string, unknown>>) => string;

// t() returns the key itself when no translation exists.
function translateOrRaw(t: Translate, key: string, raw: string): string {
  const translated = t(key);
  return translated === key ? raw : translated;
}

export function usageLabel(t: Translate, usage: OverviewUsageView): string {
  const feature = translateOrRaw(t, `${usage.feature}:feature.label`, usage.feature);
  const notification = translateOrRaw(
    t,
    `${usage.feature}:notify.${usage.notification}.label`,
    usage.notification,
  );
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
