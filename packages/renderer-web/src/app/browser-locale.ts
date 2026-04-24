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

import type { LocaleResolver } from "@kumiko/headless";

export type CreateBrowserLocaleResolverOptions = {
  /** localStorage-Key unter dem die aktive Locale persistiert wird.
   *  Default: `"kumiko:locale"`. Apps die mehrere Kumiko-Instanzen auf
   *  derselben Origin mounten (selten), setzen verschiedene Keys. */
  readonly storageKey?: string;
  /** Fallback wenn weder localStorage noch navigator.language liefern.
   *  Default: `"en"`. */
  readonly defaultLocale?: string;
};

function detectInitialLocale(storageKey: string, fallback: string): string {
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null && stored.length > 0) return stored;
    } catch {
      // localStorage kann throwen (safari private mode, disabled) —
      // leise auf navigator zurückfallen.
    }
  }
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
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
  const storageKey = options.storageKey ?? "kumiko:locale";
  const fallback = options.defaultLocale ?? "en";
  let current = detectInitialLocale(storageKey, fallback);
  const timeZone = detectTimeZone();
  const listeners = new Set<() => void>();

  return {
    translate: (key) => key,
    locale: () => current,
    timeZone: () => timeZone,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setLocale: (next) => {
      if (next === current) return;
      current = next;
      if (typeof localStorage !== "undefined") {
        try {
          localStorage.setItem(storageKey, next);
        } catch {
          // Persistenz fehlgeschlagen ist nicht fatal — die Session-Locale
          // bleibt trotzdem gesetzt, nur der nächste Reload verliert sie.
        }
      }
      for (const listener of listeners) listener();
    },
  };
}
