import { kmsEnvSchema } from "@cosmicdrift/kumiko-bundled-features/crypto-shredding/env";
import { runConsumerCli } from "@cosmicdrift/kumiko-framework/consumer-cli";
import type { RowLevelSecurityMode } from "@cosmicdrift/kumiko-framework/db";
import type { FeatureDefinition } from "@cosmicdrift/kumiko-framework/engine";
import { type ComposedEnvSchema, kmsSlotsOf } from "@cosmicdrift/kumiko-framework/env";
import { runEventsCli } from "@cosmicdrift/kumiko-framework/events-cli";
import { runSchemaCli } from "@cosmicdrift/kumiko-framework/schema-cli";

export type StandaloneCliOut = {
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
};

export type StandaloneCliOptions = {
  readonly features: readonly FeatureDefinition[];
  /** The app's composed env schema (bin/env-schema.ts). */
  readonly envSchema: ComposedEnvSchema;
  readonly rowLevelSecurity?: RowLevelSecurityMode;
  /** Passed to `schema apply`: fail before any migration when the KMS env is missing. */
  readonly requireKms?: boolean;
};

// `generate` writes files, `baseline` marks migrations applied without running SQL.
const DEV_ONLY_SCHEMA_SUBCOMMANDS: readonly string[] = ["generate", "baseline"];

/** Dispatches `schema`, `consumer` and `events` for the bundled dist-server/kumiko.js. Returns the exit code. */
export async function runStandaloneCli(
  argv: readonly string[],
  appCwd: string,
  out: StandaloneCliOut,
  options: StandaloneCliOptions,
): Promise<number> {
  const [command, ...rest] = argv;
  const rowLevelSecurity = options.rowLevelSecurity && {
    rowLevelSecurity: options.rowLevelSecurity,
  };
  if (command === "schema") {
    const subcommand = rest[0];
    if (subcommand !== undefined && DEV_ONLY_SCHEMA_SUBCOMMANDS.includes(subcommand)) {
      out.err(
        `\n  Unknown subcommand: "${subcommand}" — it only runs in development via 'bun kumiko-schema', not in the production bundle.\n`,
      );
      return 1;
    }
    // runProdApp resolves the kmsEnvSchema slots in kmsMode even when the app's own env
    // schema omits them; the projection rebuild after `apply` needs the same keys.
    const kmsSlots = [
      ...new Set([...kmsSlotsOf(options.envSchema.schema), ...kmsSlotsOf(kmsEnvSchema)]),
    ];
    return runSchemaCli(rest, appCwd, out, {
      features: options.features,
      kmsSlots,
      ...(options.requireKms === true && { requireKms: true }),
      ...rowLevelSecurity,
    });
  }
  if (command === "consumer") return runConsumerCli(rest, out);
  if (command === "events") {
    return runEventsCli(rest, out, { features: options.features, ...rowLevelSecurity });
  }
  out.err(
    `\n  Unknown: kumiko ${command ?? ""} — the standalone bundle only runs 'kumiko schema', 'kumiko consumer' and 'kumiko events'.\n`,
  );
  return 1;
}
