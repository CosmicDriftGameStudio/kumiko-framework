import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
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

// The background subshell keeps the pipe open past the parent's exit, so output
// arriving after "exit" is guaranteed instead of left to scheduling luck.
describe("run / runStreaming collect output written after the child exited", () => {
  const writeAfterExit = ["-c", "(sleep 0.2; echo late) & echo early; exit 0"];

  test("run keeps stdout that arrives after the exit event", async () => {
    const result = await run("sh", writeAfterExit);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("early\nlate\n");
  });

  test("runStreaming logs lines that arrive after the exit event", async () => {
    const logs: string[] = [];
    const status = await runStreaming("sh", writeAfterExit, { log: (m) => logs.push(m) });
    expect(status).toBe(0);
    expect(logs).toEqual(["early", "late"]);
  });
});

describe("a grandchild holding the pipe open after the child exited", () => {
  const holdPipe = ["-c", "(sleep 5) & echo early; exit 0"];

  test("run with a timeout that fires after the exit still waits for the pipe drain grace and keeps the collected output", async () => {
    const startedAt = Date.now();
    const result = await run("sh", holdPipe, { timeoutMs: 300 });
    expect(Date.now() - startedAt).toBeLessThan(2500);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("early\n");
  });

  test("run without a timeout still returns after the pipe drain grace", async () => {
    const startedAt = Date.now();
    const result = await run("sh", holdPipe);
    expect(Date.now() - startedAt).toBeLessThan(2500);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("early\n");
  });

  test("runStreaming returns the exit code after the pipe drain grace", async () => {
    const startedAt = Date.now();
    const logs: string[] = [];
    const status = await runStreaming("sh", holdPipe, { log: (m) => logs.push(m) });
    expect(Date.now() - startedAt).toBeLessThan(2500);
    expect(status).toBe(0);
    expect(logs).toEqual(["early"]);
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
      await waitFor(
        () => {
          expect(isAlive(pid)).toBe(false);
        },
        { delays: [50, 200, 1000] },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
