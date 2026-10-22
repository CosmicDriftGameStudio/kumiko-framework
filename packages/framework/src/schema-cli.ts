// Shared core for the schema-migration CLI (generate | apply | baseline | status).
//
// Used by BOTH the dev `kumiko schema` command (bin/commands/schema.ts) and the
// shipped `kumiko-schema` bin (dev-server) — so apps run migrations without the
// full dev-CLI registry (which eager-loads ts-morph-heavy dev commands).
//
// NO-MAGIC-ON-DATA: reads only checked-in artifacts (kumiko/schema.ts →
// ENTITY_METAS, kumiko/migrations/*.sql). Never auto-generates at runtime,
// never applies on app-boot — apply/baseline are explicit deploy-steps.

import { resolve as resolvePath } from "node:path";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { runApplyCommand } from "./schema-cli/apply-command.ts";
import { runBaselineCommand } from "./schema-cli/baseline-command.ts";
import { runGenerateCommand } from "./schema-cli/generate-command.ts";
import type {
  RunSchemaCliOptions,
  SchemaCliOut,
  SchemaSubcommandHandler,
} from "./schema-cli/shared.ts";
import { runStatusCommand } from "./schema-cli/status-command.ts";
import { runValidateCommand } from "./schema-cli/validate-command.ts";
import { ensureTemporalPolyfill } from "./time/index.ts";

export type { RunSchemaCliOptions, SchemaCliOut } from "./schema-cli/shared.ts";

const SCHEMA_SUBCOMMANDS = ["generate", "validate", "apply", "baseline", "status"] as const;
type SchemaSubcommand = (typeof SCHEMA_SUBCOMMANDS)[number];

const SCHEMA_SUBCOMMAND_HANDLERS: Readonly<Record<SchemaSubcommand, SchemaSubcommandHandler>> = {
  generate: runGenerateCommand,
  validate: runValidateCommand,
  apply: runApplyCommand,
  baseline: runBaselineCommand,
  status: runStatusCommand,
};

const HELP_ARGS = ["--help", "-h", "help"] as const;

function printSchemaCliUsage(out: SchemaCliOut): number {
  out.log("");
  out.log("  Subcommands:");
  out.log("    generate <name>   Write a new migration from the EntityTableMeta diff");
  out.log("    validate          Static CI gate (no DB): schema drift + validateBoot");
  out.log("    apply             Apply pending checked-in SQL files");
  out.log("    baseline          Mark checked-in migrations as applied (no SQL run)");
  out.log("    status            List applied vs pending");
  out.log("");
  return 0;
}

function reportUnknownSubcommand(out: SchemaCliOut, sub: string): number {
  out.err(`  Unknown subcommand: "${sub}"`);
  out.err(`  Allowed: ${SCHEMA_SUBCOMMANDS.join(" | ")}`);
  return 1;
}

/**
 * Runs a schema-CLI subcommand. `appCwd` is the app workspace root (where
 * `kumiko/schema.ts` + `kumiko/migrations/` live). Returns a process exit code.
 */
export async function runSchemaCli(
  argv: readonly string[],
  appCwd: string,
  out: SchemaCliOut,
  options: RunSchemaCliOptions = {},
): Promise<number> {
  // Runtime guard for untyped callers: the rebuild after `apply` needs the
  // slots, and failing there would leave migrations applied but unrebuilt.
  if (options.features && !options.kmsSlots) {
    out.err(
      "runSchemaCli: `features` requires `kmsSlots` — pass kmsSlots: kmsSlotsOf(<composedEnv>.schema), " +
        "or [] when the app wires no Key Manager slots.",
    );
    return 1;
  }
  // runProdApp/runDevApp install this at boot; the standalone CLI (the
  // migrate-db initContainer, `bun kumiko.js schema apply`) never goes through
  // that boot path, so a projection rebuild's tz/timestamp coercion throws
  // "Temporal is not defined" — deterministically, on every rebuild-marker
  // migration, since the crashed process still records the migration as
  // applied and the rebuild is never retried.
  await ensureTemporalPolyfill();
  const rawSub = argv[0];
  // No subcommand (`kumiko schema`) is a help request → usage + exit 0.
  // `--help`/`-h`/`help` are the same — a real request for help, not a typo
  // that should fail loud like an unrecognized subcommand does.
  if (rawSub === undefined || isOneOf(HELP_ARGS, rawSub)) return printSchemaCliUsage(out);
  // An unrecognized subcommand (typo, e.g. `schema cutover`) must fail loud —
  // silently exiting 0 here let a deploy's migrate step print help and
  // move on without ever running a migration.
  if (!isOneOf(SCHEMA_SUBCOMMANDS, rawSub)) return reportUnknownSubcommand(out, rawSub);
  return SCHEMA_SUBCOMMAND_HANDLERS[rawSub]({
    argv,
    out,
    options,
    schemaFile: resolvePath(appCwd, "kumiko/schema.ts"),
    migrationsDir: resolvePath(appCwd, "kumiko/migrations"),
  });
}
