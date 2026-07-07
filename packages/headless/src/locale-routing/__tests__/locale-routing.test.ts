import { describe, expect, test } from "bun:test";
import { createLocaleRouter } from "../index";

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
  const router = createLocaleRouter({
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
