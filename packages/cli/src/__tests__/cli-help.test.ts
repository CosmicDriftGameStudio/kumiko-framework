import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { runCli } from "../index";

const CLI_PATH = join(import.meta.dir, "..", "..", "bin", "cli.ts");

describe("kumiko (packages/cli) --help", () => {
  test("--help: usage on stdout, exit 0", async () => {
    const proc = Bun.spawn(["bun", CLI_PATH, "--help"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Commands:");
  });

  test("-h: usage on stdout, exit 0", async () => {
    const lines: string[] = [];
    const exitCode = await runCli({
      argv: ["-h"],
      out: { log: (line) => lines.push(line), err: (line) => lines.push(line) },
    });

    expect(exitCode).toBe(0);
    expect(lines.join("\n")).toContain("Commands:");
  });
});

describe("kumiko-upgrade ships with packages/cli", () => {
  test("package.json links the bin, so cli + guards repos can run guard-upgrade-state", async () => {
    const manifest: unknown = await Bun.file(
      join(import.meta.dir, "..", "..", "package.json"),
    ).json();
    expect(manifest).toMatchObject({ bin: { "kumiko-upgrade": "./bin/kumiko-upgrade.ts" } });
  });

  test("--help prints the upgrade usage and exits 0", async () => {
    const proc = Bun.spawn(
      ["bun", join(import.meta.dir, "..", "..", "bin", "kumiko-upgrade.ts"), "--help"],
      {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("kumiko-upgrade [--from");
  });
});
