import { describe, expect, test } from "bun:test";
import { bootRuleDocLink } from "../boot-rule.ts";
import { FRAMEWORK_BOOT_RULE_TABLES, FRAMEWORK_BOOT_RULES } from "../boot-rules.ts";

const RULE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/;

describe("framework boot rule tables", () => {
  test("every table contributes its rules to the flat list", () => {
    const tableSize = FRAMEWORK_BOOT_RULE_TABLES.reduce(
      (sum, table) => sum + Object.keys(table).length,
      0,
    );
    expect(FRAMEWORK_BOOT_RULES).toHaveLength(tableSize);
    expect(tableSize).toBeGreaterThanOrEqual(39);
  });

  test("rule ids are unique", () => {
    const ids = FRAMEWORK_BOOT_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("rule ids follow <area>/<kebab> and are never unclassified", () => {
    for (const rule of FRAMEWORK_BOOT_RULES) {
      expect(rule.id).toMatch(RULE_ID_PATTERN);
      expect(rule.id.startsWith("unclassified/")).toBe(false);
    }
  });

  test("summary and fix are non-empty", () => {
    for (const rule of FRAMEWORK_BOOT_RULES) {
      expect(rule.summary.trim()).not.toBe("");
      expect(rule.fix.trim()).not.toBe("");
    }
  });

  test("doc anchors are unique", () => {
    const anchors = FRAMEWORK_BOOT_RULES.map((rule) => bootRuleDocLink(rule.id));
    expect(anchors.every((anchor) => anchor !== undefined)).toBe(true);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  test("bootRuleDocLink maps the slash to a dash and skips unclassified ids", () => {
    expect(bootRuleDocLink("pii/subject-key-sortable")).toBe(
      "agents/boot-rules.md#pii-subject-key-sortable",
    );
    expect(bootRuleDocLink("unclassified/validateNavs")).toBeUndefined();
  });
});
