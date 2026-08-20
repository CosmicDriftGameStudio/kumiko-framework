// Active-locale header transport for the live dispatcher.
//
// @cosmicdrift/kumiko-renderer's LocaleProvider sets document.documentElement.lang
// to the resolver's current locale on mount and on every locale change (see
// i18n.tsx). This module reads that value back so every outgoing request
// carries the language the user is ACTUALLY using — not the app's hardcoded
// boot language — with zero app-side wiring: any app that renders
// <LocaleProvider> already gets this for free.

// Kept in sync with LOCALE_HEADER_NAME in api-constants.ts by hand rather
// than imported from @cosmicdrift/kumiko-framework — this package must
// remain server-dep-free (runs in browsers and React Native).
export const LOCALE_HEADER_NAME = "X-Locale";

// Reads document.documentElement.lang. Returns undefined for non-browser
// environments (SSR, Web Worker, React Native) or before any provider has
// set a lang yet — callers skip the header in that case and the server
// falls back to Accept-Language, then its boot default.
export function readActiveLocale(): string | undefined {
  const g = globalThis as { document?: { documentElement?: { lang?: string } } };
  const lang = g.document?.documentElement?.lang;
  return lang !== undefined && lang.length > 0 ? lang : undefined;
}
