import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "bun:test";

// check_rss_kb must tolerate a /proc/PID/status that vanishes between the `-r` check
// and the read; macOS awk doesn't fail on a missing directory, so an awk stub on PATH
// injects the failure for one path.

const SCRIPT_PATH = fileURLToPath(new URL("../ci-memlog-run.sh", import.meta.url));
const REAL_AWK = Bun.which("awk");
if (!REAL_AWK) {
  throw new Error("ci-memlog-run.sh guard test requires `awk` on PATH");
}

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ci-memlog-run-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeProcDir(): string {
  const procDir = makeTempDir();
  writeFileSync(join(procDir, "meminfo"), "MemTotal:       16384000 kB\nMemAvailable:    8192000 kB\n");
  return procDir;
}

function addProcess(procDir: string, pid: number, name: string, vmRssKb: number): string {
  const pidDir = join(procDir, String(pid));
  mkdirSync(pidDir, { recursive: true });
  const statusPath = join(pidDir, "status");
  writeFileSync(statusPath, `Name:\t${name}\nVmRSS:\t   ${vmRssKb} kB\n`);
  return statusPath;
}

function makeAwkStubDir(brokenStatusPath: string | undefined): string {
  const dir = makeTempDir();
  writeFileSync(
    join(dir, "awk"),
    [
      "#!/bin/sh",
      `if [ "$2" = ${JSON.stringify(brokenStatusPath ?? "")} ]; then`,
      "  echo \"awk: fatal: cannot open file '$2' for reading: No such file or directory\" >&2",
      "  exit 2",
      "fi",
      `exec ${JSON.stringify(REAL_AWK)} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return dir;
}

function runWrapper(
  procDir: string,
  awkStubDir: string,
  wrappedArgs: string[],
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["sh", SCRIPT_PATH, ...wrappedArgs], {
    env: {
      ...process.env,
      PATH: `${awkStubDir}:${process.env.PATH ?? ""}`,
      KUMIKO_MEMLOG_PROC_DIR: procDir,
      KUMIKO_MEMLOG_INTERVAL_SEC: "1",
    },
  });
  return {
    exitCode: result.exitCode ?? -1,
    stdout: result.stdout.toString("utf-8"),
    stderr: result.stderr.toString("utf-8"),
  };
}

describe("ci-memlog-run.sh", () => {
  test("a vanished /proc/PID/status entry does not flip a successful wrapped command to a failing exit code", () => {
    const procDir = makeProcDir();
    const brokenStatus = addProcess(procDir, 99999, "bun", 12345);
    const awkStubDir = makeAwkStubDir(brokenStatus);

    const { exitCode } = runWrapper(procDir, awkStubDir, ["sh", "-c", "exit 0"]);

    expect(exitCode).toBe(0);
  });

  test("the wrapped command's real non-zero exit code is passed through", () => {
    const procDir = makeProcDir();
    const brokenStatus = addProcess(procDir, 99999, "bun", 12345);
    const awkStubDir = makeAwkStubDir(brokenStatus);

    const { exitCode } = runWrapper(procDir, awkStubDir, ["sh", "-c", "exit 3"]);

    expect(exitCode).toBe(3);
  });

  test("check_rss_kb still sums VmRSS of readable toolchain processes correctly", () => {
    const procDir = makeProcDir();
    addProcess(procDir, 111, "bun", 12345);
    addProcess(procDir, 222, "node", 6789);
    const awkStubDir = makeAwkStubDir(undefined);

    const { exitCode, stdout } = runWrapper(procDir, awkStubDir, ["sh", "-c", "exit 0"]);

    expect(exitCode).toBe(0);
    const startLine = stdout.split("\n").find((line) => line.includes("[kumiko-mem] start"));
    expect(startLine).toBeDefined();
    const expectedMib = Math.floor((12345 + 6789) / 1024);
    expect(startLine).toMatch(new RegExp(`check_rss=\\s*${expectedMib}MiB`));
  });
});
