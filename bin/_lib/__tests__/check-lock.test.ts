import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { acquireCheckLock, checkLockPaths, followCheck } from "../check-lock";

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
    expect(await followCheck(b.lockDir, b.logPath, b.resultPath)).toBe(1);
    expect(existsSync(a.resultPath)).toBe(false);

    // repo A finishes clean, independent of B's fail.
    writeFileSync(a.resultPath, "0");
    rmSync(a.lockDir, { recursive: true, force: true });
    expect(await followCheck(a.lockDir, a.logPath, a.resultPath)).toBe(0);
  });
});
