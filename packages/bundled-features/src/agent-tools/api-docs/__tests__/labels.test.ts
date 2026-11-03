import { describe, expect, test } from "bun:test";
import { findDescriptionTranslationGaps } from "../../agent-doc-lint.ts";
import { entityFieldLabels, localizedLabels, localizedLabelsForSuffix } from "../../labels.ts";

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

  test("a key that merely ends with the suffix text is not taken for the owner", () => {
    const keys = {
      "foo:xentity:ticket:field:title": { en: "Wrong" },
      "owner:entity:ticket:field:title": { en: "Right" },
    };
    expect(localizedLabelsForSuffix(keys, "entity:ticket:field:title")).toEqual({ en: "Right" });
  });

  test("an entity name used by two features resolves to the handler's own feature", () => {
    const keys = {
      "a:entity:ticket:field:title": { en: "From a" },
      "b:entity:ticket:field:title": { en: "From b" },
    };
    expect(entityFieldLabels(keys, "ticket", "title")).toEqual({ en: "From a" });
    expect(entityFieldLabels(keys, "ticket", "title", "b")).toEqual({ en: "From b" });
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

describe("findDescriptionTranslationGaps with an empty translation", () => {
  test("an empty string counts as missing, like the generator's fallback to en", () => {
    const registry = {
      getAllTranslations: () => ({
        "shop:write:order:create:description": { en: "Creates.", de: "" },
      }),
    };
    const gaps = findDescriptionTranslationGaps(registry, {
      handlerQns: ["shop:write:order:create"],
      locales: ["en", "de"],
    });
    expect(gaps.map((gap) => gap.locale)).toEqual(["de"]);
  });
});
