import { describe, expect, test } from "bun:test";
import {
  canonicalizeLocaleTag,
  pickAcceptLanguage,
  rankAcceptLanguage,
  rankPreferredLocales,
  resolveHeaderLocale,
} from "../request-locale.ts";

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

describe("rankAcceptLanguage", () => {
  test("sorts by q descending, header order breaks ties", () => {
    expect(rankAcceptLanguage("en;q=0.8, it;q=0.9, fr, de;q=0.8")).toEqual([
      "fr",
      "it",
      "en",
      "de",
    ]);
  });

  test("drops q=0, malformed tags and unparsable q", () => {
    expect(rankAcceptLanguage("de;q=0, <script>, en;q=abc, es")).toEqual(["es"]);
  });

  test("empty or missing header yields no tags", () => {
    expect(rankAcceptLanguage(undefined)).toEqual([]);
    expect(rankAcceptLanguage("")).toEqual([]);
  });

  test("pickAcceptLanguage is the head of the ranking", () => {
    expect(pickAcceptLanguage("en;q=0.5, de")).toBe("de");
    expect(pickAcceptLanguage(undefined)).toBeUndefined();
  });
});

describe("rankPreferredLocales", () => {
  test("a valid ?lang= comes first, then Accept-Language by q", () => {
    expect(rankPreferredLocales({ queryLang: "fr", acceptLanguage: "it;q=0.9, en;q=0.8" })).toEqual(
      ["fr", "it", "en"],
    );
  });

  test("canonicalizes and dedupes across both sources", () => {
    expect(
      rankPreferredLocales({ queryLang: "DE-at", acceptLanguage: "de-AT, en, EN;q=0.5" }),
    ).toEqual(["de-AT", "en"]);
  });

  test("an invalid ?lang= is dropped", () => {
    expect(rankPreferredLocales({ queryLang: "<script>", acceptLanguage: "en" })).toEqual(["en"]);
  });

  test("no signal yields an empty list", () => {
    expect(rankPreferredLocales({ queryLang: null, acceptLanguage: null })).toEqual([]);
  });
});
