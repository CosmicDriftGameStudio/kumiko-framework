import { describe, expect, test } from "bun:test";
import { bootRuleViolationOf } from "../../shared/__tests__/boot-rule-violation-of.ts";
import { createNotesHistoryFeature } from "../feature.ts";

describe("notes-history boot rules", () => {
  test("an empty parents allowlist violates empty-parents-allowlist", () => {
    const error = bootRuleViolationOf(() => createNotesHistoryFeature({ parents: [] }));
    expect(error.rule.id).toBe("notes-history/empty-parents-allowlist");
    expect(error.message).toContain("parents must not be an empty array");
  });

  test("a where rule in ownership.write violates where-rule-in-ownership-write", () => {
    const error = bootRuleViolationOf(() =>
      createNotesHistoryFeature({
        ownership: {
          write: { TenantMember: { kind: "where", where: () => ({ sqlText: "1=1", params: [] }) } },
        },
      }),
    );
    expect(error.rule.id).toBe("shared/where-rule-in-ownership-write");
    expect(error.message).toContain("ownership.write must not contain a");
  });
});
