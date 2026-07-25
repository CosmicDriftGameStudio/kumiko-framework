// Shared core for the standalone consumer-ops CLI (status | restart).
//
// A dead event consumer (halt-on-poison after maxAttempts) previously had no
// recovery surface in the standalone prod bundle — only raw SQL against
// kumiko_event_consumers. Mirrors schema-cli.ts's shape (single runXCli(argv,
// out) entry point, own DB connection) so `kumiko-consumer` ships the same
// way `kumiko-schema` does.

import { createConnection } from "./db/api";
import { dbConnectionOptionsFromEnv } from "./db/connection";
import { getConsumerState, restartConsumer } from "./pipeline";
import { ensureTemporalPolyfill } from "./time";

export type ConsumerCliOut = {
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
};

type ParsedConsumerCliArgs = {
  readonly sub: string | undefined;
  readonly name: string | undefined;
  readonly instanceId: string | undefined;
  readonly error: string | undefined;
};

// Single pass: pulls --instance-id (both "--instance-id <id>" and
// "--instance-id=<id>") out of argv regardless of position, leaving the
// remaining positionals for sub/name — instead of two independent
// positional/flag reads that silently misparse "--instance-id" with no
// value, the "=" form, or a flag placed before the positionals (#1412).
function parseConsumerCliArgs(argv: readonly string[]): ParsedConsumerCliArgs {
  const positionals: string[] = [];
  let instanceId: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--instance-id") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return {
          sub: undefined,
          name: undefined,
          instanceId: undefined,
          error: "--instance-id braucht einen Wert.",
        };
      }
      instanceId = value;
      i++;
      continue;
    }
    if (arg.startsWith("--instance-id=")) {
      instanceId = arg.slice("--instance-id=".length);
      continue;
    }
    positionals.push(arg);
  }
  return { sub: positionals[0], name: positionals[1], instanceId, error: undefined };
}

export async function runConsumerCli(
  argv: readonly string[],
  out: ConsumerCliOut,
): Promise<number> {
  // The standalone bundle never runs runProdApp/runDevApp's boot, which is
  // where Temporal normally gets installed — ConsumerRecoveryState.updatedAt
  // is a Temporal.Instant, so without this every subcommand throws "Temporal
  // is not defined" (same failure mode as schema-cli, see its polyfill test).
  await ensureTemporalPolyfill();
  const parsed = parseConsumerCliArgs(argv);
  if (parsed.error) {
    out.err(`  ${parsed.error}`);
    return 1;
  }
  const { sub, name, instanceId } = parsed;

  if (sub !== "status" && sub !== "restart") {
    // Unknown subcommand must be visible on stderr, not just a bare exit 1 —
    // ops invocations piping `2>&1 >/dev/null` or log pipelines that only
    // watch stderr would otherwise see a failure with zero explanation
    // (#1412). A bare help call (no subcommand at all) is not an error, so
    // it keeps exit 0 + stdout.
    const write = sub === undefined ? out.log : out.err;
    if (sub !== undefined) out.err(`  Unknown subcommand: ${sub}`);
    write("");
    write("  Subcommands:");
    write("    status <name> [--instance-id <id>]   Zeigt Status + Cursor eines Consumers");
    write("    restart <name> [--instance-id <id>]  Reaktiviert einen dead-Consumer (idle)");
    write("");
    return sub === undefined ? 0 : 1;
  }

  if (!name) {
    out.err(`  Usage: consumer ${sub} <name> [--instance-id <id>]`);
    return 1;
  }

  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) {
    out.err("  DATABASE_URL not set.");
    return 1;
  }
  const { db, close } = await createConnection(dbUrl, dbConnectionOptionsFromEnv());
  try {
    if (sub === "status") {
      const state = await getConsumerState(db, name, instanceId);
      if (!state) {
        out.err(`  Consumer "${name}" (instance_id="${instanceId ?? "__shared__"}") not found.`);
        return 1;
      }
      out.log("");
      out.log(`  ${state.name} (instance_id="${state.instanceId}")`);
      out.log(`    status:      ${state.status}`);
      out.log(`    cursor:      ${state.lastProcessedEventId}`);
      out.log(`    attempts:    ${state.attempts}`);
      out.log(`    rearmCount:  ${state.rearmCount}`);
      out.log(`    lastError:   ${state.lastError ?? "-"}`);
      out.log(`    updatedAt:   ${state.updatedAt.toString()}`);
      out.log("");
      return 0;
    }

    // restart
    const result = await restartConsumer(db, name, instanceId);
    out.log("");
    out.log(`  ✓ ${result.name} (instance_id="${result.instanceId}") → ${result.status}`);
    out.log("");
    return 0;
  } catch (e) {
    out.err(`  ✗ ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await close();
  }
}
