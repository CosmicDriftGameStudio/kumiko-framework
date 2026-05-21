import { join } from "node:path";
import { runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

const LEGACY_BIN = "bin/kumiko-legacy.ts";

export const checkFastCommand = defineCommand({
  id: "check:fast",
  label: "check:fast",
  description: "Fast check (skip integration, unit tests --changed only)",
  help: "Fast iteration loop: parallel Biome/TS/guards + vitest --changed.\nFor pre-commit / pre-push, NOT for CI.\n\n(Sprint B: subprocess delegation. Sprint C: extract.)",
  category: "quality",
  roles: ["maintainer"],
  run: async (ctx) => {
    return await runStreaming(
      process.execPath,
      [join(ctx.repoRoot, LEGACY_BIN), "check:fast"],
      ctx.out,
      { cwd: ctx.cwd },
    );
  },
});
