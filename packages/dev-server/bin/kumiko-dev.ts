#!/usr/bin/env bun
// kumiko-dev — Wrapper-Skript für sample dev-scripts. Spawnt den
// übergebenen Server-Entry und respawnt automatisch bei exit code 75
// (EX_TEMPFAIL — vom dev-server beim Schema-Change ausgelöst, weil
// Bun's Module-Cache einen Process-Restart erzwingt).
//
// Nutzung: `kumiko-dev src/app/server.ts` in package.json:
//
//   "scripts": { "dev": "kumiko-dev src/app/server.ts" }
//
// Das ersetzt das frühere `bun run src/app/server.ts` und nimmt die
// Restart-Mechanik aus den Sample-Scripts raus. Andere exit-codes
// (Ctrl+C, uncaught crash) propagieren wir 1:1 an den Caller damit
// CI/Process-Manager das Signal sehen.

import { spawn } from "node:child_process";
import process from "node:process";

const RESTART_EXIT_CODE = 75;

const entry = process.argv[2];
if (entry === undefined || entry === "") {
  process.stderr.write("Usage: kumiko-dev <server-entry.ts>\n");
  process.exit(2);
}

// Restliche Args (z.B. --port 4175) reichen wir an den Server durch.
const passthroughArgs = process.argv.slice(3);

// Bun's eigener Pfad steht in process.argv[0] — den nutzen wir, damit
// `bun --env-file=...` Flags vom Caller nicht verloren gehen. Wir
// reichen NICHT alle Bun-Flags durch (kompliziert mit shell-Escaping);
// dev-scripts in samples setzen Env-Vars direkt im Aufruf wenn nötig.
const bunPath = process.argv[0] ?? "bun";

const start = (): void => {
  const child = spawn(bunPath, ["run", entry, ...passthroughArgs], {
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    if (signal !== null) {
      // Signal-killed (z.B. SIGINT): Caller wollte raus → wir auch.
      process.exit(0);
      return;
    }
    if (code === RESTART_EXIT_CODE) {
      process.stdout.write("[kumiko-dev] respawn after schema change…\n");
      start();
      return;
    }
    process.exit(code ?? 0);
  });
};

start();
