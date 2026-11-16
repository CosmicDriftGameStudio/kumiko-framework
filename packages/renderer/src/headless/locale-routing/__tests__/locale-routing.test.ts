import { describe, expect, test } from "bun:test";
import type { LocaleResolver } from "../../contracts/index.ts";
import { createLocaleRouter, wrapUrlLocaleResolver } from "../index.ts";

type MoneyHorsePage = "home" | "features" | "rechner" | "budget" | "ltv";

const moneyHorseRouter = createLocaleRouter<MoneyHorsePage>({
  defaultLocale: "de",
  prefixedLocales: ["en"],
  routes: {
    home: { de: "/", en: "/en" },
    features: { de: "/funktionen", en: "/en/features" },
    rechner: { de: "/rechner", en: "/en/rechner" },
    budget: { de: "/budget-rechner", en: "/en/budget-rechner" },
    ltv: { de: "/beleihungsauslauf", en: "/en/beleihungsauslauf" },
  },
  localeHints: { en: ["/features"] },
});

describe("createLocaleRouter money-horse config", () => {
  test("detectLang: prefixed, default, legacy hint", () => {
    expect(moneyHorseRouter.detectLang("/")).toBe("de");
    expect(moneyHorseRouter.detectLang("/en")).toBe("en");
    expect(moneyHorseRouter.detectLang("/en/rechner")).toBe("en");
    expect(moneyHorseRouter.detectLang("/rechner")).toBe("de");
    expect(moneyHorseRouter.detectLang("/features")).toBe("en");
    expect(moneyHorseRouter.detectLang("/features/")).toBe("en");
  });

  test("publicPath returns canonical paths per locale", () => {
    expect(moneyHorseRouter.publicPath("features", "de")).toBe("/funktionen");
    expect(moneyHorseRouter.publicPath("features", "en")).toBe("/en/features");
    expect(moneyHorseRouter.publicPath("rechner", "en")).toBe("/en/rechner");
  });

  test("resolvePage maps canonical and legacy paths", () => {
    expect(moneyHorseRouter.resolvePage("/funktionen")).toBe("features");
    expect(moneyHorseRouter.resolvePage("/en/features")).toBe("features");
    expect(moneyHorseRouter.resolvePage("/features")).toBe("features");
    expect(moneyHorseRouter.resolvePage("/en/rechner")).toBe("rechner");
    expect(moneyHorseRouter.resolvePage("/login")).toBeUndefined();
  });

  test("altLocalePath keeps logical page across locales", () => {
    expect(moneyHorseRouter.altLocalePath("/en")).toBe("/");
    expect(moneyHorseRouter.altLocalePath("/")).toBe("/en");
    expect(moneyHorseRouter.altLocalePath("/en/features")).toBe("/funktionen");
    expect(moneyHorseRouter.altLocalePath("/funktionen")).toBe("/en/features");
    expect(moneyHorseRouter.altLocalePath("/features")).toBe("/funktionen");
    expect(moneyHorseRouter.altLocalePath("/en/rechner")).toBe("/rechner");
    expect(moneyHorseRouter.altLocalePath("/rechner")).toBe("/en/rechner");
    expect(moneyHorseRouter.altLocalePath("/unknown")).toBe("/en");
  });

  test("sectionAnchor attaches fragment to page path", () => {
    expect(moneyHorseRouter.sectionAnchor("home", "de", "pricing")).toBe("/#pricing");
    expect(moneyHorseRouter.sectionAnchor("home", "en", "pricing")).toBe("/en#pricing");
  });
});

type PublicStatusPage = "home" | "developers";

const publicStatusRouter = createLocaleRouter<PublicStatusPage>({
  defaultLocale: "de",
  prefixedLocales: ["en"],
  routes: {
    home: { de: "/", en: "/en" },
    developers: { de: "/developers", en: "/en/developers" },
  },
});

describe("createLocaleRouter publicstatus config", () => {
  test("altLocalePath for developers", () => {
    expect(publicStatusRouter.altLocalePath("/en/developers")).toBe("/developers");
    expect(publicStatusRouter.altLocalePath("/developers")).toBe("/en/developers");
  });
});

describe("createLocaleRouter inverted default (website-style)", () => {
  const router = createLocaleRouter<"home">({
    defaultLocale: "en",
    prefixedLocales: ["de"],
    prefixFor: () => "/de",
    routes: {
      home: { en: "/", de: "/de" },
    },
  });

  test("detectLang with non-default prefix locale", () => {
    expect(router.detectLang("/")).toBe("en");
    expect(router.detectLang("/de")).toBe("de");
    expect(router.altLocalePath("/")).toBe("/de");
    expect(router.altLocalePath("/de")).toBe("/");
  });
});

type OfflotPage = "home" | "features";

const offlotRouter = createLocaleRouter<OfflotPage>({
  defaultLocale: "es",
  prefixedLocales: ["en", "de"],
  routes: {
    home: { es: "/", en: "/en", de: "/de" },
    features: { es: "/funciones", en: "/en/features", de: "/de/funktionen" },
  },
});

describe("createLocaleRouter with a third locale", () => {
  test("altLocalePath with explicit targetLocale reaches any locale", () => {
    expect(offlotRouter.altLocalePath("/", "de")).toBe("/de");
    expect(offlotRouter.altLocalePath("/", "en")).toBe("/en");
    expect(offlotRouter.altLocalePath("/en/features", "de")).toBe("/de/funktionen");
    expect(offlotRouter.altLocalePath("/de/funktionen", "es")).toBe("/funciones");
  });

  test("altLocalePath with explicit targetLocale equal to current locale is identity", () => {
    expect(offlotRouter.altLocalePath("/en/features", "en")).toBe("/en/features");
    expect(offlotRouter.altLocalePath("/funciones", "es")).toBe("/funciones");
  });

  test("altLocalePath falls back to homePage for unknown path with explicit target", () => {
    expect(offlotRouter.altLocalePath("/unknown", "de")).toBe("/de");
  });

  test("altLocalePath rejects a targetLocale that only resolves via the prototype chain", () => {
    expect(() => offlotRouter.altLocalePath("/", "__proto__")).toThrow(/no path for page/);
    expect(() => offlotRouter.altLocalePath("/", "constructor")).toThrow(/no path for page/);
    expect(() => offlotRouter.altLocalePath("/", "toString")).toThrow(/no path for page/);
  });

  test("altLocalePath without targetLocale keeps binary toggle to prefixedLocales[0]", () => {
    expect(offlotRouter.altLocalePath("/")).toBe("/en");
    expect(offlotRouter.altLocalePath("/en")).toBe("/");
    expect(offlotRouter.altLocalePath("/de")).toBe("/");
  });
});

describe("createLocaleRouter homePage validation", () => {
  test("throws at construction when homePage has no routes entry", () => {
    expect(() =>
      createLocaleRouter({
        defaultLocale: "de",
        prefixedLocales: ["en"],
        routes: { features: { de: "/funktionen", en: "/en/features" } },
      }),
    ).toThrow(/homePage/);
  });

  test("publicPath throws instead of crashing when page is missing from routes", () => {
    const router = createLocaleRouter<"home" | "features">({
      defaultLocale: "de",
      prefixedLocales: ["en"],
      routes: { home: { de: "/", en: "/en" } } as unknown as Record<
        "home" | "features",
        Record<string, string>
      >,
    });
    expect(() => router.publicPath("features", "de")).toThrow(/no path for page/);
  });
});

function staticBase(locale: string): LocaleResolver {
  let current = locale;
  const listeners = new Set<() => void>();
  return {
    translate: (key) => key,
    locale: () => current,
    timeZone: () => "UTC",
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setLocale: (next) => {
      current = next;
      for (const listener of listeners) listener();
    },
  };
}

describe("wrapUrlLocaleResolver", () => {
  test("registered path uses detectLang, not base locale", () => {
    const wrapped = wrapUrlLocaleResolver(staticBase("de"), {
      resolvePage: (pathname) => moneyHorseRouter.resolvePage(pathname),
      detectLang: (pathname) => moneyHorseRouter.detectLang(pathname),
      pathname: () => "/en/features",
    });
    expect(wrapped.locale()).toBe("en");
  });

  test("home path uses URL locale even when base differs", () => {
    const wrapped = wrapUrlLocaleResolver(staticBase("en"), {
      resolvePage: (pathname) => moneyHorseRouter.resolvePage(pathname),
      detectLang: (pathname) => moneyHorseRouter.detectLang(pathname),
      pathname: () => "/",
    });
    expect(wrapped.locale()).toBe("de");
  });

  test("missing pathname falls back to base locale (no fake /)", () => {
    const wrapped = wrapUrlLocaleResolver(staticBase("en"), {
      resolvePage: (pathname) => moneyHorseRouter.resolvePage(pathname),
      detectLang: (pathname) => moneyHorseRouter.detectLang(pathname),
      pathname: () => undefined,
    });
    expect(wrapped.locale()).toBe("en");
  });

  test("subscribe fires on pathname subscription", () => {
    let pathListener: (() => void) | undefined;
    const wrapped = wrapUrlLocaleResolver(staticBase("de"), {
      resolvePage: () => "home",
      detectLang: () => "en",
      pathname: () => "/en",
      subscribePathname: (listener) => {
        pathListener = listener;
        return () => {
          pathListener = undefined;
        };
      },
    });
    let hits = 0;
    const unsub = wrapped.subscribe(() => {
      hits += 1;
    });
    pathListener?.();
    expect(hits).toBe(1);
    unsub();
  });

  test("unregistered path keeps base locale", () => {
    const wrapped = wrapUrlLocaleResolver(staticBase("de"), {
      resolvePage: (pathname) => moneyHorseRouter.resolvePage(pathname),
      detectLang: (pathname) => moneyHorseRouter.detectLang(pathname),
      pathname: () => "/app/credits",
    });
    expect(wrapped.locale()).toBe("de");
  });

  test("setLocale passes through to base", () => {
    const base = staticBase("de");
    const wrapped = wrapUrlLocaleResolver(base, {
      resolvePage: () => undefined,
      detectLang: () => "en",
      pathname: () => "/app",
    });
    wrapped.setLocale?.("en");
    expect(base.locale()).toBe("en");
    expect(wrapped.locale()).toBe("en");
  });

  test("URL locale wins over sticky setLocale on a registered path", () => {
    const base = staticBase("de");
    const wrapped = wrapUrlLocaleResolver(base, {
      resolvePage: (pathname) => moneyHorseRouter.resolvePage(pathname),
      detectLang: (pathname) => moneyHorseRouter.detectLang(pathname),
      pathname: () => "/en/features",
    });
    wrapped.setLocale?.("de");
    expect(base.locale()).toBe("de");
    expect(wrapped.locale()).toBe("en");
  });

  test("translateFor resolves copy against the URL locale", () => {
    const base = staticBase("de");
    const wrapped = wrapUrlLocaleResolver(base, {
      resolvePage: (pathname) => moneyHorseRouter.resolvePage(pathname),
      detectLang: (pathname) => moneyHorseRouter.detectLang(pathname),
      pathname: () => "/en/features",
      translateFor: (locale, key) => `${locale}:${key}`,
    });
    expect(wrapped.translate("hello")).toBe("en:hello");
    expect(wrapped.locale()).toBe("en");
  });
});

const moneyHorseFile = (page: MoneyHorsePage, locale: string): string | undefined =>
  page === "home"
    ? `pages/${locale}/index.html`
    : page === "features"
      ? `pages/${locale}/features/index.html`
      : undefined;

describe("staticPageDispatch money-horse config", () => {
  const dispatch = (path: string) => moneyHorseRouter.staticPageDispatch(path, moneyHorseFile);

  test("canonical pages answer html, with or without trailing slash", () => {
    expect(dispatch("/")).toEqual({ kind: "html", file: "pages/de/index.html" });
    expect(dispatch("/en")).toEqual({ kind: "html", file: "pages/en/index.html" });
    expect(dispatch("/en/")).toEqual({ kind: "html", file: "pages/en/index.html" });
    expect(dispatch("/funktionen")).toEqual({ kind: "html", file: "pages/de/features/index.html" });
    expect(dispatch("/funktionen/")).toEqual({
      kind: "html",
      file: "pages/de/features/index.html",
    });
    expect(dispatch("/en/features")).toEqual({
      kind: "html",
      file: "pages/en/features/index.html",
    });
  });

  test("default-locale prefix and hint paths redirect to the canonical path", () => {
    expect(dispatch("/de")).toEqual({ kind: "redirect", to: "/", status: 301 });
    expect(dispatch("/de/")).toEqual({ kind: "redirect", to: "/", status: 301 });
    expect(dispatch("/features")).toEqual({ kind: "redirect", to: "/en/features", status: 301 });
    expect(dispatch("/features/")).toEqual({ kind: "redirect", to: "/en/features", status: 301 });
    expect(dispatch("/de/funktionen")).toEqual({
      kind: "redirect",
      to: "/funktionen",
      status: 301,
    });
  });

  test("non-static and unknown paths answer null", () => {
    expect(dispatch("/rechner")).toBeNull();
    expect(dispatch("/en/rechner")).toBeNull();
    expect(dispatch("/login")).toBeNull();
  });
});

type ShowPonyPage = "home" | "features" | "pricing";

const showPonyRouter = createLocaleRouter<ShowPonyPage>({
  defaultLocale: "en",
  prefixedLocales: ["de"],
  routes: {
    home: { en: "/", de: "/de" },
    features: { en: "/features", de: "/de/funktionen" },
    pricing: { en: "/pricing", de: "/de/preise" },
  },
  localeHints: { de: ["/funktionen", "/preise"] },
});

const showPonyFile = (page: ShowPonyPage, locale: string): string =>
  page === "home" ? `pages/${locale}/index.html` : `pages/${locale}/${page}/index.html`;

describe("staticPageDispatch show-pony config", () => {
  const dispatch = (path: string) => showPonyRouter.staticPageDispatch(path, showPonyFile);

  test("canonical pages answer html", () => {
    expect(dispatch("")).toEqual({ kind: "html", file: "pages/en/index.html" });
    expect(dispatch("/")).toEqual({ kind: "html", file: "pages/en/index.html" });
    expect(dispatch("/de")).toEqual({ kind: "html", file: "pages/de/index.html" });
    expect(dispatch("/de/")).toEqual({ kind: "html", file: "pages/de/index.html" });
    expect(dispatch("/features/")).toEqual({
      kind: "html",
      file: "pages/en/features/index.html",
    });
    expect(dispatch("/de/funktionen/")).toEqual({
      kind: "html",
      file: "pages/de/features/index.html",
    });
  });

  test("legacy default-locale prefix and hint paths redirect", () => {
    expect(dispatch("/en")).toEqual({ kind: "redirect", to: "/", status: 301 });
    expect(dispatch("/en/")).toEqual({ kind: "redirect", to: "/", status: 301 });
    expect(dispatch("/en/features")).toEqual({ kind: "redirect", to: "/features", status: 301 });
    expect(dispatch("/funktionen")).toEqual({
      kind: "redirect",
      to: "/de/funktionen",
      status: 301,
    });
    expect(dispatch("/preise/")).toEqual({ kind: "redirect", to: "/de/preise", status: 301 });
    expect(dispatch("/en/pricing")).toEqual({ kind: "redirect", to: "/pricing", status: 301 });
  });

  test("unknown paths answer null", () => {
    expect(dispatch("/en/funktionen")).toBeNull();
    expect(dispatch("/admin")).toBeNull();
  });
});
