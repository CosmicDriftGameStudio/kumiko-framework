import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { ApiDocsProblem } from "../problems.ts";
import { deApiDocsTexts } from "./de.ts";
import { enApiDocsTexts } from "./en.ts";
import { esApiDocsTexts } from "./es.ts";
import { frApiDocsTexts } from "./fr.ts";
import { itApiDocsTexts } from "./it.ts";
import { type ApiDocsTexts, isParagraphTextKey, placeholdersOf } from "./types.ts";

export const apiDocsLocales = ["en", "de", "es", "fr", "it"] as const;

export type ApiDocsLocale = (typeof apiDocsLocales)[number];

export function isApiDocsLocale(value: string): value is ApiDocsLocale {
  return isOneOf(apiDocsLocales, value);
}

const textsByLocale: Readonly<Record<ApiDocsLocale, ApiDocsTexts>> = {
  en: enApiDocsTexts,
  de: deApiDocsTexts,
  es: esApiDocsTexts,
  fr: frApiDocsTexts,
  it: itApiDocsTexts,
};

export function apiDocsTextsFor(locale: ApiDocsLocale): ApiDocsTexts {
  return textsByLocale[locale];
}

/** Applies the app's paragraph overrides. A bad override is reported and skipped,
 *  never half applied, so the page keeps its shipped wording. */
export function resolveApiDocsTexts(
  locale: ApiDocsLocale,
  overrides: Readonly<Record<string, string>> | undefined,
): { readonly texts: ApiDocsTexts; readonly problems: readonly ApiDocsProblem[] } {
  const base = textsByLocale[locale];
  if (overrides === undefined) return { texts: base, problems: [] };
  const problems: ApiDocsProblem[] = [];
  const text = { ...base.text };
  for (const [key, value] of Object.entries(overrides)) {
    if (!isParagraphTextKey(key)) {
      problems.push({
        kind: "invalidTextOverride",
        locale,
        key,
        cause: "Not an overridable paragraph key.",
      });
      continue;
    }
    const allowed = placeholdersOf(base.text[key]);
    const unknown = [...placeholdersOf(value)].filter((name) => !allowed.has(name));
    if (unknown.length > 0) {
      problems.push({
        kind: "invalidTextOverride",
        locale,
        key,
        cause: `Unknown placeholders: ${unknown.map((name) => `{${name}}`).join(", ")}. Allowed: ${[...allowed].map((name) => `{${name}}`).join(", ") || "none"}.`,
      });
      continue;
    }
    text[key] = value;
  }
  return { texts: { ...base, text }, problems };
}

export type { ApiDocsTextKey, ApiDocsTexts, DocumentedErrorCode } from "./types.ts";
export { formatApiDocsText } from "./types.ts";
