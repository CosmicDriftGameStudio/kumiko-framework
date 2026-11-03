import { describe, expect, test } from "bun:test";
import { bootRuleTableViolations } from "../../../internal/testing.ts";
import { bootRuleDocLink } from "../boot-rule.ts";
import { FRAMEWORK_BOOT_RULE_TABLES, FRAMEWORK_BOOT_RULES } from "../boot-rules.ts";

describe("framework boot rule tables", () => {
  test("every table contributes its rules to the flat list", () => {
    const tableSize = FRAMEWORK_BOOT_RULE_TABLES.reduce(
      (sum, table) => sum + Object.keys(table).length,
      0,
    );
    expect(FRAMEWORK_BOOT_RULES).toHaveLength(tableSize);
    expect(tableSize).toBeGreaterThanOrEqual(153);
  });

  test("the flat list is well formed", () => {
    expect(
      bootRuleTableViolations(Object.fromEntries(FRAMEWORK_BOOT_RULES.map((r) => [r.id, r]))),
    ).toEqual([]);
  });

  test("bootRuleDocLink maps the slash to a dash and skips unclassified ids", () => {
    expect(bootRuleDocLink("pii/subject-key-sortable")).toBe(
      "agents/boot-rules.md#pii-subject-key-sortable",
    );
    expect(bootRuleDocLink("unclassified/validateNavs")).toBeUndefined();
  });
});
