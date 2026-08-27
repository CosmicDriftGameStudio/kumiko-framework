import { describe, expect, test } from "bun:test";
import { canonicalizeLocaleTag, resolveHeaderLocale } from "../request-locale";

describe("canonicalizeLocaleTag", () => {
  test("lowercases the primary subtag", () => {
    expect(canonicalizeLocaleTag("DE")).toBe("de");
    expect(canonicalizeLocaleTag("DE-at")).toBe("de-at");
  });
});

describe("resolveHeaderLocale", () => {
  test("canonicalizes X-Locale", () => {
    expect(resolveHeaderLocale({ headerLocale: "DE" })).toBe("de");
  });

  test("canonicalizes Accept-Language pick", () => {
    expect(resolveHeaderLocale({ acceptLanguage: "DE-at,en;q=0.8" })).toBe("de-at");
  });
});
