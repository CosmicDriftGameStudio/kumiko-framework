import { describe, expect, test } from "bun:test";
import { type ChangelogEntry, compareVersions, filterEntriesAfter } from "../feature-changelog";

const CANARY_EARLY = "0.425.0-next-20261118090000-abc1234";
const CANARY_LATE = "0.425.0-next-20261118143000-0f00ba1";

describe("compareVersions", () => {
  test("a canary sorts after the previous release and before its own release", () => {
    expect(compareVersions(CANARY_EARLY, "0.424.1")).toBe(1);
    expect(compareVersions(CANARY_EARLY, "0.425.0")).toBe(-1);
    expect(compareVersions("0.425.0", CANARY_EARLY)).toBe(1);
  });

  test("two canaries of the same target order by their timestamp, not their sha", () => {
    expect(compareVersions(CANARY_EARLY, CANARY_LATE)).toBe(-1);
    expect(compareVersions(CANARY_LATE, CANARY_EARLY)).toBe(1);
    expect(compareVersions(CANARY_LATE, CANARY_LATE)).toBe(0);
  });

  test("follows semver precedence for numeric and dotted prerelease identifiers", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    ordered.slice(1).forEach((higher, index) => {
      expect(compareVersions(ordered[index] ?? "", higher)).toBe(-1);
    });
  });

  test("agrees with Bun.semver.order and ignores build metadata", () => {
    const versions = [
      "0.9.0",
      "0.10.0",
      "0.425.0",
      "0.425.1",
      CANARY_EARLY,
      CANARY_LATE,
      "1.0.0-rc.1",
      "1.0.0+build.5",
    ];
    for (const a of versions) {
      for (const b of versions) expect(compareVersions(a, b)).toBe(Bun.semver.order(a, b));
    }
  });

  test("a canary does not hide the entries of the release it previews", () => {
    const entries: ChangelogEntry[] = [
      { version: "0.424.1", type: "fix", title: "old" },
      { version: "0.425.0", type: "fix", title: "new" },
    ];
    expect(filterEntriesAfter(entries, "0.424.1").map((entry) => entry.title)).toEqual(["new"]);
    expect(filterEntriesAfter(entries, CANARY_EARLY).map((entry) => entry.title)).toEqual(["new"]);
  });
});
