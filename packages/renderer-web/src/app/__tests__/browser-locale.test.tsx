import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { BROWSER_LOCALE_STORAGE_KEY, createBrowserLocaleResolver } from "../browser-locale.js";

const SUPPORTED = ["de", "en"] as const;

function toSupportedLocale(tag: string): string | undefined {
  const base = tag.toLowerCase().split("-")[0] ?? "";
  return SUPPORTED.find((locale) => locale === base);
}

describe("createBrowserLocaleResolver", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  test("persists setLocale under the exported storage key", () => {
    const resolver = createBrowserLocaleResolver();
    resolver.setLocale?.("de");
    expect(localStorage.getItem(BROWSER_LOCALE_STORAGE_KEY)).toBe("de");
  });

  test("normalizeLocale maps a stored tag onto the app's locales", () => {
    localStorage.setItem(BROWSER_LOCALE_STORAGE_KEY, "de-AT");
    const resolver = createBrowserLocaleResolver({ normalizeLocale: toSupportedLocale });
    expect(resolver.locale()).toBe("de");
  });

  test("a stored tag the app rejects falls through to the default locale", () => {
    localStorage.setItem(BROWSER_LOCALE_STORAGE_KEY, "xx");
    const resolver = createBrowserLocaleResolver({
      normalizeLocale: () => undefined,
      defaultLocale: "en",
    });
    expect(resolver.locale()).toBe("en");
  });

  test("without normalizeLocale the stored tag is used verbatim", () => {
    localStorage.setItem(BROWSER_LOCALE_STORAGE_KEY, "fr-CA");
    expect(createBrowserLocaleResolver().locale()).toBe("fr-CA");
  });
});
