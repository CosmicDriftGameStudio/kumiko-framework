import { describe, expect, test } from "bun:test";
import { sessionLocaleField } from "./session-locale-field";

describe("sessionLocaleField", () => {
  test("set locale → { locale }", () => {
    expect(sessionLocaleField("de-DE")).toEqual({ locale: "de-DE" });
  });

  test("canonicalizes primary subtag", () => {
    expect(sessionLocaleField("DE")).toEqual({ locale: "de" });
    expect(sessionLocaleField("DE-at")).toEqual({ locale: "de-at" });
  });

  test("rejects malformed locale tags", () => {
    expect(sessionLocaleField('"><img sr')).toEqual({});
  });

  test("null locale → empty object", () => {
    expect(sessionLocaleField(null)).toEqual({});
  });

  test("undefined locale → empty object", () => {
    expect(sessionLocaleField(undefined)).toEqual({});
  });
});
