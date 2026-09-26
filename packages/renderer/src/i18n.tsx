// Locale handling for React consumers of the Kumiko renderer. A thin layer
// around the platform-agnostic `LocaleResolver` contract from
// @cosmicdrift/kumiko-headless: provider, hooks, a default no-op resolver,
// and a fallback-bundle merge for feature-supplied translations.
//
// Architecture:
//   1. The app supplies exactly one `LocaleResolver` via `<LocaleProvider>`
//      (or none at all → the default resolver returns keys as-is).
//   2. Feature plugins may bring fallback bundles: when the app resolver
//      can't resolve a key, `useTranslation` tries the plugin bundles.
//      This keeps feature UI independent of the app's own i18next instance
//      and works out of the box, while staying fully overridable.
//   3. Re-render on locale change via `useSyncExternalStore` on the
//      resolver's `subscribe()` — app code can switch language mid-session
//      without a reload.

import { type Formality, formalLocaleTag } from "@cosmicdrift/kumiko-framework/ui-types";
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
      out[locale] ??= {};
      out[locale][key] = value;
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
const FormalityContext = createContext<Formality>("informal");

// Stabile Referenz statt `fallbackBundles = []` als Default-Parameter:
// ein Literal-Default wird bei JEDEM Aufruf neu allokiert und würde die
// useMemo-Referenzprüfung im Provider unten aushebeln, sobald der
// Aufrufer fallbackBundles weglässt.
const EMPTY_FALLBACK_BUNDLES: readonly TranslationsByLocale[] = [];

export type LocaleProviderProps = {
  readonly resolver: LocaleResolver;
  /** Default bundles supplied by feature plugins. Lookup order per key:
   *  (1) app resolver, (2) these bundles in array order, (3) key as-is.
   *  Apps can thus override individual keys without swapping out whole
   *  feature bundles. */
  readonly fallbackBundles?: readonly TranslationsByLocale[];
  /** Falls back to fallbackLocale when neither the current-locale nor the
   *  key lookup hits in a plugin bundle. Default: `"en"`. */
  readonly fallbackLocale?: string;
  readonly children: ReactNode;
};

export function LocaleProvider({
  resolver,
  fallbackBundles = EMPTY_FALLBACK_BUNDLES,
  fallbackLocale = "en",
  children,
}: LocaleProviderProps): ReactNode {
  // Without memoization every re-render of the provider (e.g. because an
  // ancestor component re-renders) builds a new context-value object —
  // every consumer of useTranslation()/useLocale() then sees a new `ctx`
  // reference and, even with useCallback memoization, a new `t`.
  // Consequence: `t` in a useEffect dependency array triggers an infinite
  // loop (see admin-shell Overview screens, prod incident).
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
    () => ctx.resolver.locale(),
  );
  return ctx.resolver;
}

/** Primäre API für Feature-UI. `t("key", params)` versucht in dieser
 *  Reihenfolge:
 *    1. App-Resolver (z.B. i18next)
 *    2. Plugin-Fallback-Bundles für current-locale (unter FormalityProvider
 *       "formal" zuerst `<locale>-x-formal`)
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
    () => ctx.resolver.locale(),
  );

  // `t` MUSS referenz-stabil sein solange sich Resolver/Bundles/Locale
  // nicht ändern — Consumer nutzen `t` regelmäßig in useEffect-Deps
  // (z.B. um Queries neu zu laden wenn sich die Sprache ändert). Ein neu
  // erzeugtes `t` pro Render führt sonst zu einem Render/Effect-Endlos-
  // Loop (siehe admin-shell Overview-Screens, Prod-Incident 2026-07-07).
  const formality = useContext(FormalityContext);
  return useCallback(
    (key: string, params?: Readonly<Record<string, unknown>>): string =>
      translateWithFallbacks(ctx, locale, formality, key, params),
    [ctx, locale, formality],
  );
}

/** Wording for the subtree: `formal` makes `t` prefer the `<locale>-x-formal`
 *  bundle entries (e.g. "Sie" on public pages) over plain `<locale>`. */
export function FormalityProvider({
  formality,
  children,
}: {
  readonly formality: Formality;
  readonly children: ReactNode;
}): ReactNode {
  return <FormalityContext.Provider value={formality}>{children}</FormalityContext.Provider>;
}

export function useFormality(): Formality {
  return useContext(FormalityContext);
}

// Lookup order: (1) app resolver — it returns the key itself when it has no
// entry, which is the invitation to try the plugin bundles; (2) the bundles in
// array order per locale tier; (3) the key as-is. Under "formal" the formal
// tier is searched across ALL bundles before any plain tier, so a plain "de"
// app override never puts "du" on a formal page when locale-de has a formal
// variant; an app rewording such a key must also ship its "de-x-formal" text.
function translateWithFallbacks(
  ctx: LocaleContextValue,
  locale: string,
  formality: Formality,
  key: string,
  params?: Readonly<Record<string, unknown>>,
): string {
  const resolved = ctx.resolver.translate(key, params);
  if (resolved !== key) return resolved;
  for (const localesToTry of bundleLocaleTiers(locale, ctx.fallbackLocale, formality)) {
    for (const bundle of ctx.fallbackBundles) {
      for (const localeToTry of localesToTry) {
        const value = bundle[localeToTry]?.[key];
        if (value !== undefined) return interpolate(value, params);
      }
    }
  }
  return key;
}

function bundleLocaleTiers(
  locale: string,
  fallbackLocale: string,
  formality: Formality,
): readonly (readonly string[])[] {
  const languageRoot = locale.split("-")[0] ?? locale;
  const plainTier = [locale, languageRoot, fallbackLocale];
  if (formality === "informal") return [plainTier];
  return [[formalLocaleTag(locale), formalLocaleTag(languageRoot)], plainTier];
}

function interpolate(template: string, params?: Readonly<Record<string, unknown>>): string {
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return value !== undefined ? String(value) : `{${name}}`;
  });
}

/** Non-throwing LocaleContext read — undefined outside LocaleProvider.
 *  Used by DataTable FormatCell so plain tables without a provider do not crash. */
export function useOptionalLocale(): string | undefined {
  const ctx = useContext(LocaleContext);
  useSyncExternalStore(
    (onStoreChange) => (ctx ? ctx.resolver.subscribe(onStoreChange) : () => {}),
    () => (ctx ? ctx.resolver.locale() : "en"),
    () => (ctx ? ctx.resolver.locale() : "en"),
  );
  return ctx === undefined ? undefined : ctx.resolver.locale();
}

/** Non-throwing time-zone read — "UTC" outside LocaleProvider, matching
 *  createStaticLocaleResolver's own default. */
export function useOptionalTimeZone(): string {
  const ctx = useContext(LocaleContext);
  return useSyncExternalStore(
    (onStoreChange) => (ctx ? ctx.resolver.subscribe(onStoreChange) : () => {}),
    () => (ctx ? ctx.resolver.timeZone() : "UTC"),
    () => (ctx ? ctx.resolver.timeZone() : "UTC"),
  );
}

/** Non-throwing translate — undefined outside LocaleProvider. */
export function useOptionalTranslation():
  | ((key: string, params?: Readonly<Record<string, unknown>>) => string)
  | undefined {
  const ctx = useContext(LocaleContext);
  const locale = useSyncExternalStore(
    (onStoreChange) => (ctx ? ctx.resolver.subscribe(onStoreChange) : () => {}),
    () => (ctx ? ctx.resolver.locale() : "en"),
    () => (ctx ? ctx.resolver.locale() : "en"),
  );
  const formality = useContext(FormalityContext);
  const t = useCallback(
    (key: string, params?: Readonly<Record<string, unknown>>): string =>
      ctx === undefined ? key : translateWithFallbacks(ctx, locale, formality, key, params),
    [ctx, locale, formality],
  );
  return ctx === undefined ? undefined : t;
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
