#!/usr/bin/env bun

import { $ } from "bun";

// --- Commands ---

const commands = {
  dev: {
    description: "Start Docker services (PostgreSQL + Redis)",
    run: async () => {
      console.log("Starting services...");
      await $`docker compose up -d`.quiet();
      await waitForPostgres();
      console.log(`  PostgreSQL: localhost:${Bun.env.KUMIKO_PG_PORT ?? "15432"}`);
      console.log(`  Redis:      localhost:${Bun.env.KUMIKO_REDIS_PORT ?? "16379"}`);
      console.log("Ready.");
    },
  },

  stop: {
    description: "Stop Docker services",
    run: async () => {
      console.log("Stopping services...");
      await $`docker compose down`.quiet();
      console.log("Stopped.");
    },
  },

  reset: {
    description: "Wipe everything and start fresh",
    run: async () => {
      console.log("Resetting...");
      await $`docker compose down -v`.quiet();
      await $`docker compose up -d`.quiet();
      await waitForPostgres();
      // db migrate + seed come with Step 7
      console.log("Reset complete.");
    },
  },

  test: {
    description: "Run tests (test | test integration | test all | test <path>)",
    run: async () => {
      const scope = Bun.argv[3];
      if (scope === "all") {
        console.log("Running unit + integration tests...\n");
        await $`yarn vitest run`;
        await $`yarn vitest run --config vitest.integration.config.ts`;
      } else if (scope === "integration") {
        console.log("Running integration tests (Docker required)...\n");
        await $`yarn vitest run --config vitest.integration.config.ts`;
      } else if (scope) {
        await $`yarn vitest run ${scope}`;
      } else {
        await $`yarn vitest run`;
      }
    },
  },

  check: {
    description: "Run Biome + TypeScript + Tests",
    run: async () => {
      console.log("Running all checks...\n");
      const results: Array<{ name: string; ok: boolean }> = [];

      for (const [name, cmd] of [
        ["Biome", "yarn biome check ."],
        ["TypeScript", "yarn tsc --noEmit"],
        ["Unit Tests", "yarn vitest run"],
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

      console.log("Results:");
      for (const r of results) {
        console.log(`  ${r.ok ? "PASS" : "FAIL"} ${r.name}`);
      }

      if (results.some((r) => !r.ok)) process.exit(1);
    },
  },

  status: {
    description: "Show project status",
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

  console.log("\n  kumiko CLI\n");
  entries.forEach(([name, cmd], i) => {
    console.log(`  ${i + 1}) ${name.padEnd(10)} ${cmd.description}`);
  });
  console.log(`  q) quit\n`);

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

const command = Bun.argv[2];

if (!command) {
  await interactiveMenu();
} else {
  const handler = commands[command as keyof typeof commands];
  if (!handler) {
    console.error(`Unknown command: ${command}`);
    console.error("Run 'yarn kumiko' for interactive menu.");
    process.exit(1);
  }
  await handler.run();
}
