import { describe, expect, test } from "bun:test";
import { canonicalizeLocaleTag, resolveHeaderLocale } from "../request-locale.js";

describe("canonicalizeLocaleTag", () => {
  test("lowercases the primary subtag", () => {
    expect(canonicalizeLocaleTag("DE")).toBe("de");
    expect(canonicalizeLocaleTag("DE-at")).toBe("de-AT");
    expect(canonicalizeLocaleTag("ZH-hant-tw")).toBe("zh-Hant-TW");
  });
});

describe("resolveHeaderLocale", () => {
  test("canonicalizes X-Locale", () => {
    expect(resolveHeaderLocale({ headerLocale: "DE" })).toBe("de");
  });

  test("canonicalizes Accept-Language pick", () => {
    expect(resolveHeaderLocale({ acceptLanguage: "DE-at,en;q=0.8" })).toBe("de-AT");
  });
});
