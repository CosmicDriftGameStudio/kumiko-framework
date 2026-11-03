import { describe, test } from "bun:test";
import { expectWellFormedBootRuleTable } from "@cosmicdrift/kumiko-framework/internal/testing";
import { DOCUMENT_INGEST_BOOT_RULES } from "../boot-rules.ts";

describe("DOCUMENT_INGEST_BOOT_RULES", () => {
  test("ids follow <area>/<kebab>, are unique and never unclassified, summary and fix are set", () => {
    expectWellFormedBootRuleTable(DOCUMENT_INGEST_BOOT_RULES);
  });
});
