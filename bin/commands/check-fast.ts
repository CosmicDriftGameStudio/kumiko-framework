import { join } from "node:path";
import { CHECK_PIPELINE_BIN, runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

export const checkFastCommand = defineCommand({
  id: "check:fast",
  label: "check:fast",
  description: "Fast check (skip integration, unit tests --changed only)",
  help: "Fast iteration loop: parallel Biome/TS/guards + vitest --changed.\nFor pre-commit / pre-push, NOT for CI.",
  category: "quality",
  roles: ["maintainer"],
  run: async (ctx) => {
    return await runStreaming(
      process.execPath,
      [join(ctx.repoRoot, CHECK_PIPELINE_BIN), "check:fast"],
      ctx.out,
      { cwd: ctx.cwd },
    );
  },
});
