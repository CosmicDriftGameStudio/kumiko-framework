export type LocaleRouterConfig<TPage extends string> = {
  /** Canonical default, usually "de". No URL prefix. */
  readonly defaultLocale: string;
  /** Locales that get a URL prefix, e.g. ["en"] → /en/... */
  readonly prefixedLocales: readonly string[];
  /** Prefix segment per locale, default: locale code ("en" → "/en"). */
  readonly prefixFor?: (locale: string) => string;
  /** Logical page → path per locale. Every page must define defaultLocale path. */
  readonly routes: Record<TPage, Record<string, string>>;
  /** Legacy slug-only paths for detectLang/resolvePage, e.g. { en: ["/features"] }. */
  readonly localeHints?: Readonly<Record<string, readonly string[]>>;
  /** Fallback page when altLocalePath cannot resolve pathname. Default: "home". */
  readonly homePage?: TPage;
};

export type LocaleRouter<TPage extends string> = {
  detectLang(pathname: string): string;
  publicPath(page: TPage, locale: string): string;
  resolvePage(pathname: string): TPage | undefined;
  altLocalePath(pathname: string): string;
  sectionAnchor(page: TPage, locale: string, fragment: string): string;
};

function normalizePath(pathname: string): string {
  if (pathname === "" || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

function defaultPrefixFor(locale: string): string {
  return `/${locale}`;
}

function stripLocalePrefix(
  path: string,
  locale: string,
  prefixFor: (locale: string) => string,
): string {
  const prefix = prefixFor(locale);
  if (path === prefix) return "/";
  if (path.startsWith(`${prefix}/`)) return path.slice(prefix.length);
  return path;
}

export function createLocaleRouter<TPage extends string>(
  config: LocaleRouterConfig<TPage>,
): LocaleRouter<TPage> {
  const {
    defaultLocale,
    prefixedLocales,
    routes,
    localeHints = {},
    prefixFor = defaultPrefixFor,
    homePage = "home" as TPage,
  } = config;

  if (routes[homePage] === undefined) {
    throw new Error(
      `locale-routing: homePage "${String(homePage)}" has no entry in routes — altLocalePath's fallback would throw at request time`,
    );
  }
  const pathIndex = new Map<string, { page: TPage; locale: string }>();

  for (const [page, localePaths] of Object.entries(routes) as [TPage, Record<string, string>][]) {
    for (const [locale, routePath] of Object.entries(localePaths)) {
      pathIndex.set(normalizePath(routePath), { page, locale });
    }
  }

  for (const [hintLocale, hints] of Object.entries(localeHints)) {
    for (const hint of hints) {
      const normalizedHint = normalizePath(hint);
      if (pathIndex.has(normalizedHint)) continue;

      for (const [page, localePaths] of Object.entries(routes) as [
        TPage,
        Record<string, string>,
      ][]) {
        const canonical = localePaths[hintLocale];
        if (canonical === undefined) continue;
        const canonicalNorm = normalizePath(canonical);
        const hintSlug = stripLocalePrefix(normalizedHint, hintLocale, prefixFor);
        const canonicalSlug = stripLocalePrefix(canonicalNorm, hintLocale, prefixFor);
        if (hintSlug === canonicalSlug) {
          pathIndex.set(normalizedHint, { page, locale: hintLocale });
          break;
        }
      }
    }
  }

  function detectLang(pathname: string): string {
    const path = normalizePath(pathname);
    for (const locale of prefixedLocales) {
      const prefix = prefixFor(locale);
      if (path === prefix || path.startsWith(`${prefix}/`)) return locale;
    }
    const resolved = pathIndex.get(path);
    if (resolved !== undefined) return resolved.locale;
    for (const [locale, hints] of Object.entries(localeHints)) {
      if (hints.some((hint) => normalizePath(hint) === path)) return locale;
    }
    return defaultLocale;
  }

  function resolvePage(pathname: string): TPage | undefined {
    return pathIndex.get(normalizePath(pathname))?.page;
  }

  function publicPath(page: TPage, locale: string): string {
    const localePaths = routes[page];
    const routePath = localePaths?.[locale];
    if (routePath === undefined) {
      throw new Error(`locale-routing: no path for page "${String(page)}" locale "${locale}"`);
    }
    return routePath;
  }

  function otherLocale(currentLocale: string): string {
    if (currentLocale === defaultLocale) {
      return prefixedLocales[0] ?? defaultLocale;
    }
    return defaultLocale;
  }

  function altLocalePath(pathname: string): string {
    const path = normalizePath(pathname);
    const resolved = pathIndex.get(path);
    const targetLocale = otherLocale(detectLang(pathname));
    if (resolved !== undefined) {
      return publicPath(resolved.page, targetLocale);
    }
    return publicPath(homePage, targetLocale);
  }

  function sectionAnchor(page: TPage, locale: string, fragment: string): string {
    return `${publicPath(page, locale)}#${fragment}`;
  }

  return { detectLang, publicPath, resolvePage, altLocalePath, sectionAnchor };
}
