// Locale and currency can come from user data (e.g. a JSONB field), so the key
// space is unbounded. A screen uses a handful of combinations, so dropping the
// whole map at the cap is enough and needs no LRU bookkeeping.
export const MAX_CACHED_FORMAT_ENTRIES = 256;

const numberFormats = new Map<string, Intl.NumberFormat>();
const canonicalLocales = new Map<string, string>();

function rememberBounded<V>(cache: Map<string, V>, key: string, value: V): V {
  if (cache.size >= MAX_CACHED_FORMAT_ENTRIES) cache.clear();
  cache.set(key, value);
  return value;
}

// `null` keeps the runtime-default locale (undefined) apart from any explicit
// tag, including "" which must keep throwing. A constructor that throws is not cached.
export function cachedNumberFormat(
  locale: string | undefined,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = JSON.stringify([locale ?? null, options]);
  return (
    numberFormats.get(key) ??
    rememberBounded(numberFormats, key, new Intl.NumberFormat(locale, options))
  );
}

export function canonicalLocaleOr(candidate: string, fallback: string): string {
  const key = JSON.stringify([candidate, fallback]);
  const cached = canonicalLocales.get(key);
  if (cached !== undefined) return cached;
  let resolved: string;
  try {
    resolved = Intl.getCanonicalLocales(candidate)[0] ?? fallback;
  } catch {
    resolved = fallback;
  }
  return rememberBounded(canonicalLocales, key, resolved);
}
