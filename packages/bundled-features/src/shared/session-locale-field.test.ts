import { describe, expect, test } from "bun:test";
import { sessionLocaleField } from "./session-locale-field";

describe("sessionLocaleField", () => {
  test("set locale → { locale }", () => {
    expect(sessionLocaleField("de-DE")).toEqual({ locale: "de-DE" });
  });

  test("null locale → empty object", () => {
    expect(sessionLocaleField(null)).toEqual({});
  });

  test("undefined locale → empty object", () => {
    expect(sessionLocaleField(undefined)).toEqual({});
  });
});
