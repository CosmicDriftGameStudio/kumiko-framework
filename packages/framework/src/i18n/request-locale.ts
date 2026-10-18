// Request-scoped locale resolution — the language counterpart to ctx.tz
// (time/tz-context.ts). Unlike TzContext there's no closed catalog to
// validate against here: mail-registry.ts is a dynamic, per-package
// registry that locale packages (kumiko-locale-de, ...) populate at import
// time, so "known locale" isn't a fixed enum. Validation checks
// well-formedness instead — a header is user input either way.

export const DEFAULT_LOCALE = "en";

// Loose BCP-47: 2-3 letter primary subtag, then 1-8 more alphanumeric
// subtags separated by "-" (region/script/variant/extension). Rejects
// control characters, oversized values, and header-injection shapes
// without implementing a full RFC 5646 parser.
const LOCALE_TAG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
const MAX_LOCALE_TAG_LENGTH = 35;

export function isValidLocaleTag(value: string): boolean {
  return value.length <= MAX_LOCALE_TAG_LENGTH && LOCALE_TAG_RE.test(value);
}

/** BCP-47 is case-insensitive; canonicalize to the RFC 5646 conventional form
 *  (`de-AT`, `zh-Hant-TW`) so registry lookups (`mailT`, `hasMailTranslations`)
 *  hit registered keys regardless of header casing. */
export function canonicalizeLocaleTag(tag: string): string {
  return tag
    .split("-")
    .map((subtag, index) => {
      if (index === 0) return subtag.toLowerCase();
      if (/^[A-Za-z]{2}$/.test(subtag)) return subtag.toUpperCase();
      if (/^[A-Za-z]{4}$/.test(subtag)) {
        return subtag.charAt(0).toUpperCase() + subtag.slice(1).toLowerCase();
      }
      return subtag.toLowerCase();
    })
    .join("-");
}

type AcceptLanguageCandidate = { readonly tag: string; readonly q: number; readonly index: number };

/**
 * Well-formed tags of an Accept-Language header (RFC 9110 §12.5.4) in
 * preference order: "tag;q=x" pairs sorted by q descending, header order
 * breaking ties. Tags with q=0 (explicitly excluded) and malformed tags are
 * dropped. Tags are returned as sent, not canonicalized or deduped.
 */
export function rankAcceptLanguage(header: string | undefined): string[] {
  if (header === undefined || header.length === 0) return [];

  return header
    .split(",")
    .map((part, index): AcceptLanguageCandidate | undefined => {
      const [tagRaw, ...params] = part.trim().split(";");
      const tag = tagRaw?.trim();
      if (tag === undefined || tag.length === 0 || !isValidLocaleTag(tag)) return undefined;
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const parsedQ = qParam !== undefined ? Number(qParam.trim().slice(2)) : 1;
      const q = Number.isFinite(parsedQ) ? parsedQ : 0;
      return { tag, q, index };
    })
    .filter((c): c is AcceptLanguageCandidate => c !== undefined && c.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map((c) => c.tag);
}

/** Picks the best well-formed tag from an Accept-Language header, see rankAcceptLanguage. */
export function pickAcceptLanguage(header: string | undefined): string | undefined {
  return rankAcceptLanguage(header)[0];
}

/**
 * Ordered locale preference of a page request: a valid `?lang=` first, then
 * every Accept-Language tag by q. Canonicalized and deduped (case-insensitive),
 * so a resolver can walk the list and take the first locale it has content for.
 */
export function rankPreferredLocales(options: {
  readonly queryLang?: string | null | undefined;
  readonly acceptLanguage?: string | null | undefined;
}): string[] {
  const ranked: string[] = [];
  if (options.queryLang != null && isValidLocaleTag(options.queryLang)) {
    ranked.push(options.queryLang);
  }
  ranked.push(...rankAcceptLanguage(options.acceptLanguage ?? undefined));
  return [...new Set(ranked.map(canonicalizeLocaleTag))];
}

/**
 * Request-layer resolution: an explicit, validated X-Locale header wins;
 * otherwise the best Accept-Language tag; otherwise undefined — no signal
 * from this request, callers fall back further (the app's boot-configured
 * defaultLocale, then DEFAULT_LOCALE — see dispatch-shared.ts).
 */
export function resolveHeaderLocale(options: {
  readonly headerLocale?: string;
  readonly acceptLanguage?: string;
}): string | undefined {
  if (options.headerLocale !== undefined && isValidLocaleTag(options.headerLocale)) {
    return canonicalizeLocaleTag(options.headerLocale);
  }
  const picked = pickAcceptLanguage(options.acceptLanguage);
  return picked !== undefined ? canonicalizeLocaleTag(picked) : undefined;
}
