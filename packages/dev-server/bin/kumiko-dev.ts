#!/usr/bin/env bun
// kumiko-dev — Wrapper-Skript für sample dev-scripts. Spawnt den
// übergebenen Server-Entry und respawnt automatisch.
//
// Restart-Policy:
//   - exit 75 (EX_TEMPFAIL, vom dev-server beim Schema-Change ausgelöst,
//     weil Bun's Module-Cache einen Process-Restart erzwingt): sofortiger
//     respawn ohne Crash-Loop-Anrechnung — das ist erwartetes Verhalten.
//   - jeder andere non-zero exit: respawn mit 500ms Backoff, aber
//     Crash-Loop-Schutz: max 5 Crashes in 10s, sonst aufgeben mit dem
//     letzten Exit-Code. Verhindert Endlos-Loop bei syntaktisch totem
//     bin/main.ts und gibt dem User trotzdem "Live-Edit"-Feeling: ein
//     Code-Fehler in einem Feature killt nicht die ganze yarn-dev-Session.
//   - Signal-killed (SIGINT/SIGTERM): wir folgen dem Caller, exit 0.
//
// Nutzung: `kumiko-dev src/app/server.ts` in package.json:
//
//   "scripts": { "dev": "kumiko-dev src/app/server.ts" }

import { spawn } from "node:child_process";
import process from "node:process";

const RESTART_EXIT_CODE = 75;
const MAX_CRASHES_IN_WINDOW = 5;
const CRASH_WINDOW_MS = 10_000;
const CRASH_BACKOFF_MS = 500;

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

// Crash-Timestamps im rollenden Fenster. Wenn das Array MAX_CRASHES
// erreicht ohne dass ein Eintrag aus dem Fenster fällt, geben wir auf.
const recentCrashes: number[] = [];

function shouldRespawnAfterCrash(now: number): boolean {
  while (recentCrashes.length > 0 && now - (recentCrashes[0] ?? 0) > CRASH_WINDOW_MS) {
    recentCrashes.shift();
  }
  recentCrashes.push(now);
  return recentCrashes.length <= MAX_CRASHES_IN_WINDOW;
}

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
    if (code === 0) {
      process.exit(0);
      return;
    }
    // Non-zero exit ohne Schema-Change: Code-Fehler oder transienter
    // Crash. Respawn mit Backoff + Crash-Loop-Schutz.
    const now = Date.now();
    if (!shouldRespawnAfterCrash(now)) {
      process.stderr.write(
        `[kumiko-dev] ${MAX_CRASHES_IN_WINDOW} Crashes in ${CRASH_WINDOW_MS / 1000}s — aufgeben (exit ${code}). ` +
          "Fehler oben fixen und yarn dev erneut starten.\n",
      );
      process.exit(code);
      return;
    }
    process.stderr.write(
      `[kumiko-dev] server exited with code ${code} — respawn in ${CRASH_BACKOFF_MS}ms (${recentCrashes.length}/${MAX_CRASHES_IN_WINDOW} in window)\n`,
    );
    setTimeout(start, CRASH_BACKOFF_MS);
  });
};

start();
