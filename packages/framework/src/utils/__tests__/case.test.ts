import { describe, expect, test } from "bun:test";
import { toSnakeCase } from "../case";

describe("toSnakeCase", () => {
  test("camelCase → snake_case", () => {
    expect(toSnakeCase("tenantMembership")).toBe("tenant_membership");
  });

  test("kebab-case → snake_case", () => {
    expect(toSnakeCase("billing-period")).toBe("billing_period");
  });

  test("single segment unchanged", () => {
    expect(toSnakeCase("users")).toBe("users");
  });
});
