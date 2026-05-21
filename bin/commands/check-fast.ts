import { join } from "node:path";
import { runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

const LEGACY_BIN = "bin/kumiko-legacy.ts";

export const checkFastCommand = defineCommand({
  id: "check:fast",
  label: "check:fast",
  description: "Schneller Check (skip Integration, Unit-Tests nur --changed)",
  help: "Fast iteration loop: parallel Biome/TS/Guards + vitest --changed.\nFür Pre-Commit / Pre-Push, NICHT für CI.\n\n(Sprint B: subprocess-delegation. Sprint C: extract.)",
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
