import { join } from "node:path";
import { runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

// Workspace-only extras (lock, preflight, Biome/tsc, tests, tee logging); boot
// validation and the public guard suites run via the published `kumiko check`.
const LEGACY_BIN = "bin/kumiko-legacy.ts";

export const checkCommand = defineCommand({
  id: "check",
  label: "check",
  description: "Full quality pass: lint, types, guards, unit + integration (local only)",
  help: "Runs Biome + TS + `kumiko check` (boot + guard suites) + unit tests (+ integration locally, not in CI).\nParallel-lock: concurrent invocations follow the lead run.",
  category: "quality",
  roles: ["maintainer", "app-dev"],
  run: async (ctx) => {
    return await runStreaming(
      process.execPath,
      [join(ctx.repoRoot, LEGACY_BIN), "check"],
      ctx.out,
      { cwd: ctx.cwd },
    );
  },
});
