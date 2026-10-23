import { describe, expect, test } from "bun:test";
import { describeRowLevelSecurityDifference } from "../queries/rls-catalog.ts";

const policy = {
  name: "p",
  command: "ALL" as const,
  kind: "PERMISSIVE" as const,
  rolesSql: "PUBLIC",
  using: "(a = 1)",
};

const expected = { enabled: true, forced: true, policies: [policy] };

describe("describeRowLevelSecurityDifference", () => {
  test("equal states have no difference", () => {
    expect(describeRowLevelSecurityDifference(expected, structuredClone(expected))).toBeUndefined();
  });

  test("a missing table is reported", () => {
    expect(describeRowLevelSecurityDifference(expected, undefined)).toBe("table missing");
  });

  test("a different flag is reported", () => {
    expect(describeRowLevelSecurityDifference(expected, { ...expected, forced: false })).toBe(
      "forced true -> false",
    );
  });

  test("a missing policy is reported", () => {
    expect(describeRowLevelSecurityDifference(expected, { ...expected, policies: [] })).toBe(
      "policy p missing",
    );
  });

  test("a different expression is reported", () => {
    expect(
      describeRowLevelSecurityDifference(expected, {
        ...expected,
        policies: [{ ...policy, using: "(a = 2)" }],
      }),
    ).toBe("policy p differs in using");
  });

  test("an extra policy is reported", () => {
    expect(
      describeRowLevelSecurityDifference(expected, {
        ...expected,
        policies: [policy, { ...policy, name: "extra" }],
      }),
    ).toBe("unexpected policy extra");
  });
});
