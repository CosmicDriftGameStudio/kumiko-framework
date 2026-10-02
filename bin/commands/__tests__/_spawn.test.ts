import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isProbeTimeout, run, runStreaming } from "../_spawn";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("run / runStreaming exit codes", () => {
  test("run maps a SIGKILL'd child to exit status 137, not 0", async () => {
    const result = await run("sh", ["-c", "kill -9 $$"]);
    expect(result.status).toBe(137);
  });

  test("runStreaming maps a SIGKILL'd child to exit status 137 and logs the signal", async () => {
    const logs: string[] = [];
    const status = await runStreaming("sh", ["-c", "kill -9 $$"], { log: (m) => logs.push(m) });
    expect(status).toBe(137);
    expect(logs.some((line) => line.includes("SIGKILL"))).toBe(true);
  });

  test("run reports a normal exit 0 as 0", async () => {
    const result = await run("sh", ["-c", "exit 0"]);
    expect(result.status).toBe(0);
  });
});

describe("run timeout handling", () => {
  test("a missing binary is a spawn failure, not a probe timeout", async () => {
    const result = await run("kumiko-no-such-binary-xyz", []);
    expect(result.status).toBe(-1);
    expect(isProbeTimeout(result)).toBe(false);
  });

  test("a hanging child is reported as a probe timeout", async () => {
    const result = await run("sh", ["-c", "sleep 30"], { timeoutMs: 200 });
    expect(result.status).toBe(-1);
    expect(isProbeTimeout(result)).toBe(true);
  });

  test("a child ignoring SIGTERM is SIGKILLed after the grace period, even after run() settled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kumiko-spawn-"));
    const pidFile = join(dir, "pid");
    try {
      const result = await run(
        "sh",
        ["-c", `trap '' TERM; echo $$ > '${pidFile}'; while :; do sleep 0.05; done`],
        { timeoutMs: 500, killGraceMs: 100 },
      );
      expect(isProbeTimeout(result)).toBe(true);
      const pid = Number(readFileSync(pidFile, "utf-8").trim());
      expect(Number.isInteger(pid)).toBe(true);
      const deadline = Date.now() + 5000;
      while (isAlive(pid) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(isAlive(pid)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
