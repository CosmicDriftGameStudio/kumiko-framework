import type { TemplateEditorKind } from "./constants.ts";

export type OverviewUsageView = {
  readonly feature: string;
  readonly notification: string;
};

export type OverviewRowView = {
  readonly id: string;
  readonly title: string;
  readonly layoutSlug: string | null;
  readonly slug: string;
  readonly kind: TemplateEditorKind;
  readonly origin: "tenant" | "system";
  readonly locales: readonly string[];
  readonly status: "draft" | "active" | "archived";
  readonly version: number;
  /** An open draft beside the served version, never another tenant's. */
  readonly draftVersion: number | null;
  readonly systemVersion: number | null;
  /** SystemAdmin only: a stored tenant override that is not delivered. */
  readonly lockedOverride: boolean;
  readonly lockedOverrideI18nKey: string | null;
  readonly modifiedAt: string;
  readonly usedBy: readonly OverviewUsageView[];
  readonly usedByCount: number;
  /** SystemAdmin only, system-origin rows; total is null without the tenant feature. */
  readonly overriddenBy: { readonly active: number; readonly total: number | null } | null;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTemplateKind(value: unknown): value is TemplateEditorKind {
  return (
    value === "mail" ||
    value === "document-pdf" ||
    value === "mail-layout" ||
    value === "pdf-layout"
  );
}

function isStatus(value: unknown): value is OverviewRowView["status"] {
  return value === "draft" || value === "active" || value === "archived";
}

function usageViewOf(value: unknown): OverviewUsageView | null {
  if (!isRecord(value)) return null;
  const { feature, notification } = value;
  return typeof feature === "string" && typeof notification === "string"
    ? { feature, notification }
    : null;
}

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback;

const numberOr = <T extends number | null>(value: unknown, fallback: T): number | T =>
  typeof value === "number" ? value : fallback;

function overriddenByOf(value: unknown): OverviewRowView["overriddenBy"] {
  if (!isRecord(value) || typeof value["active"] !== "number") return null;
  return { active: value["active"], total: numberOr(value["total"], null) };
}

export function parseOverviewRow(row: Readonly<Record<string, unknown>>): OverviewRowView | null {
  const {
    id,
    title,
    layoutSlug,
    slug,
    kind,
    origin,
    locales,
    status,
    version,
    draftVersion,
    systemVersion,
    lockedOverride,
    lockedOverrideI18nKey,
    modifiedAt,
    usedBy,
    usedByCount,
    overriddenBy,
  } = row;
  if (typeof slug !== "string" || !isTemplateKind(kind) || !isStatus(status)) return null;
  if (origin !== "tenant" && origin !== "system") return null;
  const usages = Array.isArray(usedBy) ? usedBy.flatMap((u) => usageViewOf(u) ?? []) : [];
  return {
    id: stringOr(id, `${kind}|${slug}`),
    title: stringOr(title, slug),
    layoutSlug: typeof layoutSlug === "string" ? layoutSlug : null,
    slug,
    kind,
    origin,
    locales: Array.isArray(locales)
      ? locales.filter((l): l is string => typeof l === "string")
      : [],
    status,
    version: numberOr(version, 0),
    draftVersion: numberOr(draftVersion, null),
    systemVersion: numberOr(systemVersion, null),
    lockedOverride: lockedOverride === true,
    lockedOverrideI18nKey: typeof lockedOverrideI18nKey === "string" ? lockedOverrideI18nKey : null,
    modifiedAt: stringOr(modifiedAt, ""),
    usedBy: usages,
    usedByCount: numberOr(usedByCount, usages.length),
    overriddenBy: overriddenByOf(overriddenBy),
  };
}
