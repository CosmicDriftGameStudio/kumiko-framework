// Locale-Handling für React-Consumer des Kumiko-Renderers. Eine dünne
// Schicht um den platform-agnostischen `LocaleResolver`-Contract aus
// @cosmicdrift/kumiko-headless: Provider, Hooks, Default-Noop-Resolver und ein
// Fallback-Bundle-Merge für Feature-gelieferte Translations.
//
// Architektur-Idee:
//   1. App liefert genau einen `LocaleResolver` über `<LocaleProvider>`
//      (oder überhaupt keinen → Default-Resolver returnt keys as-is).
//   2. Feature-Plugins dürfen Fallback-Bundles mitbringen: wenn der
//      App-Resolver einen Key nicht auflöst, probiert `useTranslation`
//      die Plugin-Bundles. Das hält Feature-UI unabhängig von der
//      App-seitigen i18next-Instanz und funktioniert out-of-the-box,
//      bleibt aber vollständig overridbar.
//   3. Re-Render bei Locale-Wechsel via `useSyncExternalStore` auf
//      dem Resolver's `subscribe()` — App-Code kann mitten in der
//      Session die Sprache umschalten ohne Reload.

import type { LocaleResolver } from "@cosmicdrift/kumiko-headless";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

/** Map von i18n-Key → Template-String. Templates dürfen `{name}`-
 *  Platzhalter enthalten — identische Semantik zu i18next-t. */
export type TranslationBundle = Readonly<Record<string, string>>;

/** Map von Locale-Code (BCP-47, z.B. `"de"`, `"en-US"`) → Bundle. */
export type TranslationsByLocale = Readonly<Record<string, TranslationBundle>>;

/** Key-first shape for `r.translations({ keys })` — each key maps locale → string. */
export type TranslationsByKey = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** Pivot key-first server translations to locale-first client bundles. */
export function translationsByLocaleFromKeys(source: TranslationsByKey): TranslationsByLocale {
  const out: Record<string, Record<string, string>> = {};
  for (const [key, byLocale] of Object.entries(source)) {
    for (const [locale, value] of Object.entries(byLocale)) {
      const bucket = out[locale] ?? {};
      bucket[key] = value;
      out[locale] = bucket;
    }
  }
  return out;
}

/** Merged zwei TranslationsByLocale-Maps — der override gewinnt pro Key,
 *  die Locales werden zusammengeführt. Standard-Baustein für Client-
 *  Plugins, die App-Overrides über ihre Default-Bundles legen. */
export function mergeTranslations(
  base: TranslationsByLocale,
  override: TranslationsByLocale,
): TranslationsByLocale {
  const locales = new Set([...Object.keys(base), ...Object.keys(override)]);
  const merged: Record<string, Record<string, string>> = {};
  for (const locale of locales) {
    merged[locale] = { ...(base[locale] ?? {}), ...(override[locale] ?? {}) };
  }
  return merged;
}

type LocaleContextValue = {
  readonly resolver: LocaleResolver;
  readonly fallbackBundles: readonly TranslationsByLocale[];
  readonly fallbackLocale: string;
};

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

// Stabile Referenz statt `fallbackBundles = []` als Default-Parameter:
// ein Literal-Default wird bei JEDEM Aufruf neu allokiert und würde die
// useMemo-Referenzprüfung im Provider unten aushebeln, sobald der
// Aufrufer fallbackBundles weglässt.
const EMPTY_FALLBACK_BUNDLES: readonly TranslationsByLocale[] = [];

export type LocaleProviderProps = {
  readonly resolver: LocaleResolver;
  /** Von Feature-Plugins gelieferte Default-Bundles. Lookup-Reihenfolge
   *  pro Key: (1) App-Resolver, (2) diese Bundles in Array-Order,
   *  (3) Key as-is. Apps können somit einzelne Keys overriden ohne
   *  ganze Feature-Bundles austauschen zu müssen. */
  readonly fallbackBundles?: readonly TranslationsByLocale[];
  /** Auf den fallbackLocale wird zurückgegriffen, wenn weder der
   *  current-locale- noch der key-Lookup im Plugin-Bundle greift.
   *  Default: `"en"`. */
  readonly fallbackLocale?: string;
  readonly children: ReactNode;
};

export function LocaleProvider({
  resolver,
  fallbackBundles = EMPTY_FALLBACK_BUNDLES,
  fallbackLocale = "en",
  children,
}: LocaleProviderProps): ReactNode {
  // Ohne Memoization baut jeder Re-Render des Providers (z.B. weil ein
  // Ahnen-Component neu rendert) ein neues Context-Value-Objekt — jeder
  // Consumer von useTranslation()/useLocale() sieht dann eine neue `ctx`-
  // Referenz und damit selbst mit useCallback-Memoization einen neuen `t`.
  // Konsequenz: `t` in einem useEffect-Dependency-Array triggert einen
  // Endlos-Loop (siehe admin-shell Overview-Screens, Prod-Incident).
  const value = useMemo(
    () => ({ resolver, fallbackBundles, fallbackLocale }),
    [resolver, fallbackBundles, fallbackLocale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Liefert den aktuellen LocaleResolver und abonniert automatisch
 *  Locale-Änderungen — der aufrufende Component re-rendert sobald die
 *  Sprache gewechselt wird. Wirft wenn kein Provider im Baum ist. */
export function useLocale(): LocaleResolver {
  const ctx = useContext(LocaleContext);
  if (ctx === undefined) {
    throw new Error("useLocale must be used inside <LocaleProvider>");
  }
  // Subscribe + current locale-snapshot. Wir brauchen den Rückgabewert
  // selbst nicht — wichtig ist nur der re-render-trigger.
  useSyncExternalStore(
    ctx.resolver.subscribe,
    () => ctx.resolver.locale(),
    () => "en",
  );
  return ctx.resolver;
}

/** Primäre API für Feature-UI. `t("key", params)` versucht in dieser
 *  Reihenfolge:
 *    1. App-Resolver (z.B. i18next)
 *    2. Plugin-Fallback-Bundles für current-locale
 *    3. Plugin-Fallback-Bundles für fallbackLocale
 *    4. Key as-is
 *  Interpolation für Platzhalter `{name}` passiert unabhängig von der
 *  Source — auch Fallback-Strings können parameters nutzen. */
export function useTranslation(): (
  key: string,
  params?: Readonly<Record<string, unknown>>,
) => string {
  const ctx = useContext(LocaleContext);
  if (ctx === undefined) {
    throw new Error("useTranslation must be used inside <LocaleProvider>");
  }
  // Re-Render bei Sprach-Wechsel. `ctx.resolver.subscribe` ist bereits
  // eine stable-reference aus dem Resolver, daher hier keine eigene
  // Memoization der Subscribe-Callback nötig.
  const locale = useSyncExternalStore(
    ctx.resolver.subscribe,
    () => ctx.resolver.locale(),
    () => "en",
  );

  // `t` MUSS referenz-stabil sein solange sich Resolver/Bundles/Locale
  // nicht ändern — Consumer nutzen `t` regelmäßig in useEffect-Deps
  // (z.B. um Queries neu zu laden wenn sich die Sprache ändert). Ein neu
  // erzeugtes `t` pro Render führt sonst zu einem Render/Effect-Endlos-
  // Loop (siehe admin-shell Overview-Screens, Prod-Incident 2026-07-07).
  return useCallback(
    (key: string, params?: Readonly<Record<string, unknown>>): string => {
      // 1. App-provided resolver zuerst. Convention: wenn der App-Resolver
      //    den Key nicht kennt, gibt er den Key zurück — das ist die
      //    Fallback-Einladung an Plugin-Bundles. i18next verhält sich
      //    exakt so per default.
      const resolved = ctx.resolver.translate(key, params);
      if (resolved !== key) return resolved;

      // 2. + 3. Plugin-Bundles durchlaufen für current + fallback-locale.
      const primaryLookup = locale;
      // `primaryLookup` könnte z.B. "de-AT" sein — in den Bundles stehen
      // oft nur die Language-Roots ("de"). Wir versuchen beide.
      const languageRoot = primaryLookup.split("-")[0] ?? primaryLookup;
      const localesToTry = [primaryLookup, languageRoot, ctx.fallbackLocale];

      for (const bundle of ctx.fallbackBundles) {
        for (const localeToTry of localesToTry) {
          const value = bundle[localeToTry]?.[key];
          if (value !== undefined) return interpolate(value, params);
        }
      }

      // 4. Nichts gefunden — key zurück, wie der Default-Resolver auch.
      return key;
    },
    [ctx, locale],
  );
}

function interpolate(template: string, params?: Readonly<Record<string, unknown>>): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return value !== undefined ? String(value) : `{${name}}`;
  });
}

/** Default-Resolver für Apps ohne eigene i18n-Schicht. Gibt jeden Key
 *  unverändert zurück — die Plugin-Fallback-Bundles erledigen dann die
 *  echte Übersetzung. Nützlich auch als Basis für Tests. */
export function createStaticLocaleResolver(
  options: { readonly locale?: string; readonly timeZone?: string } = {},
): LocaleResolver {
  const locale = options.locale ?? "en";
  const timeZone = options.timeZone ?? "UTC";
  return {
    translate: (key: string) => key,
    locale: () => locale,
    timeZone: () => timeZone,
    // No-op subscribe: unsere Locale ist statisch, es gibt nie ein
    // Change-Event. Unsubscribe ist ebenfalls no-op.
    subscribe: () => () => {},
  };
}
