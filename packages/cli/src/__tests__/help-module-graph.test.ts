// `kumiko --help` and `kumiko <command> --help` print static text. When they also loaded the
// dev-server barrel (framework, server-runtime, renderer), every help call cost ~0.7 s cold and
// the spawn tests ran into the 5 s test timeout under a loaded pre-push hook.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI_INDEX = join(import.meta.dir, "..", "index.ts");

function loadedModulesAfterHelp(argv: readonly string[]): string[] {
  const script = `
    const { runCli } = await import(${JSON.stringify(CLI_INDEX)});
    const code = await runCli({ argv: ${JSON.stringify(argv)}, out: { log() {}, err() {} } });
    console.log(JSON.stringify({ code, modules: Object.keys(require.cache) }));
  `;
  const proc = Bun.spawnSync(["bun", "-e", script], { stdout: "pipe", stderr: "pipe" });
  expect(proc.exitCode).toBe(0);
  const parsed: unknown = JSON.parse(proc.stdout.toString());
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("code" in parsed) ||
    !("modules" in parsed)
  ) {
    throw new Error(`unexpected probe output: ${proc.stdout.toString()}`);
  }
  expect(parsed.code).toBe(0);
  return Array.isArray(parsed.modules) ? parsed.modules.map(String) : [];
}

const HEAVY_MODULE_MARKERS = [
  "/dev-server/src/",
  "/server-runtime/src/",
  "/guards/src/repo-manifest/app-ports",
];

describe("kumiko help module graph", () => {
  test.each([[["--help"]], [["check", "--help"]], [["ports", "--help"]]])(
    "%p loads no scaffolding or guard modules",
    (argv) => {
      const modules = loadedModulesAfterHelp(argv);
      for (const marker of HEAVY_MODULE_MARKERS) {
        expect(modules.filter((path) => path.includes(marker))).toEqual([]);
      }
    },
  );
});
