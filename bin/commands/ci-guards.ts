import { join } from "node:path";
import { runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

const LEGACY_BIN = "bin/kumiko-legacy.ts";

export const ciGuardsCommand = defineCommand({
  id: "ci:guards",
  label: "ci:guards",
  description: "CI-only — alle Guards/Audits aus FAST_CHECK_STEPS außer Lint/TSC (parallel)",
  help: "CI-Job splitter: FAST_CHECK_STEPS minus Biome/TypeScript/TypeScript-Samples.\nWird vom CI-Job 'guards' aufgerufen — Lint/TSC laufen in eigenen Jobs.\n\n(Sprint B: subprocess-delegation. Sprint C: extract.)",
  category: "quality",
  roles: ["maintainer"],
  run: async (ctx) => {
    return await runStreaming(
      process.execPath,
      [join(ctx.repoRoot, LEGACY_BIN), "ci:guards"],
      ctx.out,
      { cwd: ctx.cwd },
    );
  },
});
