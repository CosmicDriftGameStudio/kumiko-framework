import { describe, expect, test } from "bun:test";
import { apiDocsLocales, apiDocsTextsFor, formatApiDocsText } from "../texts/index.ts";
import { placeholdersOf } from "../texts/types.ts";

const english = apiDocsTextsFor("en");

function entries(texts: ReturnType<typeof apiDocsTextsFor>): [string, string][] {
  return [
    ...Object.entries(texts.text).map(([key, value]): [string, string] => [`text.${key}`, value]),
    ...Object.entries(texts.errorMeanings).map(([key, value]): [string, string] => [
      `error.${key}`,
      value,
    ]),
    ...Object.entries(texts.listParameters).map(([key, value]): [string, string] => [
      `list.${key}`,
      value,
    ]),
  ];
}

describe("api docs texts", () => {
  for (const locale of apiDocsLocales) {
    test(`${locale}: same keys and placeholders as en, no long dashes, no empty text`, () => {
      const own = entries(apiDocsTextsFor(locale));
      const base = entries(english);
      expect(own.map(([key]) => key)).toEqual(base.map(([key]) => key));
      for (const [index, [key, value]] of own.entries()) {
        expect(value.trim(), key).not.toBe("");
        expect(value, key).not.toMatch(/[—–]/);
        expect([...placeholdersOf(value)].sort(), key).toEqual(
          [...placeholdersOf(base[index]?.[1] ?? "")].sort(),
        );
      }
    });
  }

  test("formatApiDocsText fills placeholders and throws on a missing parameter", () => {
    expect(formatApiDocsText("{a} and {b}", { a: 1, b: "x" })).toBe("1 and x");
    expect(() => formatApiDocsText("{a} and {b}", { a: 1 })).toThrow('"b"');
    expect(formatApiDocsText("`{ type, payload }`")).toBe("`{ type, payload }`");
  });
});
