import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, test } from "bun:test";
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
    expect(joined).toContain("Docker services not running"); // no compose.yml
    expect(joined).toContain("Not a git repository");
  });

  test("real git repo shows current branch + status", async () => {
    const cwd = tmp();
    // Setup a real, tiny git repo so we can verify the integration.
    spawnSync("git", ["init", "-b", "main"], { cwd });
    spawnSync("git", ["config", "user.email", "test@test"], { cwd });
    spawnSync("git", ["config", "user.name", "Test"], { cwd });
    spawnSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd });

    const spy = makeSpyOutput();
    const exit = await statusCommand.run(makeContext({ cwd, out: spy.out }));
    expect(exit).toBe(0);
    const joined = spy.logs.join("\n");
    expect(joined).toMatch(/Branch: main/);
    expect(joined).toContain("Clean");
  });

  test("dirty working tree is reported", async () => {
    const cwd = tmp({ "file.txt": "hello" });
    spawnSync("git", ["init", "-b", "main"], { cwd });
    spawnSync("git", ["config", "user.email", "test@test"], { cwd });
    spawnSync("git", ["config", "user.name", "Test"], { cwd });
    // Don't commit — file.txt stays untracked.

    const spy = makeSpyOutput();
    await statusCommand.run(makeContext({ cwd, out: spy.out }));
    const joined = spy.logs.join("\n");
    expect(joined).toMatch(/Changes:/);
    expect(joined).toMatch(/\?\? file\.txt/);
  });
});
