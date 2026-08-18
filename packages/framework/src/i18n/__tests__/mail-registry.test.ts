import { describe, expect, test } from "bun:test";
import { hasMailTranslations, mailT, registerMailTranslations } from "../mail-registry";

describe("mail-registry", () => {
  registerMailTranslations("en", { "test.hi": "Hello {name}" });

  test("falls back to English when locale is missing", () => {
    expect(mailT("fr", "test.hi", { name: "Ada" })).toBe("Hello Ada");
  });

  test("registered locale wins", () => {
    registerMailTranslations("de", { "test.hi": "Hallo {name}" });
    expect(mailT("de", "test.hi", { name: "Ada" })).toBe("Hallo Ada");
  });
});

test("hasMailTranslations is true only for registered locales", () => {
  expect(hasMailTranslations("en")).toBe(true);
  expect(hasMailTranslations("fr")).toBe(false);
  registerMailTranslations("de", { "test.hi": "Hallo {name}" });
  expect(hasMailTranslations("de")).toBe(true);
  expect(hasMailTranslations("de-AT")).toBe(true);
});
