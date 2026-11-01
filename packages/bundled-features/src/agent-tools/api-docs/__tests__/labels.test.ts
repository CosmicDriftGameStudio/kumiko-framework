import { describe, expect, test } from "bun:test";
import { findDescriptionTranslationGaps } from "../../agent-doc-lint.ts";
import { localizedLabels, localizedLabelsForSuffix } from "../../labels.ts";

const translations = {
  "owner:pat.create.title": { en: "Create" },
  "locale-de:pat.create.title": { de: "Erstellen" },
  "locale-de:owner:pat.create.title": { de: "Voll qualifiziert" },
  "locale-es:pat.create.title": { es: "Crear", de: "nicht de" },
  "owner:entity:ticket:field:title": { en: "Title" },
  "locale-de:owner:entity:ticket:field:title": { de: "Titel" },
};

describe("localizedLabels", () => {
  test("owner entry wins, locale packages complete the other locales in code-point order", () => {
    expect(localizedLabels(translations, "owner:pat.create.title")).toEqual({
      en: "Create",
      de: "Voll qualifiziert",
      es: "Crear",
    });
  });

  test("a key without owner entry is served by the locale packages alone", () => {
    expect(localizedLabels(translations, "other:pat.create.title")).toEqual({
      de: "Erstellen",
      es: "Crear",
    });
  });

  test("suffix lookups complete the owner key with the locale package", () => {
    expect(localizedLabelsForSuffix(translations, ":entity:ticket:field:title")).toEqual({
      en: "Title",
      de: "Titel",
    });
  });

  test("an unknown suffix yields no labels", () => {
    expect(localizedLabelsForSuffix(translations, ":nope")).toEqual({});
  });
});

describe("findDescriptionTranslationGaps with locale packages", () => {
  const registry = {
    getAllTranslations: () => ({
      "shop:write:order:create:description": { en: "Creates an order." },
      "locale-de:shop:write:order:create:description": { de: "Legt eine Bestellung an." },
    }),
  };

  test("a translation from a locale package counts as present", () => {
    const gaps = findDescriptionTranslationGaps(registry, {
      handlerQns: ["shop:write:order:create"],
      locales: ["en", "de", "fr"],
    });
    expect(gaps.map((gap) => gap.locale)).toEqual(["fr"]);
  });
});
