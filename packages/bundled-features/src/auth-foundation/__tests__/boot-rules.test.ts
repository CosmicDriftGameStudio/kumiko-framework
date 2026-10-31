import { describe, expect, test } from "bun:test";
import { AUTH_FOUNDATION_BOOT_RULES } from "../boot-rules.ts";

const RULE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/;

describe("AUTH_FOUNDATION_BOOT_RULES", () => {
  const rules = Object.values(AUTH_FOUNDATION_BOOT_RULES);

  test("ids follow <area>/<kebab>, are unique and never unclassified", () => {
    const ids = rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(RULE_ID_PATTERN);
      expect(id.startsWith("unclassified/")).toBe(false);
    }
  });

  test("summary and fix are non-empty", () => {
    for (const rule of rules) {
      expect(rule.summary.trim()).not.toBe("");
      expect(rule.fix.trim()).not.toBe("");
    }
  });
});
