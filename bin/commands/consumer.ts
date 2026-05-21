import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineCommand } from "./registry";

export const consumerCommand = defineCommand({
  id: "consumer",
  label: "consumer",
  description: "Event-Consumer verwalten (list | status | restart | disable | enable | skip)",
  help: "Subcommands:\n  list                 Alle Consumer + ihr State\n  status <name>        Detail-State\n  restart <name>       Lock release + retry\n  disable <name>       Pausiert den Consumer\n  enable <name>        Reaktiviert\n  skip <name>          Springt das aktuell-feststeckende Event\n",
  category: "ops",
  roles: ["maintainer"],
  run: async (ctx) => {
    const sub = ctx.argv[0];
    const arg = ctx.argv[1];

    const configPath = join(ctx.cwd, "kumiko.config.ts");
    if (!existsSync(configPath)) {
      ctx.out.err("");
      ctx.out.err(`  kumiko.config.ts nicht gefunden: ${configPath}`);
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

    const config = (await import(configPath)).default as {
      features: readonly import("@cosmicdrift/kumiko-framework/engine").FeatureDefinition[];
    };
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
    const { db, close } = createDbConnection(databaseUrl);
    await createEventConsumerStateTable(db);

    const registeredConsumerNames = [
      SSE_BROADCAST_CONSUMER_NAME,
      SEARCH_CONSUMER_NAME,
      ...registry.getAllMultiStreamProjections().keys(),
    ];

    const printOutcome = (prefix: string, state: { name: string; status: string }): void => {
      ctx.out.log("");
      ctx.out.log(`  ✓ ${prefix} ${state.name} → ${state.status}`);
      ctx.out.log("");
    };

    try {
      switch (sub) {
        case "list": {
          const entries = await listConsumersWithState(db, registeredConsumerNames);
          if (entries.length === 0) {
            ctx.out.log("");
            ctx.out.log("  Keine Event-Consumer registriert.");
            ctx.out.log("");
            return 0;
          }
          ctx.out.log("");
          ctx.out.log("  Registrierte Event-Consumer:");
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
        case "status": {
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
              ctx.out.err(`  Consumer "${arg}" ist nicht registriert.`);
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
        case "restart": {
          if (!arg) return usage(ctx, "restart");
          const state = await restartConsumer(db, arg);
          printOutcome("restarted", state);
          return 0;
        }
        case "disable": {
          if (!arg) return usage(ctx, "disable");
          const state = await disableConsumer(db, arg);
          printOutcome("disabled", state);
          return 0;
        }
        case "enable": {
          if (!arg) return usage(ctx, "enable");
          const state = await enableConsumer(db, arg);
          printOutcome("enabled", state);
          return 0;
        }
        case "skip": {
          if (!arg) return usage(ctx, "skip");
          const state = await skipPoisonEvent(db, arg);
          if (state.skippedEventId === null) {
            ctx.out.log("");
            ctx.out.log(`  ~ ${state.name}: cursor already at head — nothing to skip.`);
            ctx.out.log("");
          } else {
            printOutcome(`skipped event ${state.skippedEventId},`, state);
          }
          return 0;
        }
        default:
          ctx.out.log("");
          ctx.out.log("  Usage: kumiko consumer <list | status | restart | disable | enable | skip> <name>");
          ctx.out.log("");
          return 1;
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
});

function usage(ctx: { out: { err: (m: string) => void } }, sub: string): number {
  ctx.out.err("");
  ctx.out.err(`  Usage: kumiko consumer ${sub} <consumer-name>`);
  ctx.out.err("");
  return 1;
}
