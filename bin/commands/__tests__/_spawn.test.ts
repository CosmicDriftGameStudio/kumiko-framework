import { describe, expect, test } from "bun:test";
import { run, runStreaming } from "../_spawn";

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
