import { describe, expect, test } from "bun:test";
import { Project } from "ts-morph";
import { checkI18nKeys } from "../guard-i18n-keys";

function featureFile(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("/repo/src/features/greeting/feature.ts", code);
}

const expectedLocalesForRoot = () => new Set(["de", "en"]);

describe("guard-i18n-keys — plural entries", () => {
  test("accepts a plural object as a locale value without a false positive", () => {
    const sf = featureFile(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      export const greetingFeature = defineFeature("greeting", (r) => {
        r.translations({
          keys: {
            "greeting.count": {
              de: { one: "Ein Eintrag", other: "{count} Einträge" },
              en: "entries",
            },
          },
        });
        t("greeting:greeting.count");
      });
    `);
    const outcome = checkI18nKeys([sf], { expectedLocalesForRoot });
    expect(outcome.violations).toHaveLength(0);
  });

  test("still flags a missing locale when the plural entry lacks one", () => {
    const sf = featureFile(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      export const greetingFeature = defineFeature("greeting", (r) => {
        r.translations({
          keys: {
            "greeting.count": {
              de: { one: "Ein Eintrag", other: "{count} Einträge" },
            },
          },
        });
      });
    `);
    const outcome = checkI18nKeys([sf], { expectedLocalesForRoot });
    expect(outcome.violations).toHaveLength(1);
    expect(outcome.violations[0]?.message).toContain("missing locale: en");
  });

  test("matches a used key and a defined key that spell the same text with different escapes", () => {
    const sf = featureFile(`
      import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
      export const greetingFeature = defineFeature("greeting", (r) => {
        r.translations({
          keys: {
            "greeting.it's": { de: "x", en: "y" },
          },
        });
        t('greeting:greeting.it\\'s');
      });
    `);
    const outcome = checkI18nKeys([sf], { expectedLocalesForRoot });
    expect(outcome.violations).toHaveLength(0);
  });
});
