// Standalone event-log ops CLI (`kumiko events prune`) for the production bundle, same shape as
// consumer-cli.ts: one runEventsCli(argv, out, options) entry point with its own DB connection.
// Exists because old events of a retired aggregate type can fail the rebuild that `schema apply`
// runs, and no other surface removes a type from the log.

import type { ConsumerCliOut } from "./consumer-cli-internals.ts";
import { createDbConnection, dbConnectionOptionsFromEnv } from "./db/connection.ts";
import { DEFAULT_ROW_LEVEL_SECURITY_MODE, type RowLevelSecurityMode } from "./db/render-rls-ddl.ts";
import { createRegistry } from "./engine/registry.ts";
import type { FeatureDefinition } from "./engine/types/feature.ts";
import {
  AggregateTypeRemovalError,
  type AggregateTypeRemovalResult,
  removeAggregateTypes,
} from "./pipeline/aggregate-type-removal.ts";
import { ensureTemporalPolyfill } from "./time/index.ts";

export type RunEventsCliOptions = {
  /** The composed app features: needed to validate types and to find the projections they feed. */
  readonly features: readonly FeatureDefinition[];
  /** The mode the app runs with (`AppConfig.rowLevelSecurity`); the removal runs in system scope. */
  readonly rowLevelSecurity?: RowLevelSecurityMode;
};

export type ParsedEventsPruneArgs =
  | { readonly ok: true; readonly types: readonly string[]; readonly apply: boolean }
  | { readonly ok: false; readonly error: string };

const AGGREGATE_TYPE_FLAG = "--aggregate-type";

// Accepts "--aggregate-type <t>" and "--aggregate-type=<t>", repeatable. An unknown flag is an
// error rather than ignored: a typo such as "--aggregate-types" must not turn into "delete nothing"
// or, worse, into a partial selection.
export function parseEventsPruneArgs(argv: readonly string[]): ParsedEventsPruneArgs {
  const types: string[] = [];
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--apply") {
      apply = true;
    } else if (arg === AGGREGATE_TYPE_FLAG) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, error: `${AGGREGATE_TYPE_FLAG} needs a value.` };
      }
      types.push(value);
      i++;
    } else if (arg.startsWith(`${AGGREGATE_TYPE_FLAG}=`)) {
      types.push(arg.slice(AGGREGATE_TYPE_FLAG.length + 1));
    } else {
      return { ok: false, error: `Unknown argument: ${arg}` };
    }
  }
  if (types.length === 0) {
    return { ok: false, error: `At least one ${AGGREGATE_TYPE_FLAG} is required.` };
  }
  if (types.some((type) => type.trim().length === 0)) {
    return { ok: false, error: `${AGGREGATE_TYPE_FLAG} must not be empty.` };
  }
  return { ok: true, types: [...new Set(types)], apply };
}

function printHelp(write: (line: string) => void): void {
  write("");
  write("  Subcommands:");
  write("    prune --aggregate-type <type> [--aggregate-type <type> ...] [--apply]");
  write("      Removes every event, snapshot, archive marker and dead letter of the given");
  write("      aggregate types, and empties the projections fed only by them.");
  write("      Without --apply it only reports counts.");
  write("");
}

function report(out: ConsumerCliOut, result: AggregateTypeRemovalResult): void {
  const { plan, deleted } = result;
  out.log("");
  for (const s of plan.stats) {
    out.log(
      `  ${s.aggregateType}: ${s.events} events, ${s.aggregates} aggregates, ${s.tenants} tenants`,
    );
  }
  for (const wiped of plan.wipedProjections) {
    const rows = deleted?.projectionRows[wiped.projection];
    out.log(
      `  projection ${wiped.projection} (${wiped.table.tableName}): ${rows === undefined ? "all rows would be deleted" : `${rows} rows deleted`}`,
    );
  }
  if (deleted === undefined) {
    out.log("");
    out.log("  Dry run, nothing deleted. Re-run with --apply to remove the above.");
  } else {
    out.log("");
    out.log(
      `  Deleted ${deleted.events} events, ${deleted.snapshots} snapshots, ${deleted.archivedStreams} archive markers, ` +
        `${deleted.upcasterDeadLetters + deleted.rebuildDeadLetters} dead letters.`,
    );
  }
  out.log("");
}

export async function runEventsCli(
  argv: readonly string[],
  out: ConsumerCliOut,
  options: RunEventsCliOptions,
): Promise<number> {
  // The standalone bundle never runs the app boot that installs Temporal; event rows carry
  // Temporal.Instant values.
  await ensureTemporalPolyfill();
  const [sub, ...rest] = argv;
  if (sub !== "prune") {
    if (sub !== undefined) out.err(`  Unknown subcommand: ${sub}`);
    printHelp(sub === undefined ? out.log : out.err);
    return sub === undefined ? 0 : 1;
  }
  const parsed = parseEventsPruneArgs(rest);
  if (!parsed.ok) {
    out.err(`  ${parsed.error}`);
    return 1;
  }
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) {
    out.err("  DATABASE_URL not set.");
    return 1;
  }
  const { db, close } = createDbConnection({
    url: dbUrl,
    rowLevelSecurity: options.rowLevelSecurity ?? DEFAULT_ROW_LEVEL_SECURITY_MODE,
    ...dbConnectionOptionsFromEnv(),
  });
  try {
    const result = await removeAggregateTypes(db, createRegistry(options.features), {
      types: parsed.types,
      apply: parsed.apply,
    });
    report(out, result);
    return 0;
  } catch (e) {
    out.err("");
    if (e instanceof AggregateTypeRemovalError) {
      out.err(`  ${e.message}`);
    } else {
      out.err(`  ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    }
    out.err("");
    return 1;
  } finally {
    await close();
  }
}
