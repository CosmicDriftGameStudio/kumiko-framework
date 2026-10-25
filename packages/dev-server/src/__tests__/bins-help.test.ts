// `<bin> --help` must print usage and exit 0 without doing the bin's real
// work: kumiko-init-deploy used to scaffold deploy/ from package.json, and
// kumiko-build/kumiko-dev treated the flag as a path / server entry.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSchemaCli } from "@cosmicdrift/kumiko-framework/schema-cli";
import { runUpgradeCli } from "@cosmicdrift/kumiko-framework/upgrade-cli";
import { runInitDeployCli } from "../init-deploy-cli";

const BIN_DIR = join(import.meta.dir, "..", "..", "bin");

type InProcessRun = (
  argv: string[],
  cwd: string,
  out: { log: (line: string) => void; err: (line: string) => void },
) => Promise<number>;

// kumiko-build and kumiko-dev have no exported entry (their top level is the logic),
// so both flags go through a real process. The other bins keep one spawn (--help)
// and run -h through the exported CLI function the bin delegates to.
const bins: ReadonlyArray<{ file: string; usage: string; run?: InProcessRun }> = [
  {
    file: "kumiko-init-deploy.ts",
    usage: "Usage: kumiko-init-deploy",
    run: (argv, cwd, out) => runInitDeployCli({ argv, cwd, out }),
  },
  { file: "kumiko-build.ts", usage: "Usage: kumiko-build" },
  { file: "kumiko-dev.ts", usage: "Usage: kumiko-dev" },
  {
    file: "kumiko-schema.ts",
    usage: "Subcommands:",
    run: (argv, cwd, out) => runSchemaCli(argv, cwd, out),
  },
  {
    file: "kumiko-upgrade.ts",
    usage: "kumiko-upgrade [--from",
    run: (argv, cwd, out) => runUpgradeCli(argv, cwd, out, { codemodResolveFrom: BIN_DIR }),
  },
];

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

  for (const { file, usage, run } of bins) {
    for (const flag of ["--help", "-h"]) {
      test(`${file} ${flag}: usage on stdout, exit 0, no files created`, async () => {
        let stdout: string;
        let exitCode: number;
        if (run !== undefined && flag === "-h") {
          const lines: string[] = [];
          const sink = (line: string) => lines.push(line);
          exitCode = await run([flag], cwd, { log: sink, err: sink });
          stdout = lines.join("\n");
        } else {
          ({ stdout, exitCode } = await runBin(file, [flag], cwd));
        }

        expect(exitCode).toBe(0);
        expect(stdout).toContain(usage);
        expect(readdirSync(cwd)).toEqual(["package.json"]);
      });
    }
  }
});
