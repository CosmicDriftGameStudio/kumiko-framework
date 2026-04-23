#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "node:fs";

// Suppress Node's deprecation warnings (notably DEP0169 url.parse, emitted
// by yarn-classic's own url handling — not our code). Using --no-deprecation
// is surgical: only Deprecation-class warnings are silenced, unhandled-
// promise and other runtime warnings still surface. Inherited by child
// processes through the environment.
process.env["NODE_OPTIONS"] = [process.env["NODE_OPTIONS"], "--no-deprecation"]
  .filter(Boolean)
  .join(" ");

// --- ENV Check ---

const REQUIRED_ENVS = {
  DATABASE_URL: "PostgreSQL connection string",
  TEST_DATABASE_URL: "PostgreSQL test DB connection string",
  REDIS_URL: "Redis connection string",
  MEILI_URL: "Meilisearch URL",
  MEILI_MASTER_KEY: "Meilisearch master key",
  JWT_SECRET: "JWT signing secret",
} as const;

function checkEnv(): void {
  if (!existsSync(".env")) {
    console.warn("\n  No .env yet — you'll probably want one. Try: cp .env.example .env\n");
    return;
  }

  const missing: string[] = [];
  for (const [name, desc] of Object.entries(REQUIRED_ENVS)) {
    if (!Bun.env[name]) missing.push(`  ${name} — ${desc}`);
  }

  if (missing.length > 0) {
    console.warn(`\n  Hmm, da fehlt was:\n${missing.join("\n")}\n  -> cp .env.example .env\n`);
  } else {
    console.log("  ENV ok");
  }
}

// --- Banner ---

type Slogan = { readonly claim: string; readonly fineprint: string };

const SLOGANS: readonly Slogan[] = [
  { claim: "The fastest framework in the known universe.", fineprint: "universe limited to n=1." },
  { claim: "100% of developers agree Kumiko is the greatest framework ever built.", fineprint: "we asked the author." },
  { claim: "The most enterprise-ready framework of all time.", fineprint: "all time begins at day one. Day one hasn't arrived yet." },
  { claim: "The most battle-tested framework in human history.", fineprint: "history of demo samples." },
  { claim: "The multi-tenantest multi-tenant framework ever conceived.", fineprint: "tenant count: 1. Named 'test'." },
  { claim: "The most zero-config framework on planet Earth.", fineprint: "after the mandatory 47-step setup. On planet Earth." },
  { claim: "The realtime-est realtime framework in existence.", fineprint: "<1ms latency, on localhost, Wi-Fi off, in a Faraday cage." },
  { claim: "Scales to the most users imaginable.", fineprint: "imagination limited by Postgres, Redis, Meilisearch, and your wallet." },
  { claim: "The type-safest framework ever written by human hands.", fineprint: "`any` is still also a type." },
  { claim: "The definitive framework for framework frameworks.", fineprint: "" },
  { claim: "Works on more machines than any framework before it.", fineprint: "machines in sample: 1. The author's." },
  { claim: "Now with more features than any framework in recorded history.", fineprint: "than when we started counting this morning." },
  { claim: "The most revolutionary framework since the last revolution.", fineprint: "" },
  { claim: "Quite possibly the single greatest framework of the 21st century.", fineprint: "century still in progress. Results may vary." },
  { claim: "The most award-winning framework never to win an award.", fineprint: "award categories still being invented." },
];

function banner(): void {
  const slogan = SLOGANS[Math.floor(Math.random() * SLOGANS.length)] as Slogan;
  const cyan = "\x1b[36m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";

  console.log();
  console.log(`     ✨  ⭐   ✨    ⭐    ✨   ⭐   ✨`);
  console.log(`${cyan}  ██╗  ██╗██╗   ██╗███╗   ███╗██╗██╗  ██╗ ██████╗ ${reset}`);
  console.log(`${cyan}  ██║ ██╔╝██║   ██║████╗ ████║██║██║ ██╔╝██╔═══██╗${reset}`);
  console.log(`${cyan}  █████╔╝ ██║   ██║██╔████╔██║██║█████╔╝ ██║   ██║${reset}`);
  console.log(`${cyan}  ██╔═██╗ ██║   ██║██║╚██╔╝██║██║██╔═██╗ ██║   ██║${reset}`);
  console.log(`${cyan}  ██║  ██╗╚██████╔╝██║ ╚═╝ ██║██║██║  ██╗╚██████╔╝${reset}`);
  console.log(`${cyan}  ╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝╚═╝  ╚═╝ ╚═════╝ ${reset}`);
  console.log(`      🍺   ✨   🍺    ⭐    🍺   ✨   🍺`);
  console.log();
  console.log(`  ${slogan.claim}${slogan.fineprint ? "*" : ""}`);
  if (slogan.fineprint) {
    console.log(`${dim}  * ${slogan.fineprint}${reset}`);
  }
  console.log();
}

// --- Commands ---

const commands = {
  dev: {
    description: "Feuer frei! Docker Services hochfahren",
    run: async () => {
      console.log("Wecke PostgreSQL und Redis auf...");
      await $`docker compose up -d`.quiet();
      await waitForPostgres();
      console.log(`  PostgreSQL   localhost:${Bun.env.KUMIKO_PG_PORT ?? "15432"}`);
      console.log(`  Redis        localhost:${Bun.env.KUMIKO_REDIS_PORT ?? "16379"}`);
      console.log(`  Meilisearch  localhost:${Bun.env.KUMIKO_MEILI_PORT ?? "17700"}`);
      console.log("\nLaeuft! Happy coding.");
    },
  },

  stop: {
    description: "Feierabend. Docker Services stoppen",
    run: async () => {
      console.log("Fahre alles runter...");
      await $`docker compose down`.quiet();
      console.log("Alles aus. Bis morgen!");
    },
  },

  reset: {
    description: "Tabula rasa. Alles platt, alles neu",
    run: async () => {
      console.log("Loesche alles und starte frisch...");
      await $`docker compose down -v`.quiet();
      await $`docker compose up -d`.quiet();
      await waitForPostgres();
      console.log("Wie neu. Kein Byte ueberlebt.");
    },
  },

  "clean-test-dbs": {
    description: "Verwaiste kumiko_test_* DBs loeschen (SIGKILLed Tests, abgebrochene Runs)",
    run: async () => {
      const dryRun = Bun.argv.includes("--dry-run");
      if (dryRun) {
        await $`bun run scripts/cleanup-test-dbs.ts --dry-run`;
      } else {
        await $`bun run scripts/cleanup-test-dbs.ts`;
      }
    },
  },

  test: {
    description: "Tests laufen lassen (test | integration | all | <path>)",
    run: async () => {
      const scope = Bun.argv[3];
      if (scope === "all") {
        console.log("Volle Breitseite — Unit + Integration...\n");
        await $`node vitest.integration.guard.js`;
        await $`yarn vitest run`;
        await $`yarn vitest run --config vitest.integration.config.ts`;
      } else if (scope === "integration") {
        console.log("Integration Tests (Docker muss laufen)...\n");
        await $`node vitest.integration.guard.js`;
        await $`yarn vitest run --config vitest.integration.config.ts`;
      } else if (scope) {
        await $`yarn vitest run ${scope}`;
      } else {
        await $`yarn vitest run`;
      }
    },
  },

  check: {
    description: "Alles pruefen: Lint, Types, Tests",
    run: async () => {
      console.log("Checke alles durch...\n");
      const results: Array<{ name: string; ok: boolean }> = [];

      for (const [name, cmd] of [
        ["Biome", "yarn biome check ."],
        ["TypeScript", "yarn tsc --noEmit -p packages/framework/tsconfig.json && yarn tsc --noEmit -p packages/bundled-features/tsconfig.json"],
        ["Silent-Skip Guard", "yarn tsx scripts/guard-silent-skip.ts"],
        ["Admin-API Guard", "yarn tsx scripts/guard-admin-api.ts"],
        ["Unsafe-JSON-Parse Guard", "yarn tsx scripts/guard-unsafe-json-parse.ts"],
        ["No-Date-API Guard", "yarn tsx scripts/guard-no-date-api.ts"],
        ["Cross-Feature-Import Guard", "yarn tsx scripts/guard-cross-feature-imports.ts"],
        ["Renderer-Boundaries Guard", "yarn tsx scripts/guard-renderer-boundaries.ts"],
        ["Fake-Test Guard", "yarn tsx scripts/guard-fake-tests.ts"],
        ["Feature-Integration-Test Guard", "yarn tsx scripts/guard-feature-integration-tests.ts"],
        ["i18n-Keys Guard", "yarn tsx scripts/guard-i18n-keys.ts"],
        ["Test-Stack-Drift Guard", "yarn tsx scripts/guard-test-stack-drift.ts"],
        ["Error-Reasons Guard", "yarn tsx scripts/guard-error-reasons.ts"],
        ["Predicate Extraction Check", "yarn tsx scripts/check-predicates.ts"],
        ["as-Cast Audit", "yarn tsx scripts/check-as-casts.ts"],
        ["License Check", "yarn tsx scripts/check-licenses.ts"],
        ["Unit Tests", "yarn vitest run"],
        ["Integration Guard", "node vitest.integration.guard.js"],
        ["Integration Tests", "yarn vitest run --config vitest.integration.config.ts"],
      ] as const) {
        console.log(`--- ${name} ---`);
        try {
          await $`${{ raw: cmd }}`;
          results.push({ name, ok: true });
        } catch {
          results.push({ name, ok: false });
        }
        console.log();
      }

      const allGood = results.every((r) => r.ok);
      console.log(allGood ? "Alles im gruenen Bereich!" : "Da gibt's was zu tun:");
      for (const r of results) {
        console.log(`  ${r.ok ? "PASS" : "FAIL"} ${r.name}`);
      }

      if (!allGood) process.exit(1);
    },
  },

  migrate: {
    description: "DB-Schema migrieren (push | generate | status)",
    run: async () => {
      const subCommand = Bun.argv[3];

      // Always regenerate schema from entities first
      console.log("Generiere Schema aus Entity-Definitionen...");
      await $`bun run drizzle/generate.ts`;

      switch (subCommand) {
        case "generate":
          // Generate SQL migration files (for production)
          console.log("\nGeneriere Migration-Files...");
          await $`yarn drizzle-kit generate`;
          break;
        case "status":
          // Show what would change (dry-run)
          console.log("\nPrüfe Aenderungen...");
          try {
            await $`yarn drizzle-kit check`;
          } catch {
            console.log("  Schema-Aenderungen erkannt. Nutze 'yarn kumiko migrate' zum Anwenden.");
          }
          break;
        case "drop":
          // Drop a migration
          await $`yarn drizzle-kit drop`;
          break;
        default:
          // Default: push schema directly (dev workflow)
          console.log("\nWende Schema-Aenderungen an...");
          await $`yarn drizzle-kit push`;
          console.log("\nDB ist aktuell.");
          break;
      }
    },
  },

  status: {
    description: "Was geht? Services, Git, alles auf einen Blick",
    run: async () => {
      // Docker services
      console.log("--- Services ---");
      try {
        const result = await $`docker compose ps --format json`.quiet();
        const lines = result.stdout.toString().trim().split("\n").filter(Boolean);
        for (const line of lines) {
          const svc = JSON.parse(line) as { Service: string; State: string; Ports: string };
          console.log(`  ${svc.Service}: ${svc.State} (${svc.Ports || "no ports"})`);
        }
      } catch {
        console.log("  Docker services not running");
      }

      // Git
      console.log("\n--- Git ---");
      const branch = await $`git branch --show-current`.quiet();
      const status = await $`git status --short`.quiet();
      console.log(`  Branch: ${branch.stdout.toString().trim()}`);
      const changes = status.stdout.toString().trim();
      console.log(changes ? `  Changes:\n${changes.split("\n").map((l) => `    ${l}`).join("\n")}` : "  Clean");
    },
  },

  project: {
    description: "Projections verwalten (list | status <name> | rebuild <name>)",
    run: async () => {
      const subCommand = Bun.argv[3];
      const arg = Bun.argv[4];

      // Load features via convention: ./kumiko.config.ts in cwd exports
      // { features: FeatureDefinition[] }. Kumiko-Core doesn't know which
      // features a given app has wired, so the app tells us. No config =
      // helpful error with the exact file it tried.
      const configPath = `${process.cwd()}/kumiko.config.ts`;
      if (!existsSync(configPath)) {
        console.error(
          `\n  kumiko.config.ts nicht gefunden: ${configPath}\n\n` +
            `  Erstelle eine Datei, die deine features exportiert:\n\n` +
            `    // kumiko.config.ts\n` +
            `    import { myFeature } from "./src/features/my-feature";\n` +
            `    export default { features: [myFeature] };\n`,
        );
        process.exit(1);
      }
      const config = (await import(configPath)).default as {
        features: readonly import("@kumiko/framework/engine").FeatureDefinition[];
      };

      const { createRegistry } = await import("@kumiko/framework/engine");
      const { createDbConnection } = await import("@kumiko/framework/db");
      const {
        listProjectionsWithState,
        getProjectionState,
        rebuildProjection,
        createProjectionStateTable,
      } = await import("@kumiko/framework/pipeline");

      const registry = createRegistry(config.features);
      const databaseUrl = Bun.env["DATABASE_URL"];
      if (!databaseUrl) {
        console.error("\n  DATABASE_URL not set. Run against a configured env.\n");
        process.exit(1);
      }
      const { db, close } = createDbConnection(databaseUrl);
      await createProjectionStateTable(db);

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const green = "\x1b[32m";
      const red = "\x1b[31m";
      const yellow = "\x1b[33m";

      function colorStatus(status: string): string {
        if (status === "idle") return `${green}${status}${reset}`;
        if (status === "failed") return `${red}${status}${reset}`;
        if (status === "rebuilding") return `${yellow}${status}${reset}`;
        return `${dim}${status}${reset}`;
      }

      switch (subCommand) {
        case "list": {
          const entries = await listProjectionsWithState(db, registry);
          if (entries.length === 0) {
            console.log("\n  Keine Projections registriert.\n");
            break;
          }
          console.log("\n  Registrierte Projections:\n");
          for (const e of entries) {
            const when = e.lastRebuildAt
              ? e.lastRebuildAt.toISOString()
              : `${dim}never${reset}`;
            console.log(
              `    ${e.name.padEnd(40)} ${colorStatus(e.status).padEnd(25)} source=${e.sources.join(
                ",",
              )} last=${when}`,
            );
          }
          console.log();
          break;
        }

        case "status": {
          if (!arg) {
            console.error("\n  Usage: yarn kumiko project status <projection-name>\n");
            process.exit(1);
          }
          const state = await getProjectionState(db, arg);
          if (!state) {
            // Check if the projection is at least registered.
            const registered = registry.getAllProjections().has(arg);
            if (!registered) {
              console.error(`\n  Projection "${arg}" ist nicht registriert.\n`);
              process.exit(1);
            }
            console.log(`\n  ${arg}: ${dim}never-rebuilt${reset}\n`);
            break;
          }
          console.log(`\n  ${state.name}`);
          console.log(`    status:        ${colorStatus(state.status)}`);
          console.log(`    last event id: ${state.lastProcessedEventId}`);
          console.log(
            `    last rebuild:  ${state.lastRebuildAt?.toISOString() ?? `${dim}never${reset}`}`,
          );
          console.log(`    updated at:    ${state.updatedAt.toISOString()}`);
          if (state.lastError) {
            console.log(`    last error:    ${red}${state.lastError}${reset}`);
          }
          console.log();
          break;
        }

        case "rebuild": {
          if (!arg) {
            console.error("\n  Usage: yarn kumiko project rebuild <projection-name>\n");
            process.exit(1);
          }
          console.log(`\n  Rebuilding ${arg} ...`);
          try {
            const result = await rebuildProjection(arg, { db, registry });
            console.log(
              `\n  ${green}✓${reset} ${result.projection}: ${result.eventsProcessed} events, ${result.durationMs}ms\n`,
            );
          } catch (e) {
            console.error(
              `\n  ${red}✗${reset} Rebuild failed: ${e instanceof Error ? e.message : e}\n`,
            );
            process.exit(1);
          }
          break;
        }

        default:
          console.log("\n  Usage: yarn kumiko project <list | status <name> | rebuild <name>>\n");
          await close();
          process.exit(1);
      }

      // Release the postgres pool so the CLI process can exit cleanly
      // instead of hanging on the idle connection.
      await close();
    },
  },

  events: {
    description: "Events-Tabelle verwalten (prune [--older-than <days>] [--dry-run])",
    run: async () => {
      const subCommand = Bun.argv[3];

      if (subCommand !== "prune") {
        console.log("\n  Usage: yarn kumiko events prune [--older-than <days>] [--dry-run]\n");
        process.exit(1);
      }

      // Simple flag parsing — no positional args here, so flags can appear
      // in any order.
      let olderThanDays = 30;
      let dryRun = false;
      for (let i = 4; i < Bun.argv.length; i++) {
        const flag = Bun.argv[i];
        if (flag === "--older-than") {
          olderThanDays = Number(Bun.argv[++i]);
          if (!Number.isFinite(olderThanDays) || olderThanDays <= 0) {
            console.error("\n  --older-than requires a positive number (days)\n");
            process.exit(1);
          }
        } else if (flag === "--dry-run") {
          dryRun = true;
        }
      }

      const { createDbConnection } = await import("@kumiko/framework/db");
      const { ConsumerLagError, pruneEvents } = await import("@kumiko/framework/pipeline");

      const databaseUrl = Bun.env["DATABASE_URL"];
      if (!databaseUrl) {
        console.error("\n  DATABASE_URL not set. Run against a configured env.\n");
        process.exit(1);
      }
      const { db, close } = createDbConnection(databaseUrl);
      const green = "\x1b[32m";
      const yellow = "\x1b[33m";
      const red = "\x1b[31m";
      const dim = "\x1b[2m";
      const reset = "\x1b[0m";

      try {
        const result = await pruneEvents(db, { olderThanDays, dryRun });
        const verb = dryRun ? "would delete" : "deleted";
        const mark = dryRun ? yellow : green;
        console.log(
          `\n  ${mark}✓${reset} ${verb} ${result.deletedCount} event(s) ` +
            `older than ${result.cutoff.toISOString()} ` +
            `(aggregateType=${result.aggregateTypes.join(",")})\n`,
        );
        if (result.dryRun) {
          console.log(`    ${dim}Drop --dry-run to actually delete.${reset}\n`);
        }
      } catch (e) {
        if (e instanceof ConsumerLagError) {
          console.error(`\n  ${red}✗${reset} ${e.message}\n`);
          console.error(
            `    ${dim}Options: catch up the consumer, disable it, or "yarn kumiko consumer skip <name>".${reset}\n`,
          );
        } else {
          console.error(`\n  ${red}✗${reset} ${e instanceof Error ? e.message : String(e)}\n`);
        }
        await close();
        process.exit(1);
      }
      await close();
    },
  },

  consumer: {
    description:
      "Event-Consumer verwalten (list | status <name> | restart <name> | disable <name> | enable <name> | skip <name>)",
    run: async () => {
      const subCommand = Bun.argv[3];
      const arg = Bun.argv[4];

      const configPath = `${process.cwd()}/kumiko.config.ts`;
      if (!existsSync(configPath)) {
        console.error(
          `\n  kumiko.config.ts nicht gefunden: ${configPath}\n\n` +
            `  Erstelle eine Datei, die deine features exportiert:\n\n` +
            `    // kumiko.config.ts\n` +
            `    import { myFeature } from "./src/features/my-feature";\n` +
            `    export default { features: [myFeature] };\n`,
        );
        process.exit(1);
      }
      const config = (await import(configPath)).default as {
        features: readonly import("@kumiko/framework/engine").FeatureDefinition[];
      };

      const { createRegistry } = await import("@kumiko/framework/engine");
      const { createDbConnection } = await import("@kumiko/framework/db");
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
      } = await import("@kumiko/framework/pipeline");

      const registry = createRegistry(config.features);
      const databaseUrl = Bun.env["DATABASE_URL"];
      if (!databaseUrl) {
        console.error("\n  DATABASE_URL not set. Run against a configured env.\n");
        process.exit(1);
      }
      const { db, close } = createDbConnection(databaseUrl);
      await createEventConsumerStateTable(db);

      const dim = "\x1b[2m";
      const reset = "\x1b[0m";
      const green = "\x1b[32m";
      const red = "\x1b[31m";
      const yellow = "\x1b[33m";

      function colorStatus(status: string): string {
        if (status === "idle") return `${green}${status}${reset}`;
        if (status === "dead") return `${red}${status}${reset}`;
        if (status === "disabled") return `${yellow}${status}${reset}`;
        if (status === "processing") return `${yellow}${status}${reset}`;
        return `${dim}${status}${reset}`;
      }

      // The registry knows about feature-declared MSP consumers; system
      // consumers (SSE, Search) are framework-level, so we prepend them
      // explicitly. Matches what buildServer wires up at boot.
      const registeredConsumerNames = [
        SSE_BROADCAST_CONSUMER_NAME,
        SEARCH_CONSUMER_NAME,
        ...registry.getAllMultiStreamProjections().keys(),
      ];

      function printOutcome(prefix: string, state: { name: string; status: string }): void {
        console.log(`\n  ${green}✓${reset} ${prefix} ${state.name} → ${colorStatus(state.status)}\n`);
      }

      try {
        switch (subCommand) {
          case "list": {
            const entries = await listConsumersWithState(db, registeredConsumerNames);
            if (entries.length === 0) {
              console.log("\n  Keine Event-Consumer registriert.\n");
              break;
            }
            console.log("\n  Registrierte Event-Consumer:\n");
            for (const e of entries) {
              const errHint = e.lastError ? ` ${red}error${reset}=${e.lastError.slice(0, 60)}` : "";
              console.log(
                `    ${e.name.padEnd(44)} ${colorStatus(e.status).padEnd(25)} cursor=${e.lastProcessedEventId} attempts=${e.attempts}${errHint}`,
              );
            }
            console.log();
            break;
          }

          case "status": {
            if (!arg) {
              console.error("\n  Usage: yarn kumiko consumer status <consumer-name>\n");
              process.exit(1);
            }
            const state = await getConsumerState(db, arg);
            if (!state) {
              if (!registeredConsumerNames.includes(arg)) {
                console.error(
                  `\n  Consumer "${arg}" ist nicht registriert. Liste via "yarn kumiko consumer list".\n`,
                );
                process.exit(1);
              }
              console.log(`\n  ${arg}: ${dim}never-run${reset}\n`);
              break;
            }
            console.log(`\n  ${state.name}`);
            console.log(`    status:        ${colorStatus(state.status)}`);
            console.log(`    last event id: ${state.lastProcessedEventId}`);
            console.log(`    attempts:      ${state.attempts}`);
            console.log(`    updated at:    ${state.updatedAt.toISOString()}`);
            if (state.lastError) {
              console.log(`    last error:    ${red}${state.lastError}${reset}`);
            }
            console.log();
            break;
          }

          case "restart": {
            if (!arg) {
              console.error("\n  Usage: yarn kumiko consumer restart <consumer-name>\n");
              process.exit(1);
            }
            const state = await restartConsumer(db, arg);
            printOutcome("restarted", state);
            console.log(`    ${dim}cursor remains at ${state.lastProcessedEventId}; dispatcher will retry the failing event next pass.${reset}\n`);
            break;
          }

          case "disable": {
            if (!arg) {
              console.error("\n  Usage: yarn kumiko consumer disable <consumer-name>\n");
              process.exit(1);
            }
            const state = await disableConsumer(db, arg);
            printOutcome("disabled", state);
            break;
          }

          case "enable": {
            if (!arg) {
              console.error("\n  Usage: yarn kumiko consumer enable <consumer-name>\n");
              process.exit(1);
            }
            const state = await enableConsumer(db, arg);
            printOutcome("enabled", state);
            break;
          }

          case "skip": {
            if (!arg) {
              console.error("\n  Usage: yarn kumiko consumer skip <consumer-name>\n");
              process.exit(1);
            }
            const state = await skipPoisonEvent(db, arg);
            if (state.skippedEventId === null) {
              console.log(
                `\n  ${yellow}~${reset} ${state.name}: cursor already at head — nothing to skip.\n`,
              );
            } else {
              printOutcome(`skipped event ${state.skippedEventId},`, state);
              console.log(`    ${dim}cursor advanced to ${state.lastProcessedEventId}; dispatcher will resume with the next event.${reset}\n`);
            }
            break;
          }

          default:
            console.log(
              "\n  Usage: yarn kumiko consumer <list | status <name> | restart <name> | disable <name> | enable <name> | skip <name>>\n",
            );
            await close();
            process.exit(1);
        }
      } catch (e) {
        console.error(`\n  ${red}✗${reset} ${e instanceof Error ? e.message : String(e)}\n`);
        await close();
        process.exit(1);
      }

      await close();
    },
  },

  doctor: {
    description: "Health check. Vermutlich alles okay.",
    run: async () => {
      const green = "\x1b[32m";
      const red = "\x1b[31m";
      const dim = "\x1b[2m";
      const reset = "\x1b[0m";

      type Check = { readonly name: string; readonly ok: boolean; readonly hint?: string };
      const checks: Check[] = [];

      checks.push({
        name: ".env file",
        ok: existsSync(".env"),
        hint: existsSync(".env") ? undefined : "cp .env.example .env",
      });

      const missingEnvs = Object.keys(REQUIRED_ENVS).filter((e) => !Bun.env[e]);
      checks.push({
        name: "required env vars",
        ok: missingEnvs.length === 0,
        hint: missingEnvs.length ? `missing: ${missingEnvs.join(", ")}` : undefined,
      });

      checks.push({
        name: "node_modules",
        ok: existsSync("node_modules"),
        hint: existsSync("node_modules") ? undefined : "yarn install",
      });

      let dockerOk = false;
      try {
        const result = await $`docker compose ps --format json`.quiet();
        dockerOk = result.stdout.toString().trim().split("\n").filter(Boolean).length > 0;
      } catch {}
      checks.push({
        name: "docker services",
        ok: dockerOk,
        hint: dockerOk ? undefined : "yarn kumiko dev",
      });

      let pgOk = false;
      try {
        await $`docker compose exec -T postgres pg_isready -U kumiko`.quiet();
        pgOk = true;
      } catch {}
      checks.push({
        name: "postgres ready",
        ok: pgOk,
        hint: pgOk ? undefined : "check: docker compose logs postgres",
      });

      console.log();
      for (const c of checks) {
        const mark = c.ok ? `${green}✓${reset}` : `${red}✗${reset}`;
        const note = c.hint ? `${dim} (${c.hint})${reset}` : "";
        console.log(`  ${mark} ${c.name}${note}`);
      }
      console.log();

      if (checks.every((c) => c.ok)) {
        const diagnoses = [
          "Everything seems fine. Probably. Don't quote me on this.",
          "Patient is stable. Vital signs acceptable. Soul status unknown.",
          "No symptoms detected. Doesn't mean there's no disease.",
          "Looks healthy — in this light, from this angle, today.",
          "Diagnosis: inconclusive, but encouraging.",
          "All clear. Back to coding. Don't look too closely.",
        ];
        const pick = diagnoses[Math.floor(Math.random() * diagnoses.length)] as string;
        console.log(`  ${pick}`);
      } else {
        console.log("  Not great. See the ✗ above — the hints tell you what to do.");
      }
      console.log();
    },
  },
} satisfies Record<string, { description: string; run: () => Promise<void> }>;

// --- Interactive menu ---

async function interactiveMenu(): Promise<void> {
  const entries = Object.entries(commands);

  banner();
  console.log("  Was soll's sein?\n");
  entries.forEach(([name, cmd], i) => {
    console.log(`  ${i + 1}) ${name.padEnd(10)} ${cmd.description}`);
  });
  console.log(`  q) tschuess\n`);

  process.stdout.write("  > ");

  for await (const line of console) {
    const input = line.trim().toLowerCase();

    if (input === "q" || input === "quit") break;

    const index = parseInt(input, 10) - 1;
    const entry = entries[index] ?? entries.find(([name]) => name === input);

    if (entry) {
      const [name, cmd] = entry;
      console.log(`\nRunning: ${name}\n`);
      try {
        await cmd.run();
      } catch (e) {
        console.error(`\nCommand failed: ${e instanceof Error ? e.message : e}`);
      }
      console.log();
      entries.forEach(([n, c], i) => {
        console.log(`  ${i + 1}) ${n.padEnd(10)} ${c.description}`);
      });
      console.log(`  q) quit\n`);
    } else {
      console.log(`  Unknown: "${input}"`);
    }

    process.stdout.write("  > ");
  }
}

// --- Hidden commands ---

// Easter egg: `yarn kumiko prost` — for when you need a moment.
function prost(): void {
  const yellow = "\x1b[33m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const toasts = [
    "To the framework frameworks need.",
    "To the builds that compile.",
    "To the tests that pass on the first try.",
    "To the bugs we fix. And the ones we name 'features'.",
    "To localhost — where everything works.",
    "To semver. May your breaking changes be minor.",
    "To the commit message we'll rewrite in 3 hours.",
  ];
  const toast = toasts[Math.floor(Math.random() * toasts.length)] as string;
  console.log();
  console.log(`${yellow}          .~~~~.${reset}`);
  console.log(`${yellow}         i====i_${reset}`);
  console.log(`${yellow}         |cccc|_)${reset}`);
  console.log(`${yellow}         |cccc|${reset}`);
  console.log(`${yellow}         \`-==-'${reset}`);
  console.log();
  console.log(`  🍺 Prost!`);
  console.log(`${dim}  "${toast}"${reset}`);
  console.log();
}

// --- Helpers ---

async function waitForPostgres(retries = 30): Promise<void> {
  process.stdout.write("Waiting for PostgreSQL");
  for (let i = 0; i < retries; i++) {
    try {
      await $`docker compose exec -T postgres pg_isready -U kumiko`.quiet();
      console.log(" ready.");
      return;
    } catch {
      process.stdout.write(".");
      await Bun.sleep(500);
    }
  }
  console.error("\nPostgreSQL wouldn't wake up. Try: docker compose logs postgres");
  process.exit(1);
}

// --- Entry point ---

checkEnv();

const command = Bun.argv[2];

if (!command) {
  await interactiveMenu();
} else {
  if (command === "help") {
    banner();
    const entries = Object.entries(commands);
    for (const [name, cmd] of entries) {
      console.log(`  ${name.padEnd(14)} ${cmd.description}`);
    }
    console.log();
  } else if (command === "prost") {
    prost();
  } else {
    const handler = commands[command as keyof typeof commands];
    if (!handler) {
      console.error(`\n  I don't know "${command}". Maybe a typo? Try: yarn kumiko help\n`);
      process.exit(1);
    }
    await handler.run();
  }
}
