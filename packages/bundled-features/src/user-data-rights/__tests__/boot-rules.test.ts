import { describe, expect, test } from "bun:test";
import { bootRuleDocLink } from "@cosmicdrift/kumiko-framework/engine";
import { USER_DATA_RIGHTS_BOOT_RULES } from "../boot-rules.ts";

const RULE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/;

describe("USER_DATA_RIGHTS_BOOT_RULES", () => {
  const rules = Object.values(USER_DATA_RIGHTS_BOOT_RULES);

  test("ids follow <area>/<kebab>, are unique and never unclassified", () => {
    const ids = rules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(RULE_ID_PATTERN);
      expect(id.startsWith("unclassified/")).toBe(false);
    }
  });

  test("summary and fix are non-empty and every id has a doc anchor", () => {
    for (const rule of rules) {
      expect(rule.summary.trim()).not.toBe("");
      expect(rule.fix.trim()).not.toBe("");
      expect(bootRuleDocLink(rule.id)).toBeString();
    }
  });
});
