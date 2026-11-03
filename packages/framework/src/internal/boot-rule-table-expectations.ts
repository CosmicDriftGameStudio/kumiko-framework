// @runtime test
import { type BootRuleTable, bootRuleDocLink } from "../engine/boot-validator/boot-rule.ts";

const RULE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*\/[a-z0-9]+(-[a-z0-9]+)*$/;

function findDuplicates(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

export function bootRuleTableViolations(table: BootRuleTable): string[] {
  const rules = Object.values(table);
  const ids = rules.map((rule) => rule.id);
  const violations: string[] = [];
  for (const id of findDuplicates(ids)) violations.push(`duplicate id: ${id}`);
  for (const id of ids) {
    if (!RULE_ID_PATTERN.test(id)) violations.push(`id is not <area>/<kebab>: ${id}`);
    if (id.startsWith("unclassified/")) violations.push(`id is unclassified: ${id}`);
  }
  for (const anchor of findDuplicates(ids.flatMap((id) => bootRuleDocLink(id) ?? []))) {
    violations.push(`duplicate doc anchor: ${anchor}`);
  }
  for (const rule of rules) {
    if (rule.summary.trim() === "") violations.push(`empty summary: ${rule.id}`);
    if (rule.fix.trim() === "") violations.push(`empty fix: ${rule.id}`);
  }
  return violations;
}
