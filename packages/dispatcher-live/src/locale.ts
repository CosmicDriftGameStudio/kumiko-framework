// Active-locale header transport for the live dispatcher.
//
// @cosmicdrift/kumiko-renderer-web's DocumentLangSync (mounted by
// createKumikoApp/createPublicSurface) sets dataset.kumikoLocale from the
// LocaleResolver. This module reads that marker back so every outgoing
// request carries the language the user is ACTUALLY using — not a static
// <html lang> — with zero app-side wiring.

// Kept in sync with LOCALE_HEADER_NAME in api-constants.ts by hand rather
// than imported from @cosmicdrift/kumiko-framework — this package must
// remain server-dep-free (runs in browsers and React Native).
export const LOCALE_HEADER_NAME = "X-Locale";

// Loose BCP-47 tag check — reject newlines/junk that would break fetch headers.
const LOCALE_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

// Reads dataset.kumikoLocale. Returns undefined for non-browser environments
// (SSR, Web Worker, React Native), before DocumentLangSync has run, or when
// the value is not a safe language tag — callers skip the header and the
// server falls back to Accept-Language, then its boot default.
export function readActiveLocale(): string | undefined {
  const g = globalThis as {
    document?: { documentElement?: { dataset?: { kumikoLocale?: string } } };
  };
  const lang = g.document?.documentElement?.dataset?.kumikoLocale;
  if (lang === undefined || lang.length === 0) return undefined;
  return LOCALE_TAG.test(lang) ? lang : undefined;
}
