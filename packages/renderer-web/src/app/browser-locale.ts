// Browser-spezifischer LocaleResolver-Default für createKumikoApp.
// Liest die Präferenzen aus navigator.language + Intl.DateTimeFormat —
// keine App-Konfiguration nötig, der Sample bekommt sofort deutsch/
// englisch/was-auch-immer der User im Browser eingestellt hat, und
// Plugin-Bundles springen für bekannte Locales ein.
//
// Die Resolver-Instanz ist statisch — keine Language-Switch-API, der
// User muss seinen Browser umstellen für einen Wechsel. Sobald das
// i18next-Sample existiert wird der Resolver dort lebendig gemacht
// (subscribe triggert re-render bei User-initiierter Sprach-Wahl).

import type { LocaleResolver } from "@kumiko/headless";
import { createStaticLocaleResolver } from "@kumiko/renderer";

function detectLocale(): string {
  if (typeof navigator === "undefined") return "en";
  const raw = navigator.language;
  if (!raw) return "en";
  // navigator.language kann "de-DE" oder "de" sein — beides ist
  // valid BCP-47, wir reichen es durch wie es ist. useTranslation
  // strippt die Region intern für Bundle-Lookups wenn nötig.
  return raw;
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
 *  wird. Locale kommt aus `navigator.language`, TimeZone aus
 *  `Intl.DateTimeFormat` — das ist alles was man für "es sieht auf
 *  Anhieb vernünftig aus" braucht, ohne externe Deps. Apps die eine
 *  vollwertige i18n-Schicht haben (i18next, FormatJS, eigener Store),
 *  reichen ihre eigene Resolver-Impl via `createKumikoApp({ locale })`. */
export function createBrowserLocaleResolver(): LocaleResolver {
  return createStaticLocaleResolver({
    locale: detectLocale(),
    timeZone: detectTimeZone(),
  });
}
