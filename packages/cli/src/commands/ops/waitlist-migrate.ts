import { join } from "node:path";
import { wireKmsFromEnv } from "../kms-wiring";
import { loadAppConfig } from "../load-app-config";
import type { CliCommandContext } from "../types";

const USAGE =
  "Usage: kumiko ops waitlist-migrate --from <offlot|publicstatus> [--dry-run] [--source-table <name>] [--locale <tag>] [--allow-plaintext-pii <reason>]";

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

type AppConfig = NonNullable<Awaited<ReturnType<typeof loadAppConfig>>>;
type Preflight =
  | { readonly ok: true; readonly databaseUrl: string; readonly config: AppConfig }
  | { readonly ok: false; readonly exitCode: number };

async function preflight(ctx: CliCommandContext): Promise<Preflight> {
  const configPath = join(ctx.cwd, "kumiko.config.ts");
  if (!(await Bun.file(configPath).exists())) {
    return { ok: false, exitCode: fail(ctx, `kumiko.config.ts not found at: ${configPath}`) };
  }
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) return { ok: false, exitCode: fail(ctx, "DATABASE_URL not set.") };
  const config = await loadAppConfig(ctx, configPath);
  if (config === null) return { ok: false, exitCode: 1 };
  if (!config.features.some((feature) => feature.name === "waitlist")) {
    const message =
      "The app config does not mount the framework `waitlist` feature; add createWaitlistFeature() first.";
    return { ok: false, exitCode: fail(ctx, message) };
  }
  return { ok: true, databaseUrl, config };
}

function plaintextPiiReasonIsMissing(ctx: CliCommandContext): boolean {
  return (
    ctx.argv.includes("--allow-plaintext-pii") &&
    !flagValue(ctx.argv, "--allow-plaintext-pii")?.trim()
  );
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

    const checked = await preflight(ctx);
    if (!checked.ok) return checked.exitCode;
    if (plaintextPiiReasonIsMissing(ctx)) {
      return fail(ctx, "--allow-plaintext-pii requires a non-empty reason");
    }

    const dryRun = ctx.argv.includes("--dry-run");
    const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db");
    const { db, close } = createDbConnection({
      url: checked.databaseUrl,
      rowLevelSecurity: "off", // one-off operator migration, no tenant scope
    });
    let wiring: Awaited<ReturnType<typeof wireKmsFromEnv>> | undefined;
    try {
      // Without the KMS the executor would write name/email/message as plaintext into the
      // event log, where crypto-shredding cannot reach them.
      wiring = await wireKmsFromEnv({
        logPrefix: "[kumiko ops waitlist-migrate]",
        log: (line) => ctx.out.log(line),
        features: checked.config.features,
        allowPlaintextPii: flagValue(ctx.argv, "--allow-plaintext-pii"),
        consequence: "The import would store personal data as plaintext in the event log.",
      });
      const report = await migrateLegacyWaitlist(db, {
        from,
        dryRun,
        sourceTable: flagValue(ctx.argv, "--source-table") ?? DEFAULT_LEGACY_SOURCE_TABLE[from],
        defaultLocale: flagValue(ctx.argv, "--locale") ?? DEFAULT_IMPORT_LOCALE,
      });
      ctx.out.log("");
      ctx.out.log(
        `  ${dryRun ? "[dry-run] " : ""}waitlist-migrate --from ${from}: read ${report.read}, ${dryRun ? "would create" : "created"} ${report.created}, already present ${report.skipped}, unreadable ${report.unreadable}, legacy streams ${dryRun ? "would archive" : "archived"} ${report.archivedStreams}`,
      );
      ctx.out.log("");
      return report.unreadable > 0 ? 1 : 0;
    } catch (e) {
      return fail(ctx, `✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      await wiring?.close();
      await close();
    }
  },
} as const;
