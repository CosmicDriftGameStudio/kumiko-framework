import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findExpiringSoon,
  isExceptionValid,
  loadExceptionEntries,
  matchesPackageName,
} from "../_lib/dependency-exceptions";

const FILENAME = "dependency-test-exceptions.json";
type TestException = { package: string; reason: string };

const tempDirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "dependency-exceptions-"));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function writeExceptions(dir: string, exceptions: unknown): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, FILENAME), JSON.stringify({ exceptions }), "utf-8");
}

function load(roots: string[], bundledDir: string): TestException[] {
  return loadExceptionEntries<TestException>({
    filename: FILENAME,
    roots,
    parse: (field) => ({ package: field("package"), reason: field("reason") }),
    bundledDir,
  });
}

describe("loadExceptionEntries", () => {
  test("merges the bundled defaults with the repo root file", () => {
    const bundled = tempDir();
    const repo = tempDir();
    writeExceptions(bundled, [{ package: "bundled-pkg", reason: "default" }]);
    writeExceptions(repo, [{ package: "repo-pkg", reason: "repo" }]);
    expect(load([repo], bundled).map((e) => e.package)).toEqual(["bundled-pkg", "repo-pkg"]);
  });

  test("a missing repo file leaves the bundled defaults alone", () => {
    const bundled = tempDir();
    writeExceptions(bundled, [{ package: "bundled-pkg", reason: "default" }]);
    expect(load([tempDir()], bundled)).toHaveLength(1);
  });

  test("entries from several roots are all kept", () => {
    const bundled = tempDir();
    const repo = tempDir();
    const ancestor = tempDir();
    writeExceptions(repo, [{ package: "a", reason: "r" }]);
    writeExceptions(ancestor, [{ package: "b", reason: "r" }]);
    expect(load([repo, ancestor], bundled).map((e) => e.package)).toEqual(["a", "b"]);
  });

  test("an entry missing a required field is dropped, its siblings survive", () => {
    const bundled = tempDir();
    const repo = tempDir();
    writeExceptions(repo, [{ package: "no-reason" }, { package: "ok", reason: "r" }, "junk"]);
    expect(load([repo], bundled).map((e) => e.package)).toEqual(["ok"]);
  });

  test("a blank required field counts as missing", () => {
    const repo = tempDir();
    writeExceptions(repo, [{ package: "x", reason: "  " }]);
    expect(load([repo], tempDir())).toEqual([]);
  });

  test("an unreadable file is ignored without hiding the other sources", () => {
    const bundled = tempDir();
    const repo = tempDir();
    writeExceptions(bundled, [{ package: "bundled-pkg", reason: "default" }]);
    writeFileSync(join(repo, FILENAME), "{ not json", "utf-8");
    expect(load([repo], bundled).map((e) => e.package)).toEqual(["bundled-pkg"]);
  });
});

describe("isExceptionValid", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");

  test("expires yesterday is expired", () => {
    expect(isExceptionValid("2026-10-15", now)).toEqual({ valid: false, expired: true });
  });

  test("expires today holds through the end of the day", () => {
    expect(isExceptionValid("2026-10-16", now)).toEqual({ valid: true, expired: false });
  });

  test("an unparsable date is invalid but not expired", () => {
    expect(isExceptionValid("soon", now)).toEqual({ valid: false, expired: false });
  });

  test("no expiry is valid", () => {
    expect(isExceptionValid(undefined, now).valid).toBe(true);
  });
});

describe("findExpiringSoon", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");

  test("flags only exceptions inside the window that have not expired yet", () => {
    const items = [
      { id: "expired", expires: "2026-10-01" },
      { id: "in-10-days", expires: "2026-10-26" },
      { id: "in-20-days", expires: "2026-11-05" },
      { id: "in-90-days", expires: "2027-01-14" },
    ];
    expect(findExpiringSoon(items, 14, now).map((i) => i.id)).toEqual(["in-10-days"]);
    expect(findExpiringSoon(items, 30, now).map((i) => i.id)).toEqual(["in-10-days", "in-20-days"]);
  });
});

describe("matchesPackageName", () => {
  test("exact and trailing-wildcard matches only", () => {
    expect(matchesPackageName("lightningcss-*", "lightningcss-darwin-arm64")).toBe(true);
    expect(matchesPackageName("lightningcss", "lightningcss-darwin-arm64")).toBe(false);
    expect(matchesPackageName("*", "anything")).toBe(false);
  });
});
