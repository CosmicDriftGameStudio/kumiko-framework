import { describe, expect, test } from "bun:test";
import { parseSchemaRowLevelSecurity } from "../shared.ts";

const SCHEMA_FILE = "/app/kumiko/schema.ts";

describe("parseSchemaRowLevelSecurity", () => {
  test("an absent export means off", () => {
    expect(parseSchemaRowLevelSecurity(undefined, SCHEMA_FILE)).toBe("off");
  });

  test.each(["on", "off"] as const)("accepts %s", (mode) => {
    expect(parseSchemaRowLevelSecurity(mode, SCHEMA_FILE)).toBe(mode);
  });

  test.each([["ON"], [true], [null], ["enforce"]])(
    "rejects %p instead of silently switching tenant isolation off",
    (value) => {
      expect(() => parseSchemaRowLevelSecurity(value, SCHEMA_FILE)).toThrow(
        /ROW_LEVEL_SECURITY must be one of off, on/,
      );
    },
  );
});
