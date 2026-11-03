import { describe, test } from "bun:test";
import { expectWellFormedBootRuleTable } from "@cosmicdrift/kumiko-framework/internal/testing";
import { AUTH_FOUNDATION_BOOT_RULES } from "../boot-rules.ts";

describe("AUTH_FOUNDATION_BOOT_RULES", () => {
  test("ids follow <area>/<kebab>, are unique and never unclassified, summary and fix are set", () => {
    expectWellFormedBootRuleTable(AUTH_FOUNDATION_BOOT_RULES);
  });
});
