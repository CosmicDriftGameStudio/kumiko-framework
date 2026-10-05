import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "..", "bin", "cli.ts");

describe("kumiko (packages/cli) --help", () => {
  for (const flag of ["--help", "-h"]) {
    test(`${flag}: usage on stdout, exit 0`, async () => {
      const proc = Bun.spawn(["bun", CLI_PATH, flag], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("Commands:");
    });
  }
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
