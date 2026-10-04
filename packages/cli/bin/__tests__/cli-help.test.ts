import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "cli.ts");

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
