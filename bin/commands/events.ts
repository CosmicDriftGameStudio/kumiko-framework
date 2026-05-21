import { parseArgs, getFlag, getNumberFlag } from "./arg-parser";
import { defineCommand } from "./registry";

export const eventsCommand = defineCommand({
  id: "events",
  label: "events",
  description: "Events-Tabelle verwalten (prune [--older-than <days>] [--dry-run])",
  help: "Subcommand:\n  prune [--older-than <days>] [--dry-run]\n    Default: 30 Tage. Schützt vor Konsumenten-Lag via ConsumerLagError.",
  category: "ops",
  roles: ["maintainer"],
  run: async (ctx) => {
    const sub = ctx.argv[0];
    if (sub !== "prune") {
      ctx.out.log("");
      ctx.out.log("  Usage: kumiko events prune [--older-than <days>] [--dry-run]");
      ctx.out.log("");
      return 1;
    }

    const args = parseArgs(ctx.argv.slice(1));
    const olderThanDays = getNumberFlag(args, "older-than") ?? 30;
    const dryRun = getFlag(args, "dry-run");
    if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) {
      ctx.out.err("");
      ctx.out.err("  --older-than requires a positive number (days)");
      ctx.out.err("");
      return 1;
    }

    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) {
      ctx.out.err("");
      ctx.out.err("  DATABASE_URL not set.");
      ctx.out.err("");
      return 1;
    }

    const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db");
    const { ConsumerLagError, pruneEvents } = await import(
      "@cosmicdrift/kumiko-framework/pipeline"
    );

    const { db, close } = createDbConnection(databaseUrl);
    try {
      const result = await pruneEvents(db, { olderThanDays, dryRun });
      const verb = dryRun ? "would delete" : "deleted";
      ctx.out.log("");
      ctx.out.log(
        `  ✓ ${verb} ${result.deletedCount} event(s) older than ${String(result.cutoff)} ` +
          `(aggregateType=${result.aggregateTypes.join(",")})`,
      );
      if (result.dryRun) {
        ctx.out.log("    Drop --dry-run to actually delete.");
      }
      ctx.out.log("");
      return 0;
    } catch (e) {
      if (e instanceof ConsumerLagError) {
        ctx.out.err("");
        ctx.out.err(`  ✗ ${e.message}`);
        ctx.out.err("    Options: catch up the consumer, disable it, or use `kumiko consumer skip <name>`.");
        ctx.out.err("");
      } else {
        ctx.out.err("");
        ctx.out.err(`  ✗ ${e instanceof Error ? e.message : String(e)}`);
        ctx.out.err("");
      }
      return 1;
    } finally {
      await close();
    }
  },
});
