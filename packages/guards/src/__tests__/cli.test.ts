import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "cli.ts");

async function runCli(args: string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["bun", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("cli.ts — real process runs, no mocks", () => {
  test("an unknown subcommand exits 1 and lists the valid subcommands on stderr", async () => {
    const { exitCode, stderr } = await runCli(["nonsense"]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("guards");
    expect(stderr).toContain("ui");
    expect(stderr).toContain("checks");
  });

  test("checks runs the repo-checks suite and prints the guard-kit banner", async () => {
    const { exitCode, stdout } = await runCli(["checks"]);

    expect([0, 1]).toContain(exitCode);
    expect(stdout).toContain("kumiko-guards");
    expect(stdout).toContain("guards registered");
    const bannerCount = stdout.split("guards registered").length - 1;
    expect(bannerCount).toBe(1);
  }, 30_000);
});
