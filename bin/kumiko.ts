#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync } from "node:fs";

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
    console.warn("\n  WARNING: No .env file found. Run: cp .env.example .env\n");
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
        ["TypeScript", "yarn tsc --noEmit -p packages/framework/tsconfig.json && yarn tsc --noEmit -p packages/core-features/tsconfig.json"],
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
} satisfies Record<string, { description: string; run: () => Promise<void> }>;

// --- Interactive menu ---

async function interactiveMenu(): Promise<void> {
  const entries = Object.entries(commands);

  console.log("\n  Kumiko — Was soll's sein?\n");
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
  console.error("\nPostgreSQL did not become ready.");
  process.exit(1);
}

// --- Entry point ---

checkEnv();

const command = Bun.argv[2];

if (!command) {
  await interactiveMenu();
} else {
  if (command === "help") {
    const entries = Object.entries(commands);
    console.log("\n  kumiko CLI\n");
    for (const [name, cmd] of entries) {
      console.log(`  ${name.padEnd(14)} ${cmd.description}`);
    }
    console.log();
  } else {
    const handler = commands[command as keyof typeof commands];
    if (!handler) {
      console.error(`Unknown command: ${command}`);
      console.error("Run 'yarn kumiko help' for available commands.");
      process.exit(1);
    }
    await handler.run();
  }
}
