#!/usr/bin/env bun
// kumiko-dev: wrapper script for sample dev scripts. Spawns the given
// server entry and respawns it automatically.
//
// Restart policy:
//   - exit 75 (EX_TEMPFAIL, raised by the dev-server on a schema change
//     because Bun's module cache forces a process restart): respawn
//     immediately without counting towards the crash loop. This is expected.
//   - any other non-zero exit: respawn with a short backoff, guarded by
//     createCrashTracker. Prevents an endless loop on a syntactically broken
//     bin/main.ts while keeping the "live edit" feel: a code error in one
//     feature does not kill the whole bun dev session.
//   - killed by a signal (SIGINT/SIGTERM): follow the caller, exit 0.
//
// Usage: `kumiko-dev src/app/server.ts` in package.json:
//
//   "scripts": { "dev": "kumiko-dev src/app/server.ts" }

import { spawn } from "node:child_process";
import process from "node:process";
import { createCrashTracker } from "@cosmicdrift/kumiko-dev-server/cli";

const SCHEMA_RESTART_EXIT_CODE = 75;
const MAX_CRASHES = 5;
const CRASH_WINDOW_MS = 10_000;
const CRASH_BACKOFF_MS = 500;

const USAGE = "Usage: kumiko-dev <server-entry.ts> [server args...]\n";
const entry = process.argv[2];
if (entry === "--help" || entry === "-h") {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (entry === undefined || entry === "") {
  process.stderr.write(USAGE);
  process.exit(2);
}

// Pass the remaining args (e.g. --port 4175) through to the server.
const passthroughArgs = process.argv.slice(3);

// Bun's own path is in process.argv[0] — we use it so
// `bun --env-file=...` flags from the caller aren't lost. We
// do NOT pass through all Bun flags (complicated with shell escaping);
// dev-scripts in samples set env vars directly in the invocation when needed.
const bunPath = process.argv[0] ?? "bun";

const crashTracker = createCrashTracker({
  maxCrashes: MAX_CRASHES,
  windowMs: CRASH_WINDOW_MS,
});

const spawnServer = (): void => {
  const child = spawn(bunPath, ["run", entry, ...passthroughArgs], {
    stdio: "inherit",
    // Error responses carry cause details only under an explicit development/test NODE_ENV,
    // so a local dev run without one would hide them.
    env: { ...process.env, NODE_ENV: process.env["NODE_ENV"] ?? "development" },
  });

  child.on("exit", (code, signal) => {
    if (signal !== null) {
      // Signal-killed (e.g. SIGINT): the caller wanted out → so do we.
      process.exit(0);
      return;
    }
    if (code === SCHEMA_RESTART_EXIT_CODE) {
      process.stdout.write("[kumiko-dev] respawn after schema change…\n");
      spawnServer();
      return;
    }
    if (code === 0) {
      process.exit(0);
      return;
    }
    // Non-zero exit without a schema change: code error or transient
    // crash. Respawn with backoff + crash-loop protection.
    const now = Date.now();
    const allowed = crashTracker.noteCrash(now);
    if (!allowed) {
      process.stderr.write(
        `[kumiko-dev] ${MAX_CRASHES} Crashes in ${CRASH_WINDOW_MS / 1000}s — aufgeben (exit ${code}). ` +
          "Fehler oben fixen und bun dev erneut starten.\n",
      );
      process.exit(code);
      return;
    }
    process.stderr.write(
      `[kumiko-dev] server exited with code ${code} — respawn in ${CRASH_BACKOFF_MS}ms ` +
        `(${crashTracker.crashCountInWindow(now)}/${MAX_CRASHES} in window)\n`,
    );
    setTimeout(spawnServer, CRASH_BACKOFF_MS);
  });
};

spawnServer();
