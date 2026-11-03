import { describe, test } from "bun:test";
import { expectWellFormedBootRuleTable } from "@cosmicdrift/kumiko-framework/internal/testing";
import { USER_DATA_RIGHTS_BOOT_RULES } from "../boot-rules.ts";

describe("USER_DATA_RIGHTS_BOOT_RULES", () => {
  test("ids follow <area>/<kebab>, are unique and never unclassified, summary and fix are set", () => {
    expectWellFormedBootRuleTable(USER_DATA_RIGHTS_BOOT_RULES);
  });
});
