import { describe, expect, test } from "bun:test";
import { parseStringArrayJson } from "../parse-string-array-json";

describe("parseStringArrayJson", () => {
  test("parses string array", () => {
    expect(parseStringArrayJson('["admin","editor"]')).toEqual(["admin", "editor"]);
  });

  test("returns fallback on invalid JSON", () => {
    expect(parseStringArrayJson("{bad", ["guest"])).toEqual(["guest"]);
  });

  test("returns fallback when JSON is not a string array", () => {
    expect(parseStringArrayJson("[1,2]", [])).toEqual([]);
  });
});
