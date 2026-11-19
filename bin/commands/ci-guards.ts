import { join } from "node:path";
import { CHECK_PIPELINE_BIN, runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

export const ciGuardsCommand = defineCommand({
  id: "ci:guards",
  label: "ci:guards",
  description: "CI-only — run all guards/audits from FAST_CHECK_STEPS except lint/tsc (parallel)",
  help: "CI job splitter: FAST_CHECK_STEPS minus Biome/TypeScript/TypeScript samples.\nCalled by the CI job 'guards' — lint/tsc run in their own jobs.",
  category: "quality",
  roles: ["maintainer"],
  run: async (ctx) => {
    return await runStreaming(
      process.execPath,
      [join(ctx.repoRoot, CHECK_PIPELINE_BIN), "ci:guards"],
      ctx.out,
      { cwd: ctx.cwd },
    );
  },
});
