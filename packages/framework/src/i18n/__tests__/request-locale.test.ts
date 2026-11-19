import { describe, expect, test } from "bun:test";
import {
  canonicalizeLocaleTag,
  isValidLocaleTag,
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

describe("isValidLocaleTag", () => {
  test("accepts tags Intl can format with", () => {
    for (const tag of ["de", "de-DE", "zh-Hant-TW", "en-US-u-ca-gregory", "de-DE-x-foo"]) {
      expect(isValidLocaleTag(tag)).toBe(true);
    }
  });

  test("rejects well-shaped tags that Intl rejects", () => {
    for (const tag of ["en-a", "de-1", "en-u", "de-DE-DE", "en-x"]) {
      expect(isValidLocaleTag(tag)).toBe(false);
    }
  });
});

describe("resolveHeaderLocale", () => {
  test("canonicalizes X-Locale", () => {
    expect(resolveHeaderLocale({ headerLocale: "DE" })).toBe("de");
  });

  test("canonicalizes Accept-Language pick", () => {
    expect(resolveHeaderLocale({ acceptLanguage: "DE-at,en;q=0.8" })).toBe("de-AT");
  });

  test("an X-Locale Intl rejects falls through to Accept-Language", () => {
    expect(resolveHeaderLocale({ headerLocale: "en-a", acceptLanguage: "de-AT" })).toBe("de-AT");
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

  test("drops tags Intl rejects", () => {
    expect(rankAcceptLanguage("de-1, fr;q=0.5")).toEqual(["fr"]);
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
