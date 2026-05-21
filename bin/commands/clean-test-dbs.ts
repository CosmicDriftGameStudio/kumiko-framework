import { join } from "node:path";
import { existsSync } from "node:fs";
import { parseArgs, getFlag } from "./arg-parser";
import { runStreaming } from "./_spawn";
import { defineCommand } from "./registry";

export const cleanTestDbsCommand = defineCommand({
  id: "clean-test-dbs",
  label: "clean-test-dbs",
  description: "Verwaiste kumiko_test_* DBs loeschen (SIGKILLed Tests, abgebrochene Runs)",
  help: "Aufruf: kumiko clean-test-dbs [--dry-run]\nRuft scripts/cleanup-test-dbs.ts auf — listet (dry-run) oder droppt (default) stale Test-DBs.",
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
