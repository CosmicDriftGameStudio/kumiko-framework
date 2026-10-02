import { join } from "node:path";
import { loadAppConfig } from "./load-app-config";
import type { CliCommand, CliCommandContext } from "./types";

const CONSUMER_SUBCOMMANDS = ["list", "status", "restart", "disable", "enable", "skip"] as const;
type ConsumerSubcommand = (typeof CONSUMER_SUBCOMMANDS)[number];

function isConsumerSubcommand(value: string | undefined): value is ConsumerSubcommand {
  return CONSUMER_SUBCOMMANDS.some((known) => known === value);
}

export const consumerCommand: CliCommand = {
  id: "consumer",
  description: "Manage event consumers (list | status | restart | disable | enable | skip)",
  help: "Subcommands:\n  list                 List all consumers and their state\n  status <name>        Show detail state for one consumer\n  restart <name>       Release lock and retry\n  disable <name>       Pause the consumer\n  enable <name>        Reactivate\n  skip <name>          Skip the currently-stuck event\n",
  run: async (ctx) => {
    const sub = ctx.argv[0];
    const arg = ctx.argv[1];

    if (!isConsumerSubcommand(sub)) {
      ctx.out.err("");
      ctx.out.err(`  Usage: kumiko consumer <${CONSUMER_SUBCOMMANDS.join(" | ")}> <name>`);
      ctx.out.err("");
      return 1;
    }

    const configPath = join(ctx.cwd, "kumiko.config.ts");
    if (!(await Bun.file(configPath).exists())) {
      ctx.out.err("");
      ctx.out.err(`  kumiko.config.ts not found at: ${configPath}`);
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

    const config = await loadAppConfig(ctx, configPath);
    if (config === null) return 1;
    const { createRegistry } = await import("@cosmicdrift/kumiko-framework/engine");
    const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db");
    const {
      createEventConsumerStateTable,
      disableConsumer,
      enableConsumer,
      getConsumerState,
      listConsumersWithState,
      restartConsumer,
      skipPoisonEvent,
      SEARCH_CONSUMER_NAME,
      SSE_BROADCAST_CONSUMER_NAME,
    } = await import("@cosmicdrift/kumiko-framework/pipeline");

    const registry = createRegistry(config.features);
    const registeredConsumerNames = [
      SSE_BROADCAST_CONSUMER_NAME,
      SEARCH_CONSUMER_NAME,
      ...registry.getAllMultiStreamProjections().keys(),
    ];
    const { db, close } = createDbConnection(databaseUrl);

    try {
      await createEventConsumerStateTable(db);
      switch (sub) {
        case "list":
          return await listConsumers(ctx, db, registeredConsumerNames, listConsumersWithState);
        case "status":
          return await showConsumerStatus(ctx, db, arg, registeredConsumerNames, getConsumerState);
        case "restart":
          return await transitionOne(ctx, "restart", arg, "restarted", (name) =>
            restartConsumer(db, name),
          );
        case "disable":
          return await transitionOne(ctx, "disable", arg, "disabled", (name) =>
            disableConsumer(db, name),
          );
        case "enable":
          return await transitionOne(ctx, "enable", arg, "enabled", (name) =>
            enableConsumer(db, name),
          );
        case "skip":
          return await skipOne(ctx, db, arg, skipPoisonEvent);
      }
    } catch (e) {
      ctx.out.err("");
      ctx.out.err(`  ✗ ${e instanceof Error ? e.message : String(e)}`);
      ctx.out.err("");
      return 1;
    } finally {
      await close();
    }
  },
};

function usage(ctx: CliCommandContext, sub: string): number {
  ctx.out.err("");
  ctx.out.err(`  Usage: kumiko consumer ${sub} <consumer-name>`);
  ctx.out.err("");
  return 1;
}

async function listConsumers(
  ctx: CliCommandContext,
  db: import("@cosmicdrift/kumiko-framework/db").DbConnection,
  registeredConsumerNames: readonly string[],
  listConsumersWithState: typeof import("@cosmicdrift/kumiko-framework/pipeline").listConsumersWithState,
): Promise<number> {
  const entries = await listConsumersWithState(db, registeredConsumerNames);
  if (entries.length === 0) {
    ctx.out.log("");
    ctx.out.log("  No event consumers registered.");
    ctx.out.log("");
    return 0;
  }
  ctx.out.log("");
  ctx.out.log("  Registered event consumers:");
  ctx.out.log("");
  for (const e of entries) {
    const errHint = e.lastError ? ` error=${e.lastError.slice(0, 60)}` : "";
    ctx.out.log(
      `    ${e.name.padEnd(44)} ${e.status.padEnd(15)} cursor=${e.lastProcessedEventId} attempts=${e.attempts}${errHint}`,
    );
  }
  ctx.out.log("");
  return 0;
}

async function showConsumerStatus(
  ctx: CliCommandContext,
  db: import("@cosmicdrift/kumiko-framework/db").DbConnection,
  arg: string | undefined,
  registeredConsumerNames: readonly string[],
  getConsumerState: typeof import("@cosmicdrift/kumiko-framework/pipeline").getConsumerState,
): Promise<number> {
  if (!arg) {
    ctx.out.err("");
    ctx.out.err("  Usage: kumiko consumer status <consumer-name>");
    ctx.out.err("");
    return 1;
  }
  const state = await getConsumerState(db, arg);
  if (!state) {
    if (!registeredConsumerNames.includes(arg)) {
      ctx.out.err("");
      ctx.out.err(`  Consumer "${arg}" is not registered.`);
      ctx.out.err("");
      return 1;
    }
    ctx.out.log("");
    ctx.out.log(`  ${arg}: never-run`);
    ctx.out.log("");
    return 0;
  }
  ctx.out.log("");
  ctx.out.log(`  ${state.name}`);
  ctx.out.log(`    status:        ${state.status}`);
  ctx.out.log(`    last event id: ${state.lastProcessedEventId}`);
  ctx.out.log(`    attempts:      ${state.attempts}`);
  ctx.out.log(`    updated at:    ${String(state.updatedAt)}`);
  if (state.lastError) {
    ctx.out.log(`    last error:    ${state.lastError}`);
  }
  ctx.out.log("");
  return 0;
}

async function transitionOne(
  ctx: CliCommandContext,
  sub: string,
  arg: string | undefined,
  verb: string,
  transition: (name: string) => Promise<{ name: string; status: string }>,
): Promise<number> {
  if (!arg) return usage(ctx, sub);
  printOutcome(ctx, verb, await transition(arg));
  return 0;
}

function printOutcome(
  ctx: CliCommandContext,
  prefix: string,
  state: { name: string; status: string },
): void {
  ctx.out.log("");
  ctx.out.log(`  ✓ ${prefix} ${state.name} → ${state.status}`);
  ctx.out.log("");
}

async function skipOne(
  ctx: CliCommandContext,
  db: import("@cosmicdrift/kumiko-framework/db").DbConnection,
  arg: string | undefined,
  skipPoisonEvent: typeof import("@cosmicdrift/kumiko-framework/pipeline").skipPoisonEvent,
): Promise<number> {
  if (!arg) return usage(ctx, "skip");
  const state = await skipPoisonEvent(db, arg);
  if (state.skippedEventId === null) {
    ctx.out.log("");
    ctx.out.log(`  ~ ${state.name}: cursor already at head — nothing to skip.`);
    ctx.out.log("");
  } else {
    printOutcome(ctx, `skipped event ${state.skippedEventId},`, state);
  }
  return 0;
}
