// Shared core for the standalone consumer-ops CLI (status | restart).
//
// A dead event consumer (halt-on-poison after maxAttempts) previously had no
// recovery surface in the standalone prod bundle — only raw SQL against
// kumiko_event_consumers. Mirrors schema-cli.ts's shape (single runXCli(argv,
// out) entry point, own DB connection) so `kumiko-consumer` ships the same
// way `kumiko-schema` does.

import { createDbConnection } from "./db";
import { getConsumerState, restartConsumer } from "./pipeline";
import { ensureTemporalPolyfill } from "./time";

export type ConsumerCliOut = {
  readonly log: (line: string) => void;
  readonly err: (line: string) => void;
};

function parseInstanceIdFlag(argv: readonly string[]): string | undefined {
  const i = argv.indexOf("--instance-id");
  return i === -1 ? undefined : argv[i + 1];
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
  const sub = argv[0];

  if (sub !== "status" && sub !== "restart") {
    out.log("");
    out.log("  Subcommands:");
    out.log("    status <name> [--instance-id <id>]   Zeigt Status + Cursor eines Consumers");
    out.log("    restart <name> [--instance-id <id>]  Reaktiviert einen dead-Consumer (idle)");
    out.log("");
    return sub === undefined ? 0 : 1;
  }

  const name = argv[1];
  if (!name) {
    out.err(`  Usage: consumer ${sub} <name> [--instance-id <id>]`);
    return 1;
  }
  const instanceId = parseInstanceIdFlag(argv);

  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) {
    out.err("  DATABASE_URL not set.");
    return 1;
  }
  const { db, close } = createDbConnection(dbUrl);
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
