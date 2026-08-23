import { describe, expect, test } from "bun:test";
import { sessionTimezoneField } from "./session-timezone-field";

describe("sessionTimezoneField", () => {
  test("set timezone → { timezone }", () => {
    expect(sessionTimezoneField("Europe/Berlin")).toEqual({ timezone: "Europe/Berlin" });
  });

  test("null timezone → empty object", () => {
    expect(sessionTimezoneField(null)).toEqual({});
  });

  test("undefined timezone → empty object", () => {
    expect(sessionTimezoneField(undefined)).toEqual({});
  });
});
