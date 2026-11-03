// @runtime test
import { expect } from "bun:test";
import { type BootRuleTable, bootRuleDocLink } from "../engine/boot-validator/boot-rule.ts";

const RULE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/;

export function expectWellFormedBootRuleTable(table: BootRuleTable): void {
  const rules = Object.values(table);
  const ids = rules.map((rule) => rule.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) {
    expect(id).toMatch(RULE_ID_PATTERN);
    expect(id.startsWith("unclassified/")).toBe(false);
  }
  const anchors = ids.map((id) => bootRuleDocLink(id));
  expect(new Set(anchors).size).toBe(anchors.length);
  for (const rule of rules) {
    expect(rule.summary.trim()).not.toBe("");
    expect(rule.fix.trim()).not.toBe("");
  }
}
