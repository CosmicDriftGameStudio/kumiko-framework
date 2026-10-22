// Browser-specific LocaleResolver default for createKumikoApp.
//
// Stateful: stores the current locale in localStorage and notifies subscribed
// listeners when setLocale() is called. The initial value comes from
// localStorage when available, otherwise from navigator.language, and finally
// from defaultLocale.
//
// App code sets the locale programmatically via resolver.setLocale(), as the
// LanguageSwitcher component does. localStorage persistence preserves the
// language after a page reload without a server round trip. Cross-device
// persistence would additionally require a user:write:update for user.locale
// in separate app code, not in the resolver.

import { createStore, type LocaleResolver } from "../../headless/index.ts";

export type CreateBrowserLocaleResolverOptions = {
  /** localStorage key used to persist the active locale.
   *  Default: `"kumiko:locale"`. Apps that mount multiple Kumiko instances on
   *  the same origin (rarely) should use different keys. */
  readonly storageKey?: string;
  /** Fallback when neither localStorage nor navigator.language provides a locale.
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
      // localStorage can throw (Safari private mode, disabled) —
      // silently fall back to navigator.
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

/** Default resolver when createKumikoApp is booted without a `locale` option.
 *  Stateful: setLocale() persists to localStorage and notifies subscribed
 *  listeners. Apps with a full i18n layer (i18next, FormatJS, or a custom
 *  store) should instead pass their own resolver via
 *  `createKumikoApp({ locale })`. */
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
          // Persistence failure is not fatal — the session locale remains set,
          // but the next reload will lose it.
        }
      }
    },
  };
}
