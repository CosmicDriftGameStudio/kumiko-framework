import { describe, expect, test } from "bun:test";
import { rolesInputSchema } from "../roles-input-schema";

describe("rolesInputSchema", () => {
  test("accepts string[]", () => {
    expect(rolesInputSchema.parse(["SystemAdmin"])).toEqual(["SystemAdmin"]);
  });

  test("accepts JSON-encoded string[]", () => {
    expect(rolesInputSchema.parse(JSON.stringify(["SystemAdmin"]))).toEqual(["SystemAdmin"]);
  });

  test("rejects bare role name that would silently clear via parseRoles", () => {
    expect(() => rolesInputSchema.parse("SystemAdmin")).toThrow();
  });

  test("accepts empty JSON array", () => {
    expect(rolesInputSchema.parse("[]")).toEqual([]);
  });
});
