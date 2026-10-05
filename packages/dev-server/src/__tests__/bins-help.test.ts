// `<bin> --help` must print usage and exit 0 without doing the bin's real
// work: kumiko-init-deploy used to scaffold deploy/ from package.json, and
// kumiko-build/kumiko-dev treated the flag as a path / server entry.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN_DIR = join(import.meta.dir, "..", "..", "bin");

const bins = [
  { file: "kumiko-init-deploy.ts", usage: "Usage: kumiko-init-deploy" },
  { file: "kumiko-build.ts", usage: "Usage: kumiko-build" },
  { file: "kumiko-dev.ts", usage: "Usage: kumiko-dev" },
  { file: "kumiko-schema-check.ts", usage: "Usage: kumiko-schema-check" },
  { file: "kumiko-schema.ts", usage: "Subcommands:" },
  { file: "kumiko-upgrade.ts", usage: "kumiko-upgrade [--from" },
] as const;

async function runBin(file: string, args: string[], cwd: string) {
  const proc = Bun.spawn(["bun", join(BIN_DIR, file), ...args], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("dev-server bins print usage for --help / -h", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "kumiko-bins-help-"));
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "@acme/help-probe" }));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  for (const { file, usage } of bins) {
    for (const flag of ["--help", "-h"]) {
      test(`${file} ${flag}: usage on stdout, exit 0, no files created`, async () => {
        const { stdout, exitCode } = await runBin(file, [flag], cwd);

        expect(exitCode).toBe(0);
        expect(stdout).toContain(usage);
        expect(readdirSync(cwd)).toEqual(["package.json"]);
      });
    }
  }
});
