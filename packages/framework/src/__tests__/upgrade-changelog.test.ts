import { describe, expect, test } from "bun:test";
import { syncResolvedManualStatuses } from "../upgrade-changelog.ts";

const CHANGELOG = [
  "# Changelog",
  "",
  "## [0.2.0] - 2024-02-01",
  "",
  "### Manual migrations",
  "",
  "- [open] id-a · 0.2.0 · first",
  "- [open] id-b · 0.2.0 · second",
  "",
  "## [0.1.0] - 2024-01-01",
  "",
  "### Manual migrations",
  "",
  "- [open] id-a · 0.1.0 · first again",
  "- [migrated] id-b · 0.1.0 · already done",
  "",
].join("\n");

describe("syncResolvedManualStatuses", () => {
  test("rewrites the matching id in every section and nothing else", () => {
    const result = syncResolvedManualStatuses(CHANGELOG, [{ id: "id-a", resolution: "migrated" }]);
    expect(result).toContain("- [migrated] id-a · 0.2.0 · first\n");
    expect(result).toContain("- [migrated] id-a · 0.1.0 · first again\n");
    expect(result).toContain("- [open] id-b · 0.2.0 · second\n");
    expect(result).toContain("- [migrated] id-b · 0.1.0 · already done\n");
  });

  test("records not-applicable", () => {
    const result = syncResolvedManualStatuses(CHANGELOG, [
      { id: "id-b", resolution: "not-applicable" },
    ]);
    expect(result).toContain("- [not-applicable] id-b · 0.2.0 · second\n");
    expect(result).toContain("- [open] id-a · 0.2.0 · first\n");
  });

  test("gives every id its own resolution", () => {
    const result = syncResolvedManualStatuses(CHANGELOG, [
      { id: "id-a", resolution: "migrated" },
      { id: "id-b", resolution: "not-applicable" },
    ]);
    expect(result).toContain("- [migrated] id-a · 0.2.0 · first\n");
    expect(result).toContain("- [not-applicable] id-b · 0.2.0 · second\n");
    expect(result).toContain("- [migrated] id-a · 0.1.0 · first again\n");
  });

  test("matches ids literally, not as a pattern", () => {
    expect(syncResolvedManualStatuses(CHANGELOG, [{ id: "id-.", resolution: "migrated" }])).toBe(
      CHANGELOG,
    );
  });
});
