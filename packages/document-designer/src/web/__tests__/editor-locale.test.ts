import { describe, expect, test } from "bun:test";
import { defaultLocaleOf } from "../editor-locale.ts";

describe("defaultLocaleOf", () => {
  test("the UI language wins when the template has it, even if the app lists it second", () => {
    expect(defaultLocaleOf("de-DE", ["en", "de"], ["en", "de"])).toBe("de");
    expect(defaultLocaleOf("de", ["en", "de"], ["en", "de"])).toBe("de");
  });

  test("a template without versions opens in the UI language when the app offers it", () => {
    expect(defaultLocaleOf("de", ["en", "de"], [])).toBe("de");
    expect(defaultLocaleOf("fr", ["en", "de"], [])).toBe("en");
  });

  test("a UI language the template lacks falls back to the app's first language, then any version", () => {
    expect(defaultLocaleOf("de", ["en", "de"], ["en"])).toBe("en");
    expect(defaultLocaleOf("fr", ["en"], ["es"])).toBe("es");
  });
});
