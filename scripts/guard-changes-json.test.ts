import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findChangelogViolations } from "./guard-changes-json";

function buildFixtureRoot(features: readonly [relDir: string, entries: unknown][]): string {
  const root = mkdtempSync(join(tmpdir(), "changes-json-"));
  for (const [relDir, entries] of features) {
    const dir = join(root, "packages", relDir, "src");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "changes.json"), JSON.stringify(entries, null, 2));
  }
  return root;
}

describe("findChangelogViolations", () => {
  it("passes a clean fixture: descending order, breaking with migration", () => {
    const root = buildFixtureRoot([
      [
        "some-feature",
        [
          {
            version: "0.2.0",
            type: "breaking",
            title: "removed the old thing",
            migration: "use the new thing instead",
          },
          { version: "0.1.0", type: "improvement", title: "added the old thing" },
        ],
      ],
    ]);

    expect(findChangelogViolations(root)).toEqual([]);
  });

  it("flags entries that are not newest-version-first", () => {
    const root = buildFixtureRoot([
      [
        "some-feature",
        [
          { version: "0.1.0", type: "fix", title: "first" },
          { version: "0.2.0", type: "fix", title: "second" },
        ],
      ],
    ]);

    const violations = findChangelogViolations(root);
    expect(violations.length).toBe(1);
    expect(violations[0].detail).toContain("newest-version-first");
  });

  it("allows equal versions back to back", () => {
    const root = buildFixtureRoot([
      [
        "some-feature",
        [
          { version: "0.1.0", type: "fix", title: "first" },
          { version: "0.1.0", type: "improvement", title: "second" },
        ],
      ],
    ]);

    const violations = findChangelogViolations(root);
    expect(violations.some((v) => v.detail.includes("newest-version-first"))).toBe(false);
  });

  it("flags an entry silently dropped by parseFeatureChangelog for an invalid type", () => {
    const root = buildFixtureRoot([
      ["some-feature", [{ version: "0.1.0", type: "breakign", title: "typo type" }]],
    ]);

    const violations = findChangelogViolations(root);
    expect(violations.some((v) => v.detail.includes("silently dropped"))).toBe(true);
  });

  it("pins the dropped entry's index in a file that also has valid entries", () => {
    const root = buildFixtureRoot([
      [
        "some-feature",
        [
          { version: "0.3.0", type: "fix", title: "valid newest" },
          { version: "0.2.0", type: "brokn", title: "invalid type in the middle" },
          { version: "0.1.0", type: "improvement", title: "valid oldest" },
        ],
      ],
    ]);

    const violations = findChangelogViolations(root);
    const droppedViolations = violations.filter((v) => v.detail.includes("silently dropped"));
    expect(droppedViolations.length).toBe(1);
    expect(droppedViolations[0].detail).toContain("entry #1");
    expect(violations.some((v) => v.detail.includes("newest-version-first"))).toBe(false);
  });

  it("flags a breaking entry missing migration", () => {
    const root = buildFixtureRoot([
      ["some-feature", [{ version: "0.1.0", type: "breaking", title: "no migration field" }]],
    ]);

    const violations = findChangelogViolations(root);
    expect(violations.some((v) => v.detail.includes("migration"))).toBe(true);
  });

  it("flags a non-semver version and skips the sort check for that file", () => {
    const root = buildFixtureRoot([
      [
        "some-feature",
        [
          { version: "0.1", type: "fix", title: "not semver" },
          { version: "0.2.0", type: "fix", title: "valid semver but out of order" },
        ],
      ],
    ]);

    const violations = findChangelogViolations(root);
    expect(violations.some((v) => v.detail.includes("semver"))).toBe(true);
    expect(violations.some((v) => v.detail.includes("newest-version-first"))).toBe(false);
  });

  it("flags invalid JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "changes-json-"));
    const dir = join(root, "packages", "some-feature", "src");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "changes.json"), "{ not json");

    const violations = findChangelogViolations(root);
    expect(violations.some((v) => v.detail.includes("invalid JSON"))).toBe(true);
  });

  it("flags a repo with no changes.json at all", () => {
    const root = mkdtempSync(join(tmpdir(), "changes-json-"));

    const violations = findChangelogViolations(root);
    expect(violations.length).toBe(1);
    expect(violations[0].detail).toContain("no changes.json found");
  });

  it("passes the real repo", () => {
    expect(findChangelogViolations(join(import.meta.dir, ".."))).toEqual([]);
  });
});
