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

type AcceptLanguageCandidate = { readonly tag: string; readonly q: number; readonly index: number };

/**
 * Picks the best well-formed tag from an Accept-Language header (RFC 9110
 * §12.5.4): parses "tag;q=x" pairs, sorts by q descending (header order
 * breaks ties), and returns the first tag that passes isValidLocaleTag.
 * Tags with q=0 (explicitly excluded) are dropped entirely.
 */
export function pickAcceptLanguage(header: string | undefined): string | undefined {
  if (header === undefined || header.length === 0) return undefined;

  const candidates: AcceptLanguageCandidate[] = header
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
    .sort((a, b) => b.q - a.q || a.index - b.index);

  return candidates[0]?.tag;
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
    return options.headerLocale;
  }
  return pickAcceptLanguage(options.acceptLanguage);
}
