import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  acquireCheckLock,
  checkLockPaths,
  followCheck,
  parseCliScope,
} from "../check-lock";
import { resolveCheckWorkContext } from "../check-work-context";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kumiko-check-lock-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("checkLockPaths", () => {
  test("different scopes produce disjoint lock/log/result paths", () => {
    const base = tempDir();
    const a = checkLockPaths("kumiko-framework", base);
    const b = checkLockPaths("kumiko-enterprise", base);
    expect(a.lockDir).not.toBe(b.lockDir);
    expect(a.logPath).not.toBe(b.logPath);
    expect(a.resultPath).not.toBe(b.resultPath);
  });

  test("accepts a plain repo-name scope", () => {
    const base = tempDir();
    expect(() => checkLockPaths("kumiko-framework", base)).not.toThrow();
  });

  test("accepts an undefined scope (no suffix)", () => {
    const base = tempDir();
    const paths = checkLockPaths(undefined, base);
    expect(paths.lockDir).toBe(join(base, ".kumiko-check.lock"));
    expect(paths.logPath).toBe(join(base, ".kumiko-check.log"));
    expect(paths.resultPath).toBe(join(base, ".kumiko-check.result"));
  });

  test("rejects a scope that path-traverses out of baseDir", () => {
    const base = tempDir();
    expect(() => checkLockPaths("../evil", base)).toThrow();
  });

  test("list scopes (comma, whitespace, any order) share one lock", () => {
    const base = tempDir();
    const comma = checkLockPaths("kumiko-framework,solon", base);
    const reversed = checkLockPaths("solon kumiko-framework", base);
    const duplicated = checkLockPaths("solon, kumiko-framework,solon", base);
    expect(comma.lockDir).toBe(join(base, ".kumiko-check.lock.kumiko-framework__solon"));
    expect(reversed.lockDir).toBe(comma.lockDir);
    expect(duplicated.lockDir).toBe(comma.lockDir);
  });

  test("rejects a list scope containing an unsafe entry", () => {
    expect(() => checkLockPaths("solon,../evil")).toThrow();
    expect(() => checkLockPaths("solon,..")).toThrow();
  });

  test("rejects a scope that is exactly '..'", () => {
    const base = tempDir();
    expect(() => checkLockPaths("..", base)).toThrow();
  });
});

describe("acquireCheckLock / followCheck: scope isolation (infra#722)", () => {
  // Reproduces the pre-push hook's real setup: it cd's into the SAME parent
  // workspace for every sub-repo before running `kumiko check`, only
  // KUMIKO_CLI_SCOPE differs between a concurrent push from repo A vs repo
  // B. Without scope in the lock/log/result names, B's `acquireCheckLock`
  // would collide with A's still-held lock, forcing B onto `followCheck`
  // and making it adopt A's scope and exit code.
  test("a concurrent check for a different scope gets its own lock, not blocked by another repo's in-flight run", () => {
    const base = tempDir();
    const a = checkLockPaths("kumiko-framework", base);
    const b = checkLockPaths("kumiko-enterprise", base);

    // repo A's push holds the lock — its check is still running.
    expect(acquireCheckLock(a.lockDir, a.logPath, a.resultPath)).toBe(true);

    // repo B pushes concurrently with a DIFFERENT scope while A's lock is
    // still held. It must get its own lock instead of losing the race.
    expect(acquireCheckLock(b.lockDir, b.logPath, b.resultPath)).toBe(true);
  });

  test("a second check for the SAME scope is deduplicated while the holder lives", () => {
    const base = tempDir();
    const first = checkLockPaths("kumiko-framework", base);
    const second = checkLockPaths("kumiko-framework", base);

    expect(acquireCheckLock(first.lockDir, first.logPath, first.resultPath)).toBe(true);
    expect(acquireCheckLock(second.lockDir, second.logPath, second.resultPath)).toBe(false);
  });

  test("the check command's lock paths follow KUMIKO_CLI_SCOPE from the environment", () => {
    const base = tempDir();
    const previous = process.env["KUMIKO_CLI_SCOPE"];
    cleanups.push(() => {
      if (previous === undefined) delete process.env["KUMIKO_CLI_SCOPE"];
      else process.env["KUMIKO_CLI_SCOPE"] = previous;
    });

    process.env["KUMIKO_CLI_SCOPE"] = "kumiko-enterprise";
    const scoped = checkLockPaths(resolveCheckWorkContext(base, base).cliScope, base);
    expect(scoped.lockDir).toBe(join(base, ".kumiko-check.lock.kumiko-enterprise"));

    delete process.env["KUMIKO_CLI_SCOPE"];
    const unscoped = checkLockPaths(resolveCheckWorkContext(base, base).cliScope, base);
    expect(unscoped.lockDir).toBe(join(base, ".kumiko-check.lock"));
  });

  test("followCheck for one scope never adopts another scope's result", async () => {
    const base = tempDir();
    const a = checkLockPaths("kumiko-framework", base);
    const b = checkLockPaths("kumiko-enterprise", base);

    expect(acquireCheckLock(a.lockDir, a.logPath, a.resultPath)).toBe(true);
    expect(acquireCheckLock(b.lockDir, b.logPath, b.resultPath)).toBe(true);

    // repo B's check finishes and FAILS.
    writeFileSync(b.resultPath, "1");
    rmSync(b.lockDir, { recursive: true, force: true });

    // repo A's check is STILL running (no result yet, lock still held) — a
    // caller following B's scope must read B's own fail, never entangled
    // with A's still in-flight run.
    expect(existsSync(b.lockDir)).toBe(false);
    expect(await followCheck(b.lockDir, b.logPath, b.resultPath)).toBe(1);
    expect(existsSync(a.resultPath)).toBe(false);

    // repo A finishes clean, independent of B's fail.
    writeFileSync(a.resultPath, "0");
    rmSync(a.lockDir, { recursive: true, force: true });
    expect(existsSync(a.lockDir)).toBe(false);
    expect(await followCheck(a.lockDir, a.logPath, a.resultPath)).toBe(0);
  });
});

describe("parseCliScope", () => {
  test("empty or undefined yields no repos", () => {
    expect(parseCliScope(undefined)).toEqual([]);
    expect(parseCliScope(" , ")).toEqual([]);
  });

  test("splits, sorts and deduplicates", () => {
    expect(parseCliScope("solon,kumiko-framework solon")).toEqual(["kumiko-framework", "solon"]);
  });
});
