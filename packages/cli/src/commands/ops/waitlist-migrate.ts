import { join } from "node:path";
import { loadAppConfig } from "../load-app-config";
import type { CliCommandContext } from "../types";

const USAGE =
  "Usage: kumiko ops waitlist-migrate --from <offlot|publicstatus> [--dry-run] [--source-table <name>] [--locale <tag>]";

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

function fail(ctx: CliCommandContext, ...lines: readonly string[]): number {
  ctx.out.err("");
  for (const line of lines) ctx.out.err(`  ${line}`);
  ctx.out.err("");
  return 1;
}

export const waitlistMigrateOp = {
  id: "waitlist-migrate",
  description: "Copy a legacy app waitlist into the framework waitlist entity (idempotent)",
  run: async (ctx: CliCommandContext): Promise<number> => {
    const {
      DEFAULT_IMPORT_LOCALE,
      DEFAULT_LEGACY_SOURCE_TABLE,
      isLegacyWaitlistSource,
      migrateLegacyWaitlist,
    } = await import("@cosmicdrift/kumiko-bundled-features/waitlist");
    const from = flagValue(ctx.argv, "--from");
    if (!isLegacyWaitlistSource(from)) return fail(ctx, USAGE);

    const configPath = join(ctx.cwd, "kumiko.config.ts");
    if (!(await Bun.file(configPath).exists())) {
      return fail(ctx, `kumiko.config.ts not found at: ${configPath}`);
    }
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) return fail(ctx, "DATABASE_URL not set.");
    const config = await loadAppConfig(ctx, configPath);
    if (config === null) return 1;
    if (!config.features.some((feature) => feature.name === "waitlist")) {
      return fail(
        ctx,
        "The app config does not mount the framework `waitlist` feature; add createWaitlistFeature() first.",
      );
    }

    const dryRun = ctx.argv.includes("--dry-run");
    const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db");
    const { db, close } = createDbConnection({ url: databaseUrl });
    try {
      const report = await migrateLegacyWaitlist(db, {
        from,
        dryRun,
        sourceTable: flagValue(ctx.argv, "--source-table") ?? DEFAULT_LEGACY_SOURCE_TABLE[from],
        defaultLocale: flagValue(ctx.argv, "--locale") ?? DEFAULT_IMPORT_LOCALE,
      });
      ctx.out.log("");
      ctx.out.log(
        `  ${dryRun ? "[dry-run] " : ""}waitlist-migrate --from ${from}: read ${report.read}, ${dryRun ? "would create" : "created"} ${report.created}, already present ${report.skipped}, unreadable ${report.unreadable}, legacy streams archived ${report.archivedStreams}`,
      );
      ctx.out.log("");
      return report.unreadable > 0 ? 1 : 0;
    } catch (e) {
      return fail(ctx, `✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await close();
    }
  },
} as const;
