import type { TranslationEntry, TranslationKeys } from "@cosmicdrift/kumiko-framework/engine";
import { translationValueOtherText } from "@cosmicdrift/kumiko-framework/ui-types";

const FALLBACK_LOCALE = "en";

// localeCompare depends on the runtime locale and ICU punctuation rules; qualified
// names contain `:`, so compare by code point instead for deterministic ordering.
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Requested locale, then English, then the first remaining locale in code-point
 *  order; `undefined` when the entry has no text at all (the key is then omitted). */
export function pickLabel(
  labels: Readonly<Record<string, string>>,
  locale: string,
): string | undefined {
  const nonEmpty = (value: string | undefined): string | undefined =>
    value !== undefined && value !== "" ? value : undefined;
  const firstLocale = Object.keys(labels)
    .sort(compareIds)
    .find((key) => nonEmpty(labels[key]));
  return (
    nonEmpty(labels[locale]) ??
    nonEmpty(labels[FALLBACK_LOCALE]) ??
    (firstLocale !== undefined ? labels[firstLocale] : undefined)
  );
}

/** The manifest surfaces one string per locale — a plural entry reads as its
 *  CLDR `other` form since the manifest has no `count` to select a category. */
export function entryAsLabels(entry: TranslationEntry): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(entry).map(([locale, value]) => [locale, translationValueOtherText(value)]),
  );
}

const labelsIndexByTranslations = new WeakMap<TranslationKeys, Map<string, SuffixMatch>>();

type SuffixMatch = { readonly key: string; readonly labels: Readonly<Record<string, string>> };

/** Every tail starting at a key boundary (`:` or `.`, with and without the
 *  separator) maps to the first key that ends with it. */
function buildSuffixIndex(translations: TranslationKeys): Map<string, SuffixMatch> {
  const index = new Map<string, SuffixMatch>();
  for (const [key, entry] of Object.entries(translations)) {
    const match: SuffixMatch = { key, labels: entryAsLabels(entry) };
    const addTail = (start: number): void => {
      const tail = key.slice(start);
      if (!index.has(tail)) index.set(tail, match);
    };
    addTail(0);
    for (let position = 0; position < key.length; position++) {
      if (key[position] === ":" || key[position] === ".") {
        addTail(position);
        addTail(position + 1);
      }
    }
  }
  return index;
}

/** Translation keys carry a feature prefix the manifest can't reconstruct
 *  (`showcase:entity:item:field:title`), so match on the suffix instead. The
 *  suffix must start at a `:` or `.` boundary of the key. */
export function labelsForSuffix(
  translations: TranslationKeys,
  suffix: string,
): Readonly<Record<string, string>> {
  return suffixMatch(translations, suffix)?.labels ?? {};
}

function suffixMatch(translations: TranslationKeys, suffix: string): SuffixMatch | undefined {
  let index = labelsIndexByTranslations.get(translations);
  if (index === undefined) {
    index = buildSuffixIndex(translations);
    labelsIndexByTranslations.set(translations, index);
  }
  return index.get(suffix);
}

const LOCALE_PACKAGE_PREFIX = "locale-";

const localePackageKeysByTranslations = new WeakMap<TranslationKeys, Map<string, string[]>>();

/** Locale packages register their entries as `locale-<xx>:<key>`; map each `<key>` to
 *  the registered keys that carry it, in code-point order. */
function localePackageKeys(translations: TranslationKeys): Map<string, string[]> {
  let index = localePackageKeysByTranslations.get(translations);
  if (index === undefined) {
    index = new Map<string, string[]>();
    for (const key of Object.keys(translations).sort(compareIds)) {
      if (!key.startsWith(LOCALE_PACKAGE_PREFIX)) continue;
      const name = key.slice(key.indexOf(":") + 1);
      index.set(name, [...(index.get(name) ?? []), key]);
    }
    localePackageKeysByTranslations.set(translations, index);
  }
  return index;
}

/** The labels of `fullKey` per locale, completed by locale packages that translate it
 *  under `locale-<xx>:<fullKey>` or, for `<feature>:<key>`, under `locale-<xx>:<key>`.
 *  The owner's text wins, then the locale packages in code-point order. */
export function localizedLabels(
  translations: TranslationKeys,
  fullKey: string,
): Readonly<Record<string, string>> {
  const plainKey = fullKey.includes(":") ? fullKey.slice(fullKey.indexOf(":") + 1) : undefined;
  const packages = localePackageKeys(translations);
  const keys = [
    ...(translations[fullKey] === undefined ? [] : [fullKey]),
    ...[
      ...new Set([
        ...(packages.get(fullKey) ?? []),
        ...(plainKey ? (packages.get(plainKey) ?? []) : []),
      ]),
    ].sort(compareIds),
  ];
  const merged: Record<string, string> = {};
  for (const key of keys) {
    for (const [locale, label] of Object.entries(entryAsLabels(translations[key] ?? {}))) {
      if (merged[locale] === undefined) merged[locale] = label;
    }
  }
  return merged;
}

/** `labelsForSuffix` with the locale-package completion of `localizedLabels`: the owner
 *  key behind the suffix is preferred over a locale package key that ends the same way. */
export function localizedLabelsForSuffix(
  translations: TranslationKeys,
  suffix: string,
): Readonly<Record<string, string>> {
  const match = suffixMatch(translations, suffix);
  if (match === undefined) return {};
  const owner = Object.keys(translations).find(
    (key) => !key.startsWith(LOCALE_PACKAGE_PREFIX) && key.endsWith(suffix),
  );
  return localizedLabels(translations, owner ?? match.key);
}

/** Entity field label per locale; `field` may be a dotted path, only its last segment names the field. */
export function entityFieldLabels(
  translations: TranslationKeys,
  entity: string,
  field: string,
): Readonly<Record<string, string>> {
  return localizedLabelsForSuffix(
    translations,
    `:entity:${entity}:field:${field.slice(field.lastIndexOf(".") + 1)}`,
  );
}

function lastSegmentOf(qualifiedId: string): string {
  return qualifiedId.slice(qualifiedId.lastIndexOf(":") + 1);
}

/** Screen titles live under the qualified id or, for feature-local screens, under
 *  `screen:<shortId>.title`. */
export function screenTitleLabels(
  translations: TranslationKeys,
  screenId: string,
): Readonly<Record<string, string>> {
  return entryAsLabels(
    translations[`${screenId}.title`] ??
      translations[`screen:${lastSegmentOf(screenId)}.title`] ??
      {},
  );
}

/** `screenTitleLabels` completed by locale packages (see `localizedLabels`). */
export function localizedScreenTitleLabels(
  translations: TranslationKeys,
  screenId: string,
): Readonly<Record<string, string>> {
  const own = localizedLabels(translations, `${screenId}.title`);
  return Object.keys(own).length > 0
    ? own
    : localizedLabels(translations, `screen:${lastSegmentOf(screenId)}.title`);
}
