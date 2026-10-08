// Browser-spezifischer LocaleResolver-Default für createKumikoApp.
//
// Stateful: hält die aktuelle Locale in localStorage, bricht subscribe-
// listener bei setLocale(). Initial-wert kommt aus localStorage wenn
// gespeichert, sonst aus navigator.language, sonst aus defaultLocale.
//
// App-Code setzt die Locale programmatisch via resolver.setLocale() —
// der LanguageSwitcher-Component macht genau das. Persistenz über
// localStorage heißt: nach Page-Reload gleiche Sprache, ohne Server-
// Roundtrip. Für device-übergreifende Persistenz würde ein
// user:write:update auf user.locale zusätzlich gesetzt (separater
// App-Code, nicht im Resolver).

import { createStore, type LocaleResolver } from "@cosmicdrift/kumiko-headless";

export type CreateBrowserLocaleResolverOptions = {
  /** localStorage-Key unter dem die aktive Locale persistiert wird.
   *  Default: `"kumiko:locale"`. Apps die mehrere Kumiko-Instanzen auf
   *  derselben Origin mounten (selten), setzen verschiedene Keys. */
  readonly storageKey?: string;
  /** Fallback wenn weder localStorage noch navigator.language liefern.
   *  Default: `"en"`. */
  readonly defaultLocale?: string;
  /** Maps a stored or browser-reported tag onto one of the app's locales;
   *  `undefined` rejects it (a stored tag then falls through to
   *  navigator.language, the browser tag to `defaultLocale`). Only applied to
   *  the initial detection, not to `setLocale`. */
  readonly normalizeLocale?: (tag: string) => string | undefined;
};

export const BROWSER_LOCALE_STORAGE_KEY = "kumiko:locale";

function detectInitialLocale(
  storageKey: string,
  fallback: string,
  normalizeLocale: (tag: string) => string | undefined,
): string {
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null && stored.length > 0) {
        const normalized = normalizeLocale(stored);
        if (normalized !== undefined) return normalized;
      }
    } catch {
      // localStorage kann throwen (safari private mode, disabled) —
      // leise auf navigator zurückfallen.
    }
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    return normalizeLocale(navigator.language) ?? fallback;
  }
  return fallback;
}

function detectTimeZone(): string {
  if (typeof Intl === "undefined") return "UTC";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
}

/** Default-Resolver wenn createKumikoApp ohne `locale`-Option gebootet
 *  wird. Stateful: setLocale() persistiert in localStorage und ruft
 *  subscribed listeners. Apps die eine vollwertige i18n-Schicht haben
 *  (i18next, FormatJS, eigener Store), reichen stattdessen ihre eigene
 *  Resolver-Impl via `createKumikoApp({ locale })`. */
export function createBrowserLocaleResolver(
  options: CreateBrowserLocaleResolverOptions = {},
): LocaleResolver {
  const storageKey = options.storageKey ?? BROWSER_LOCALE_STORAGE_KEY;
  const fallback = options.defaultLocale ?? "en";
  const store = createStore(
    detectInitialLocale(storageKey, fallback, options.normalizeLocale ?? ((tag) => tag)),
  );
  const timeZone = detectTimeZone();

  return {
    translate: (key) => key,
    locale: () => store.getSnapshot(), // @wrapper-known semantic-alias
    timeZone: () => timeZone,
    subscribe: store.subscribe,
    setLocale: (next) => {
      // skip: locale unchanged, avoid redundant localStorage write
      // own Object.is-Gate would already block listener notification,
      // but the persistence side-effect lives outside the store.
      if (next === store.getSnapshot()) return;
      store.setState(next);
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(storageKey, next);
        } catch {
          // Persistenz fehlgeschlagen ist nicht fatal — die Session-Locale
          // bleibt trotzdem gesetzt, nur der nächste Reload verliert sie.
        }
      }
    },
  };
}
