import { join } from "node:path";
import { runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

const LEGACY_BIN = "bin/kumiko-legacy.ts";

export const ciGuardsCommand = defineCommand({
  id: "ci:guards",
  label: "ci:guards",
  description: "CI-only — run all guards/audits from FAST_CHECK_STEPS except lint/tsc (parallel)",
  help: "CI job splitter: FAST_CHECK_STEPS minus Biome/TypeScript/TypeScript samples.\nCalled by the CI job 'guards' — lint/tsc run in their own jobs.\n\n(Sprint B: subprocess delegation. Sprint C: extract.)",
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
