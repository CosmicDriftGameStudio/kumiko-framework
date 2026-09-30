import { describe, expect, test } from "bun:test";
import { resolveTranslationValue, translationValueOtherText } from "../plural.js";

const messageCount = {
  de: { one: "{count} ungelesene Nachricht", other: "{count} ungelesene Nachrichten" },
  en: { one: "{count} unread message", other: "{count} unread messages" },
  pl: {
    one: "{count} nieprzeczytana wiadomość",
    few: "{count} nieprzeczytane wiadomości",
    many: "{count} nieprzeczytanych wiadomości",
    other: "{count} nieprzeczytanej wiadomości",
  },
} as const;

describe("resolveTranslationValue — plain strings", () => {
  test("interpolates {name} placeholders", () => {
    expect(resolveTranslationValue("Hello, {name}!", "en", { name: "Ada" })).toBe("Hello, Ada!");
  });

  test("leaves an unknown placeholder untouched", () => {
    expect(resolveTranslationValue("Hello, {name}!", "en")).toBe("Hello, {name}!");
  });
});

describe("resolveTranslationValue — plural forms", () => {
  test("en: singular vs plural", () => {
    expect(resolveTranslationValue(messageCount.en, "en", { count: 1 })).toBe("1 unread message");
    expect(resolveTranslationValue(messageCount.en, "en", { count: 0 })).toBe("0 unread messages");
    expect(resolveTranslationValue(messageCount.en, "en", { count: 2 })).toBe("2 unread messages");
    expect(resolveTranslationValue(messageCount.en, "en", { count: 5 })).toBe("5 unread messages");
    expect(resolveTranslationValue(messageCount.en, "en", { count: 21 })).toBe(
      "21 unread messages",
    );
  });

  test("de: singular vs plural", () => {
    expect(resolveTranslationValue(messageCount.de, "de", { count: 1 })).toBe(
      "1 ungelesene Nachricht",
    );
    expect(resolveTranslationValue(messageCount.de, "de", { count: 5 })).toBe(
      "5 ungelesene Nachrichten",
    );
  });

  test("pl: one/few/many CLDR categories", () => {
    expect(resolveTranslationValue(messageCount.pl, "pl", { count: 1 })).toBe(
      "1 nieprzeczytana wiadomość",
    );
    expect(resolveTranslationValue(messageCount.pl, "pl", { count: 2 })).toBe(
      "2 nieprzeczytane wiadomości",
    );
    expect(resolveTranslationValue(messageCount.pl, "pl", { count: 5 })).toBe(
      "5 nieprzeczytanych wiadomości",
    );
    expect(resolveTranslationValue(messageCount.pl, "pl", { count: 21 })).toBe(
      "21 nieprzeczytanych wiadomości",
    );
    expect(resolveTranslationValue(messageCount.pl, "pl", { count: 22 })).toBe(
      "22 nieprzeczytane wiadomości",
    );
  });

  test("a formal BCP-47 subtag still resolves plural categories (renderer's <locale>-x-formal tier)", () => {
    expect(resolveTranslationValue(messageCount.pl, "pl-x-formal", { count: 2 })).toBe(
      "2 nieprzeczytane wiadomości",
    );
  });

  test("falls back to `other` when the selected category has no form", () => {
    const partial = { one: "one item", other: "{count} items" };
    // pl "5" selects "many", which `partial` doesn't define.
    expect(resolveTranslationValue(partial, "pl", { count: 5 })).toBe("5 items");
  });

  test("falls back to `other` when count is missing", () => {
    expect(resolveTranslationValue(messageCount.en, "en")).toBe("{count} unread messages");
  });

  test("falls back to `other` when count is not a finite number", () => {
    expect(resolveTranslationValue(messageCount.en, "en", { count: "many" })).toBe(
      "many unread messages",
    );
    // count is present (interpolated verbatim) but non-finite, so the plural
    // category still falls back to `other`.
    expect(resolveTranslationValue(messageCount.en, "en", { count: Number.NaN })).toBe(
      "NaN unread messages",
    );
  });

  test("an invalid locale tag falls back to `other` without throwing", () => {
    expect(() =>
      resolveTranslationValue(messageCount.en, "not-a-locale-!!", { count: 1 }),
    ).not.toThrow();
    expect(resolveTranslationValue(messageCount.en, "not-a-locale-!!", { count: 1 })).toBe(
      "1 unread messages",
    );
  });
});

describe("translationValueOtherText", () => {
  test("returns a plain string as-is", () => {
    expect(translationValueOtherText("Welcome")).toBe("Welcome");
  });

  test("returns the `other` form for a plural entry", () => {
    expect(translationValueOtherText(messageCount.en)).toBe("{count} unread messages");
  });
});
