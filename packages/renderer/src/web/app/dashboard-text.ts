import type {
  DashboardDateParam,
  DashboardI18nText,
  DashboardMoneyParam,
  DashboardRelativeTimeParam,
  DashboardTextParam,
} from "@cosmicdrift/kumiko-framework/ui-types";
import type { Translate } from "../../headless/index.ts";
import type { DashboardFormats } from "./dashboard-shared.tsx";

const MAX_TEXT_PARAM_DEPTH = 4;

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDashboardI18nText(value: unknown): value is DashboardI18nText {
  return isRecord(value) && typeof value["i18nKey"] === "string";
}

function isMoneyParam(value: unknown): value is DashboardMoneyParam {
  return (
    isRecord(value) &&
    value["kind"] === "money" &&
    typeof value["amountMinor"] === "number" &&
    typeof value["currency"] === "string"
  );
}

function isDateParam(value: unknown): value is DashboardDateParam {
  return isRecord(value) && value["kind"] === "date" && typeof value["atMs"] === "number";
}

function isRelativeTimeParam(value: unknown): value is DashboardRelativeTimeParam {
  return isRecord(value) && value["kind"] === "relativeTime" && typeof value["atMs"] === "number";
}

function isTextParam(value: unknown): value is DashboardTextParam {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    isDashboardI18nText(value) ||
    isMoneyParam(value) ||
    isDateParam(value) ||
    isRelativeTimeParam(value)
  );
}

function resolveTextParam(
  param: unknown,
  translate: Translate,
  formats: DashboardFormats,
  depth: number,
): string | number {
  if (typeof param === "string" || typeof param === "number") return param;
  if (isMoneyParam(param)) return formats.formatMinor(param.amountMinor, param.currency);
  if (isDateParam(param)) return formats.formatMedium(param.atMs);
  if (isRelativeTimeParam(param)) return formats.formatRelative(param.atMs);
  if (isDashboardI18nText(param)) {
    // Too deep: show the key instead of recursing further.
    return depth >= MAX_TEXT_PARAM_DEPTH
      ? param.i18nKey
      : resolveI18nText(param, translate, formats, depth + 1);
  }
  return "";
}

function resolveI18nText(
  text: DashboardI18nText,
  translate: Translate,
  formats: DashboardFormats,
  depth: number,
): string {
  if (text.i18nParams === undefined) return translate(text.i18nKey);
  const params: Record<string, string | number> = {};
  for (const [name, param] of Object.entries(text.i18nParams)) {
    if (isTextParam(param)) params[name] = resolveTextParam(param, translate, formats, depth);
  }
  return translate(text.i18nKey, params);
}

/** Plain strings pass through; DashboardI18nText is translated (nested params first).
 *  Anything else yields undefined so callers fall back to their own placeholder. */
export function resolveDashboardText(
  value: unknown,
  translate: Translate,
  formats: DashboardFormats,
): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (isDashboardI18nText(value)) return resolveI18nText(value, translate, formats, 1);
  return undefined;
}
