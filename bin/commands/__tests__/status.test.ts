import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { runGit } from "../../_git-test-helpers";
import { makeContext, makeSpyOutput, makeTempCwd } from "../_test-helpers";
import { DOCKER_PROBE_TIMEOUT_MS, type run } from "../_spawn";
import { defaultStatusDeps, dockerComposeProbe, runStatus, statusCommand } from "../status";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanups) c();
  cleanups.length = 0;
});

// Real git against a throwaway repo; only the docker daemon is stubbed so the test never waits on it.
const realGitDeps = {
  ...defaultStatusDeps,
  probeDocker: async () => ({ status: 1, stdout: "", stderr: "", timedOut: false }),
};

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

  test("non-git cwd reports gracefully; a failing docker probe reads as not running", async () => {
    const cwd = tmp();
    const spy = makeSpyOutput();
    const exit = await runStatus(makeContext({ cwd, out: spy.out }), {
      probeDocker: async () => ({ status: 1, stdout: "", stderr: "", timedOut: false }),
      runGit: async () => ({
        status: 128,
        stdout: "",
        stderr: "fatal: not a git repository",
        timedOut: false,
      }),
    });
    expect(exit).toBe(0);
    const joined = spy.logs.join("\n");
    expect(joined).toContain("Services");
    expect(joined).toContain("Docker services not running");
    expect(joined).not.toContain("timed out");
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
    const exit = await runStatus(makeContext({ cwd, out: spy.out }), {
      ...realGitDeps,
      probeDocker: dockerComposeProbe(50),
    });

    expect(exit).toBe(0);
    const joined = spy.logs.join("\n");
    expect(joined).toContain("Docker probe timed out (daemon slow or hung)");
  });

  test("dockerComposeProbe defaults to the shared probe timeout and compose arguments", async () => {
    const calls: Array<{ cmd: string; args: readonly string[]; opts: unknown }> = [];
    const spyRun: typeof run = async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return { status: 0, stdout: "", stderr: "", timedOut: false };
    };

    await dockerComposeProbe(undefined, spyRun)("/some/cwd");

    expect(calls).toEqual([
      {
        cmd: "docker",
        args: ["compose", "ps", "--format", "json"],
        opts: { cwd: "/some/cwd", timeoutMs: DOCKER_PROBE_TIMEOUT_MS },
      },
    ]);
  });

  test("missing docker binary is reported as not found, not as a timeout", async () => {
    const cwd = tmp();
    const emptyBin = mkdtempSync(join(tmpdir(), "kumiko-emptybin-"));
    const originalPath = process.env["PATH"];
    cleanups.push(() => {
      if (originalPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = originalPath;
      rmSync(emptyBin, { recursive: true, force: true });
    });
    process.env["PATH"] = emptyBin;

    const spy = makeSpyOutput();
    await statusCommand.run(makeContext({ cwd, out: spy.out }));
    const joined = spy.logs.join("\n");
    expect(joined).toContain("docker binary not found");
    expect(joined).not.toContain("timed out");
  });

  test("real git repo shows current branch + status", async () => {
    const cwd = tmp();
    // Setup a real, tiny git repo so we can verify the integration.
    runGit(["init", "-b", "main"], cwd);
    runGit(["config", "user.email", "test@test"], cwd);
    runGit(["config", "user.name", "Test"], cwd);
    runGit(["commit", "--allow-empty", "-m", "init"], cwd);

    const spy = makeSpyOutput();
    const exit = await runStatus(makeContext({ cwd, out: spy.out }), realGitDeps);
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
    await runStatus(makeContext({ cwd, out: spy.out }), realGitDeps);
    const joined = spy.logs.join("\n");
    expect(joined).toMatch(/Changes:/);
    expect(joined).toMatch(/\?\? file\.txt/);
  });
});
