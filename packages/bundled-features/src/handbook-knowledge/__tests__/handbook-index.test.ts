import { describe, expect, test } from "bun:test";
import { createHandbookIndex } from "../handbook-index.ts";

const page = (id: string, title: string) => ({
  id,
  kind: "screen" as const,
  title,
  questions: [],
  screens: [id],
  bodyMd: `${title} text`,
});

const knowledge = {
  defaultLocale: "de",
  locales: {
    de: [page("a", "Eins"), page("b", "Zwei")],
    en: [page("a", "One")],
  },
};

describe("createHandbookIndex", () => {
  test("rejects a file whose default locale has no pages", () => {
    expect(() => createHandbookIndex({ defaultLocale: "fr", locales: { de: [] } })).toThrow();
    expect(() => createHandbookIndex({ nonsense: true })).toThrow();
  });

  test("serves the base language of a regional locale", () => {
    const index = createHandbookIndex(knowledge);
    expect(index.findPage("en-GB", "a")?.page.title).toBe("One");
    expect(index.listPages("en-GB").locale).toBe("en");
  });

  test("falls back to the default language for unknown locales and for pages missing in a locale", () => {
    const index = createHandbookIndex(knowledge);
    expect(index.findPage("fr", "a")?.locale).toBe("de");
    expect(index.findPage("en", "b")).toMatchObject({ locale: "de", page: { title: "Zwei" } });
    expect(index.listPages("en").pages.map((entry) => entry.title)).toEqual(["One", "Zwei"]);
    expect(index.findPage("de", "missing")).toBeUndefined();
  });
});
