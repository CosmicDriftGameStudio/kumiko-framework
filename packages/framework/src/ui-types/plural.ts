import type { PluralForms, TranslationValue } from "@cosmicdrift/kumiko-types/config";

export type { PluralForms, TranslationValue } from "@cosmicdrift/kumiko-types/config";

// Hermes on older Expo/React Native builds doesn't ship Intl.PluralRules —
// fall back to `other` there instead of hand-rolling CLDR plural rules.
const hasPluralRulesSupport = typeof Intl !== "undefined" && typeof Intl.PluralRules === "function";

// `null` cache entries mark a locale tag Intl.PluralRules rejected, so a bad
// tag doesn't retry the constructor (and its exception) on every call.
const pluralRulesCache = new Map<string, Intl.PluralRules | null>();

function pluralRulesFor(locale: string): Intl.PluralRules | null {
  if (!hasPluralRulesSupport) return null;
  const cached = pluralRulesCache.get(locale);
  if (cached !== undefined) return cached;
  let rules: Intl.PluralRules | null;
  try {
    rules = new Intl.PluralRules(locale);
  } catch {
    rules = null;
  }
  pluralRulesCache.set(locale, rules);
  return rules;
}

function isFiniteCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function pluralFormText(forms: PluralForms, locale: string, count: unknown): string {
  if (!isFiniteCount(count)) return forms.other;
  const rules = pluralRulesFor(locale);
  if (rules === null) return forms.other;
  const category = rules.select(count);
  return forms[category] ?? forms.other;
}

function interpolate(
  template: string,
  params: Readonly<Record<string, unknown>> | undefined,
): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return value !== undefined ? String(value) : `{${name}}`;
  });
}

/** Text-only reading of a TranslationValue — the CLDR `other` form for a
 *  plural entry, or the string as-is. For call sites that render a single
 *  string (agent manifests, labels) without a locale/count context. */
export function translationValueOtherText(value: TranslationValue): string {
  return typeof value === "string" ? value : value.other;
}

/** Resolve a TranslationValue to display text: a plural entry picks its CLDR
 *  category via `Intl.PluralRules` from `params.count`, falling back to
 *  `other` when `count` is missing, non-finite, or `locale` is invalid.
 *  `{name}` interpolation then applies to the resolved string — an unknown
 *  placeholder is left as-is. */
export function resolveTranslationValue(
  value: TranslationValue,
  locale: string,
  params?: Readonly<Record<string, unknown>>,
): string {
  const text = typeof value === "string" ? value : pluralFormText(value, locale, params?.["count"]);
  return interpolate(text, params);
}
