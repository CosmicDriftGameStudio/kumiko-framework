import { describe, expect, test } from "bun:test";
import { documentDesignerTranslations } from "../i18n.ts";

const SHIPPED_LOCALES = ["en", "de", "es"] as const;

function placeholdersOf(text: string): readonly string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").toSorted();
}

describe("document designer client translations", () => {
  const english = documentDesignerTranslations["en"] ?? {};

  test.each(SHIPPED_LOCALES)("%s carries exactly the en keys", (locale) => {
    const bundle = documentDesignerTranslations[locale] ?? {};
    expect(Object.keys(bundle).toSorted()).toEqual(Object.keys(english).toSorted());
  });

  test.each(SHIPPED_LOCALES)("%s keeps every placeholder of the en text", (locale) => {
    const bundle = documentDesignerTranslations[locale] ?? {};
    for (const [key, text] of Object.entries(english)) {
      expect({ key, placeholders: placeholdersOf(bundle[key] ?? "") }).toEqual({
        key,
        placeholders: placeholdersOf(text),
      });
    }
  });
});
