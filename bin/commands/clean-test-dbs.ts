import { join } from "node:path";
import { existsSync } from "node:fs";
import { parseArgs, getFlag } from "./arg-parser";
import { runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

export const cleanTestDbsCommand = defineCommand({
  id: "clean-test-dbs",
  label: "clean-test-dbs",
  description: "Drop orphan kumiko_test_* DBs (from SIGKILLed tests or aborted runs)",
  help: "Usage: kumiko clean-test-dbs [--dry-run]\nLists (dry-run) or drops (default) stale test DBs.",
  category: "ops",
  roles: ["maintainer"],
  run: async (ctx) => {
    const args = parseArgs(ctx.argv);
    const dryRun = getFlag(args, "dry-run");
    const script = join(ctx.repoRoot, "scripts/cleanup-test-dbs.ts");
    if (!existsSync(script)) {
      ctx.out.err(`scripts/cleanup-test-dbs.ts not found at ${script}`);
      return 1;
    }
    const argv = ["run", script, ...(dryRun ? ["--dry-run"] : [])];
    return await runStreaming("bun", argv, ctx.out, { cwd: ctx.cwd });
  },
});
