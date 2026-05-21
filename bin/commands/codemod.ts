import { resolve as resolvePath } from "node:path";
import { parseArgs, getFlag, getStringFlag } from "./arg-parser";
import { defineCommand } from "./registry";

export const codemodCommand = defineCommand({
  id: "codemod",
  label: "codemod",
  description: "Run code migrations — kumiko codemod pipeline [--dry-run] [--verbose] [--dir <path>]",
  help: "Subcommand:\n  pipeline   Convert free-form write-handlers → pipeline form\n\nFlags:\n  --dry-run   Preview changes\n  --verbose   Per-file details\n  --dir       Target dir (default: cwd)",
  category: "code",
  roles: ["maintainer"],
  run: async (ctx) => {
    const sub = ctx.argv[0];
    if (sub !== "pipeline") {
      ctx.out.log("");
      ctx.out.log("  Usage: kumiko codemod pipeline [--dry-run] [--verbose] [--dir <path>]");
      ctx.out.log("    --dry-run    Preview changes without writing");
      ctx.out.log("    --verbose    Show per-file conversion details");
      ctx.out.log("    --dir        Target directory (default: current directory)");
      ctx.out.log("");
      return sub ? 1 : 0;
    }

    const args = parseArgs(ctx.argv.slice(1));
    const dryRun = getFlag(args, "dry-run");
    const verbose = getFlag(args, "verbose");
    const dirFlag = getStringFlag(args, "dir");
    const targetDir = dirFlag ? resolvePath(dirFlag) : ctx.cwd;

    const { runCodemod } = await import(
      "../../packages/framework/src/engine/codemod/index"
    );

    if (dryRun) ctx.out.log("\n  🔍 DRY RUN — no files will be modified\n");
    ctx.out.log("  Codemod: convert free-form write handlers → pipeline form");

    const report = await runCodemod(targetDir, { dryRun, verbose });
    if (report.converted > 0) {
      ctx.out.log("");
      ctx.out.log(`  ${dryRun ? "Would convert" : "Converted"} ${report.converted} handler(s).`);
    }
    if (report.errors > 0) {
      ctx.out.log("");
      ctx.out.log(`  ${report.errors} error(s) during conversion. Use --verbose for details.`);
      return 1;
    }
    return 0;
  },
});
