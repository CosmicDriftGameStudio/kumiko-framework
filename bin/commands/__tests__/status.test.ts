import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { runGit } from "../../_git-test-helpers";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { statusCommand } from "../status";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

function tmp(files?: Record<string, string>): string {
  const t = makeTempCwd(files);
  cleanups.push(t.cleanup);
  return t.cwd;
}

describe("status command", () => {
  test("defined with correct metadata", () => {
    expect(statusCommand.id).toBe("status");
    expect(statusCommand.roles).toContain("maintainer");
    expect(statusCommand.roles).toContain("app-dev");
    expect(statusCommand.category).toBe("lifecycle");
  });

  test("non-git cwd reports gracefully", async () => {
    const cwd = tmp();
    const spy = makeSpyOutput();
    const exit = await statusCommand.run(makeContext({ cwd, out: spy.out }));
    expect(exit).toBe(0);
    const joined = spy.logs.join("\n");
    expect(joined).toContain("Services");
    // CI runners can have a slow docker daemon → timeout instead of "not running"
    expect(
      joined.includes("Docker services not running") ||
        joined.includes("Docker probe timed out (daemon slow or hung)"),
    ).toBe(true);
    expect(joined).toContain("Not a git repository");
  });

  test("docker probe that hangs is capped by its own timeout, not the daemon's", async () => {
    const cwd = tmp();
    const binDir = mkdtempSync(join(tmpdir(), "kumiko-fakebin-"));
    writeFileSync(join(binDir, "docker"), "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
    const originalPath = process.env["PATH"];
    cleanups.push(() => {
      if (originalPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = originalPath;
      rmSync(binDir, { recursive: true, force: true });
    });
    process.env["PATH"] = originalPath === undefined ? binDir : `${binDir}:${originalPath}`;

    const spy = makeSpyOutput();
    const start = Date.now();
    const exit = await statusCommand.run(makeContext({ cwd, out: spy.out }));
    const elapsedMs = Date.now() - start;

    expect(exit).toBe(0);
    // Loose bounds: prove the probe ran (not ENOENT) and was capped well under sleep 30.
    expect(elapsedMs).toBeGreaterThanOrEqual(1000);
    expect(elapsedMs).toBeLessThan(15_000);
    const joined = spy.logs.join("\n");
    expect(joined).toContain("Docker probe timed out (daemon slow or hung)");
  });

  test("real git repo shows current branch + status", async () => {
    const cwd = tmp();
    // Setup a real, tiny git repo so we can verify the integration.
    runGit(["init", "-b", "main"], cwd);
    runGit(["config", "user.email", "test@test"], cwd);
    runGit(["config", "user.name", "Test"], cwd);
    runGit(["commit", "--allow-empty", "-m", "init"], cwd);

    const spy = makeSpyOutput();
    const exit = await statusCommand.run(makeContext({ cwd, out: spy.out }));
    expect(exit).toBe(0);
    const joined = spy.logs.join("\n");
    expect(joined).toMatch(/Branch: main/);
    expect(joined).toContain("Clean");
  });

  test("dirty working tree is reported", async () => {
    const cwd = tmp({ "file.txt": "hello" });
    runGit(["init", "-b", "main"], cwd);
    runGit(["config", "user.email", "test@test"], cwd);
    runGit(["config", "user.name", "Test"], cwd);
    // Don't commit — file.txt stays untracked.

    const spy = makeSpyOutput();
    await statusCommand.run(makeContext({ cwd, out: spy.out }));
    const joined = spy.logs.join("\n");
    expect(joined).toMatch(/Changes:/);
    expect(joined).toMatch(/\?\? file\.txt/);
  });
});
