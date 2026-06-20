import { describe, expect, test } from "bun:test";
import { parseRoles } from "../serialization";

describe("parseRoles", () => {
  test("returns an array input unchanged", () => {
    expect(parseRoles(["Admin", "Viewer"])).toEqual(["Admin", "Viewer"]);
  });

  test("parses a JSON-string array", () => {
    expect(parseRoles('["Admin","Viewer"]')).toEqual(["Admin", "Viewer"]);
  });

  test("falls back to [] for a malformed JSON string", () => {
    expect(parseRoles("not json")).toEqual([]);
    expect(parseRoles("")).toEqual([]);
  });

  test("falls back to [] for non-string / non-array inputs", () => {
    expect(parseRoles(null)).toEqual([]);
    expect(parseRoles(undefined)).toEqual([]);
    expect(parseRoles(42)).toEqual([]);
    expect(parseRoles({ roles: ["Admin"] })).toEqual([]);
  });
});
