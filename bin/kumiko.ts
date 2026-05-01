#!/usr/bin/env bun

import { $ } from "bun";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve as resolvePath } from "node:path";

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

// Geteilte Liste der CPU-bound, kurzlaufenden Steps. `kumiko check` hängt
// danach noch Unit + Integration Tests an; `kumiko check:fast` hängt nur
// `vitest run --changed` an und skipt Integration komplett.
const FAST_CHECK_STEPS: ReadonlyArray<{ readonly name: string; readonly cmd: string }> = [
  { name: "Biome", cmd: "yarn biome check ." },
  // tsc -b nutzt .tsbuildinfo-Caches — Re-Runs bei unverändertem Code
  // sind nahezu instant. Project-References im root tsconfig ziehen alle
  // Workspaces mit (framework, bundled-features, headless, dispatcher-
  // live, renderer, renderer-web, app). --noEmit funktioniert nicht mit
  // composite-projects (TS6310), dist-Output ist via .gitignore ignoriert.
  { name: "TypeScript", cmd: "yarn tsc -b" },
  // Sample-Apps werden NICHT von tsc -b erfasst (sind nicht in
  // root.references) — eigener Check pro sample workspace damit IDE-
  // sichtbare Errors auch im check rot werden. Auto-discovery über
  // samples/<category>/<app>/tsconfig.json: neue Apps werden ohne
  // Konfig-Pflege gefunden.
  { name: "TypeScript (Samples)", cmd: "bun scripts/check-app-tsc.ts" },
  { name: "Silent-Skip Guard", cmd: "bun scripts/guard-silent-skip.ts" },
  { name: "Admin-API Guard", cmd: "bun scripts/guard-admin-api.ts" },
  { name: "Unsafe-JSON-Parse Guard", cmd: "bun scripts/guard-unsafe-json-parse.ts" },
  { name: "No-Date-API Guard", cmd: "bun scripts/guard-no-date-api.ts" },
  { name: "Pre-ES-Patterns Guard", cmd: "bun scripts/guard-pre-es-patterns.ts" },
  { name: "Direct-Entity-Writes Guard", cmd: "bun scripts/guard-direct-entity-writes.ts" },
  { name: "Cross-Feature-Import Guard", cmd: "bun scripts/guard-cross-feature-imports.ts" },
  { name: "Renderer-Boundaries Guard", cmd: "bun scripts/guard-renderer-boundaries.ts" },
  { name: "Fake-Test Guard", cmd: "bun scripts/guard-fake-tests.ts" },
  {
    name: "Feature-Integration-Test Guard",
    cmd: "bun scripts/guard-feature-integration-tests.ts",
  },
  { name: "i18n-Keys Guard", cmd: "bun scripts/guard-i18n-keys.ts" },
  { name: "Test-Stack-Drift Guard", cmd: "bun scripts/guard-test-stack-drift.ts" },
  { name: "Runtime-Isolation Guard", cmd: "bun scripts/check-runtime-isolation.ts" },
  { name: "Error-Reasons Guard", cmd: "bun scripts/guard-error-reasons.ts" },
  { name: "Predicate Extraction Check", cmd: "bun scripts/check-predicates.ts" },
  { name: "as-Cast Audit", cmd: "bun scripts/check-as-casts.ts" },
  { name: "License Check", cmd: "bun scripts/check-licenses.ts" },
];

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

  codegen: {
    description: "App-Codegen — schreibt .kumiko/define.ts + types.generated.d.ts aus r.defineEvent",
    run: async () => {
      // Schreibt den lokalen `defineWriteHandler`-Wrapper + die Augmentation
      // der globalen `KumikoEventTypeMap`. Dev-Server + kumiko-build rufen
      // dasselbe runCodegen() automatisch auf — diese CLI-Variante ist für
      // CI-Checks ("ist der generated-state synchron mit den Sources?")
      // und manuelles Debug.
      //
      // CWD-Resolution analog zu `build`:
      //   1. Bun.argv[3] (explicit path)
      //   2. $INIT_CWD (yarn-Workspace)
      //   3. process.cwd()
      const { runCodegen } = await import("@kumiko/dev-server");
      const explicit = Bun.argv[3];
      const cwd = explicit
        ? resolvePath(explicit)
        : (Bun.env["INIT_CWD"] ?? process.cwd());
      const t0 = performance.now();
      const result = runCodegen({ appRoot: cwd });
      const ms = Math.round(performance.now() - t0);
      console.log(
        `\n  ✓ codegen done — ${result.eventCount} events, ${ms}ms\n` +
          `    output: ${result.outputDir}\n` +
          `    types: ${result.didWriteTypes ? "rewritten" : "unchanged"}\n` +
          `    define: ${result.didWriteDefine ? "rewritten" : "unchanged"}`,
      );
      if (result.warnings.length > 0) {
        console.log(`\n  ${result.warnings.length} warning(s):`);
        for (const w of result.warnings) {
          console.log(`    ${w.file}:${w.line} — ${w.reason}`);
        }
      }
      console.log();
    },
  },

  build: {
    description: "Production-Build für eine App (dist/) — nimmt path oder $INIT_CWD",
    run: async () => {
      // Discovery + Bun.build + Tailwind + Public-Folder-Copy.
      // Convention-driven: src/client.tsx → bundle, src/styles.css →
      // Tailwind, public/ → 1:1, index.html → Template. Output landet
      // unter <cwd>/dist.
      //
      // CWD-Resolution:
      //   1. Bun.argv[3] (explicit path)        → kumiko build samples/apps/showcase
      //   2. $INIT_CWD (yarn-Workspace-Aufruf)  → cd <app> && yarn build
      //   3. process.cwd() (fallback)
      const { buildProdBundle, formatBuildResult } = await import("@kumiko/dev-server/build");
      const explicit = Bun.argv[3];
      const cwd = explicit
        ? resolvePath(explicit)
        : (Bun.env["INIT_CWD"] ?? process.cwd());
      const t0 = performance.now();
      const result = await buildProdBundle({ cwd });
      const ms = Math.round(performance.now() - t0);
      console.log(formatBuildResult(result, ms));
    },
  },

  create: {
    description: "Scaffold eine leere Feature-Workspace — kumiko create <camelCaseName> [--path <dir>]",
    run: async () => {
      // CLI: yarn kumiko create <name> [--path <destination>]
      //   <name>: required, camelCase feature-Identifier (validiert)
      //   --path: optional Override; default samples/recipes/<kebab-name>/
      //
      // Output: minimal-Workspace mit package.json + src/feature.ts.
      // feature.ts ist canonical Object-Form (// kumiko-feature-version: 1)
      // mit einem Starter-Entity — direkt durch parser/patcher
      // weiterbearbeitbar. yarn install nach create für Workspace-Wiring.
      const { scaffoldFeature } = await import("@kumiko/dev-server");
      const args = Bun.argv.slice(3);
      const name = args.find((a) => !a.startsWith("--"));
      if (!name) {
        console.error("\n  Usage: yarn kumiko create <camelCaseName> [--path <dir>]\n");
        process.exit(1);
      }
      const pathIdx = args.indexOf("--path");
      const destination = pathIdx >= 0 ? args[pathIdx + 1] : undefined;
      try {
        const result = scaffoldFeature({
          name,
          ...(destination !== undefined && { destination }),
        });
        const relDest = result.destination.startsWith(process.cwd())
          ? result.destination.slice(process.cwd().length + 1)
          : result.destination;
        console.log(
          `\n  ✓ Feature scaffolded — ${result.featureName}\n` +
            `    package: ${result.packageName}\n` +
            `    path:    ${relDest}\n\n` +
            "  Next: run yarn install, then edit src/feature.ts.\n",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`\n  ${msg}\n`);
        process.exit(1);
      }
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
    description: "Tests laufen lassen (test | integration | e2e | all | <path>)",
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
      } else if (scope === "e2e") {
        // E2E laufen opt-in (nicht Teil von `kumiko check`). Jedes
        // Package/Sample mit einer playwright.config.ts kriegt einen
        // eigenen Run — der webServer-Hook bootet den echten dev-
        // server pro Config. Docker muss laufen (Postgres + Redis wie
        // Integration-Tests). Packages zuerst (kleinerer Scope),
        // dann Sample-Apps + Showcases.
        const { readdir } = await import("node:fs/promises");
        const targets: Array<{ root: string; name: string }> = [];
        const roots = ["packages", "samples/apps", "samples/showcases"];
        for (const root of roots) {
          const entries = await readdir(root, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const cfg = Bun.file(`${root}/${entry.name}/playwright.config.ts`);
            if (await cfg.exists()) targets.push({ root, name: entry.name });
          }
        }
        if (targets.length === 0) {
          console.log(
            "Keine E2E-Configs gefunden (packages/*/playwright.config.ts oder samples/{apps,showcases}/*/playwright.config.ts).",
          );
          return;
        }
        const labels = targets.map((t) => `${t.root}/${t.name}`).join(", ");
        console.log(`E2E via Playwright — ${targets.length} Target(s): ${labels}\n`);
        for (const target of targets) {
          console.log(`\n=== ${target.root}/${target.name} ===`);
          // Yarn 4 sucht `yarn <bin>` nur in den direct-deps des Workspace.
          // `@playwright/test` ist nur in root-package.json → wir invocieren
          // den hoisted-bin direkt aus root-node_modules/.bin/.
          const playwrightBin = `${process.cwd()}/node_modules/.bin/playwright`;
          await $`${playwrightBin} test`.cwd(`${target.root}/${target.name}`);
        }
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
      // Parallel-Dedup: zwei gleichzeitige `kumiko check`-Aufrufe sollen
      // den realen Run nur einmal machen. Erster Aufruf haelt den Lock und
      // streamt Output zur Console UND in eine Log-Datei. Folge-Aufrufe
      // tail-en die Log-Datei live und uebernehmen am Ende den Exit-Code
      // aus der Result-Datei.
      const lockDir = ".kumiko-check.lock";
      const logPath = ".kumiko-check.log";
      const resultPath = ".kumiko-check.result";

      if (!acquireCheckLock(lockDir, logPath, resultPath)) {
        const code = await followCheck(lockDir, logPath, resultPath);
        if (code !== 0) process.exit(code);
        return;
      }

      registerLockCleanup(lockDir);

      logBoth("Checke alles durch...\n", logPath);
      const results: Array<{ name: string; ok: boolean }> = [];

      logBoth(`--- ${FAST_CHECK_STEPS.length} fast checks (parallel, pool=6) ---`, logPath);
      const fastResults = await runPoolBuffered(FAST_CHECK_STEPS, 6, logPath);
      for (const r of fastResults) results.push(r);
      logBoth("", logPath);

      // KUMIKO_CHECK=1 weckt den höheren Vitest-Thread-Cap (8 statt 4)
      // in vitest.config.ts auf — die Box ist eh gesättigt während eines
      // check-Laufs, da soll Wall-Time zählen. Im Watch-Mode/IDE bleibt
      // der konservative Default aktiv.
      const slowSteps: ReadonlyArray<{ readonly name: string; readonly cmd: string }> = [
        { name: "Unit Tests", cmd: "KUMIKO_CHECK=1 yarn vitest run" },
        { name: "Integration Guard", cmd: "node vitest.integration.guard.js" },
        {
          name: "Integration Tests",
          cmd: "KUMIKO_CHECK=1 yarn vitest run --config vitest.integration.config.ts",
        },
      ];
      for (const step of slowSteps) {
        logBoth(`--- ${step.name} ---`, logPath);
        const code = await runWithTee(step.cmd, logPath);
        results.push({ name: step.name, ok: code === 0 });
        logBoth("", logPath);
      }

      const allGood = results.every((r) => r.ok);
      logBoth(allGood ? "Alles im gruenen Bereich!" : "Da gibt's was zu tun:", logPath);
      for (const r of results) {
        logBoth(`  ${r.ok ? "PASS" : "FAIL"} ${r.name}`, logPath);
      }

      writeFileSync(resultPath, allGood ? "0" : "1");
      if (!allGood) process.exit(1);
    },
  },

  "check:fast": {
    description: "Schneller Check (skip Integration, Unit-Tests nur --changed)",
    run: async () => {
      // Bewusst kein Lock und kein Tee-Logfile — check:fast ist für die
      // schnelle Iteration zwischendurch (5-15s), keine geteilte CI-
      // Operation. Wenn jemand parallel `kumiko check` laufen lässt,
      // gibt's IO-Contention auf .tsbuildinfo aber kein realer Konflikt.
      console.log("Schneller Check — Integration wird geskippt.\n");
      const results: Array<{ name: string; ok: boolean }> = [];

      console.log(`--- ${FAST_CHECK_STEPS.length} fast checks (parallel, pool=6) ---`);
      // runPoolBuffered braucht einen logPath; wir geben /dev/null —
      // Output zeigt eh die ✓/✗-Live-Zeile pro Step plus failed-Outputs.
      const fastResults = await runPoolBuffered(FAST_CHECK_STEPS, 6, "/dev/null");
      for (const r of fastResults) results.push(r);
      console.log();

      console.log("--- Unit Tests (nur --changed) ---");
      // vitest --changed nutzt git-diff vs. HEAD: alle Tests die
      // (transitive) von einem geänderten Source-File abhängen werden
      // gelaufen. Vitest macht die Resolution selbst.
      const proc = Bun.spawn(["sh", "-c", "KUMIKO_CHECK=1 yarn vitest run --changed"], {
        stdout: "inherit",
        stderr: "inherit",
        env: process.env,
      });
      const code = await proc.exited;
      results.push({ name: "Unit Tests (changed)", ok: code === 0 });
      console.log();

      const allGood = results.every((r) => r.ok);
      console.log(allGood ? "Fast-Check grün." : "Fast-Check rot:");
      for (const r of results) {
        console.log(`  ${r.ok ? "PASS" : "FAIL"} ${r.name}`);
      }
      console.log("\nVor Commit: `kumiko check` für die volle Suite (inkl. Integration).");
      if (!allGood) process.exit(1);
    },
  },

  // CI-only Subcommands — splitten FAST_CHECK_STEPS auf parallele
  // GitHub-Actions-Jobs. Trade-off zur Single-`kumiko check`-CLI: in CI
  // wall-time-halbieren via Job-Parallelismus, lokal bleibt `kumiko
  // check` weiter der single-call-aggregator.
  //
  // Drift-Schutz: ci:guards rennt FAST_CHECK_STEPS minus der explizit
  // benannten Lint/TSC-Steps. Neue Guards in FAST_CHECK_STEPS landen
  // automatisch im CI-guards-Job, ohne dass man ci.yml anfassen muss.
  "ci:guards": {
    description: "CI-only — alle Guards/Audits aus FAST_CHECK_STEPS außer Lint/TSC (parallel)",
    run: async () => {
      // Lint und TSC laufen in eigenen CI-Jobs — hier raus, sonst
      // doppelter Aufwand. Diese drei Namen sind die einzige Stelle
      // an der die Aufteilung manuell definiert wird; alles andere
      // wird automatisch erfasst.
      const SPLIT_OUT = new Set(["Biome", "TypeScript", "TypeScript (Samples)"]);
      const guards = FAST_CHECK_STEPS.filter((s) => !SPLIT_OUT.has(s.name));
      console.log(`--- ${guards.length} guards (parallel, pool=6) ---`);
      const results = await runPoolBuffered(guards, 6, "/dev/null");
      const allGood = results.every((r) => r.ok);
      console.log(allGood ? "\nGuards grün." : "\nGuards rot:");
      for (const r of results) {
        console.log(`  ${r.ok ? "PASS" : "FAIL"} ${r.name}`);
      }
      if (!allGood) process.exit(1);
    },
  },

  migrate: {
    description:
      "DB-Schema (per-app) migrieren — generate-schema | generate | apply | validate | status | drop",
    run: async () => {
      const subCommand = Bun.argv[3];

      // Per-App-CWD: yarn ruft uns aus dem App-Workspace, $INIT_CWD ist
      // dort gesetzt. drizzle.config.ts + drizzle/ leben pro App, nicht
      // im Repo-Root. Fallback auf process.cwd() für direkte Aufrufe.
      const appCwd = process.env["INIT_CWD"] ?? process.cwd();
      const drizzleConfig = join(appCwd, "drizzle.config.ts");
      if (!existsSync(drizzleConfig)) {
        console.error(
          `\n  Kein drizzle.config.ts in ${appCwd}.\n  ` +
            `'kumiko migrate' läuft pro App-Workspace — wechsle in den App-Ordner ` +
            `(samples/showcases/<app>) oder rufe via 'yarn workspace <app> kumiko migrate ...' auf.\n`,
        );
        process.exit(1);
      }

      // drizzle-kit läuft unter raw node — der frühere `bun --bun`-Workaround
      // war wegen einem Vitest-Top-Level-Import in framework/testing, der den
      // node CJS-Loader sprengte. Strukturell behoben (testing/ in eigenen
      // Sub-Path getrennt vom runtime-stack), drizzle.config.ts und
      // schema.ts laden jetzt sauber unter node. Hoisted-Binary lebt im
      // Repo-Root node_modules — wir auflösen über bin/kumiko.ts → ../
      // statt process.cwd() (das ist im App-Workspace via INIT_CWD).
      //
      // KUMIKO_REPO_ROOT-Override: bei einem gebundelten kumiko.ts (Server-
      // Bundle in einer Production-App) zeigt import.meta.dir aufs Bundle-
      // Verzeichnis — die node_modules liegen direkt daneben, nicht parent.
      // Der Bundle-Container setzt KUMIKO_REPO_ROOT auf seinen App-Root.
      const repoRoot = process.env["KUMIKO_REPO_ROOT"] ?? resolvePath(import.meta.dir, "..");
      const drizzleKitBin = resolvePath(repoRoot, "node_modules/.bin/drizzle-kit");
      if (!existsSync(drizzleKitBin)) {
        console.error(
          `\n  drizzle-kit nicht gefunden unter ${drizzleKitBin}.\n` +
            `  Wahrscheinlich ist 'yarn install' nicht gelaufen.\n`,
        );
        process.exit(1);
      }

      switch (subCommand) {
        case "generate-schema": {
          // Schema-Files (entity tables) aus run-config regenerieren.
          // schema.custom.ts bleibt hand-maintained.
          console.log(`\n  Generiere Schema aus Entities (${appCwd})…`);
          await $`bun run drizzle/generate.ts`.cwd(appCwd);
          break;
        }
        case "generate": {
          // Drei Schritte:
          //   1. schema.generated.ts neu schreiben (App-Features → Drizzle-Tables)
          //   2. drizzle-kit generate (SQL-Migration-File + Snapshot)
          //   3. Rebuild-Marker schreiben wenn Projection-Tabellen Schema-Changes
          //      haben — sodass `migrate apply` automatisch rebuildProjection
          //      ruft. Marker wird zum Migration-File committed.
          console.log(`\n  Generiere Schema + Migration-File (${appCwd})…`);
          await $`bun run drizzle/generate.ts`.cwd(appCwd);
          await $`node ${drizzleKitBin} generate`.cwd(appCwd);
          if (existsSync(join(appCwd, "drizzle/migration-hooks.ts"))) {
            await $`bun run drizzle/migration-hooks.ts write-rebuild-marker`.cwd(appCwd);
          }
          break;
        }
        case "apply": {
          await runMigrateApply(appCwd, drizzleKitBin);
          break;
        }
        case "validate": {
          // Schema-Drift-Check: Journal vs. __drizzle_migrations + erwartete
          // Tabellen vs. tatsächlicher DB-Stand. Exit 1 bei Drift.
          console.log(`\n  Prüfe Schema-Drift (${appCwd})…`);
          const { createDbConnection } = await import("@kumiko/framework/db");
          const { detectDrift, formatDriftReport } = await import(
            "@kumiko/framework/migrations"
          );
          const dbUrl = process.env["DATABASE_URL"];
          if (!dbUrl) {
            console.error("  DATABASE_URL nicht gesetzt.");
            process.exit(1);
          }
          const { db, close } = createDbConnection(dbUrl);
          try {
            const report = await detectDrift(db, join(appCwd, "drizzle/migrations"));
            console.log(`\n  ${formatDriftReport(report)}\n`);
            if (!report.ok) process.exit(1);
          } finally {
            await close();
          }
          break;
        }
        case "status": {
          // Zeigt was sich (lokal) ändern würde. Drizzle-kit's check
          // vergleicht Migration-Files miteinander, NICHT DB. Für DB-vs-
          // Code-Diff: 'kumiko migrate validate'.
          console.log(`\n  Prüfe Migration-File-Konsistenz (${appCwd})…`);
          await $`node ${drizzleKitBin} check`.cwd(appCwd).nothrow();
          break;
        }
        case "drop": {
          await $`node ${drizzleKitBin} drop`.cwd(appCwd);
          break;
        }
        default: {
          console.log(
            "\n  Subcommands:\n" +
              "    generate-schema   Regeneriere drizzle/schema.generated.ts aus Entities\n" +
              "    generate          generate-schema + drizzle-kit generate (SQL-Migration-File)\n" +
              "    apply             drizzle-kit migrate (Production: pending Migrations anwenden)\n" +
              "    validate          Schema-Drift-Check (DB vs. Journal/Snapshot)\n" +
              "    status            drizzle-kit check (Migration-Files konsistent?)\n" +
              "    drop              drizzle-kit drop (latest Migration löschen)\n",
          );
          break;
        }
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

// Wendet alle pending Migrations gegen DATABASE_URL an und ruft danach
// die Rebuild-Hooks für die soeben neu applied Migrations. Ablauf:
//
//   1. Pre-apply: applied-Count merken (kommt aus __drizzle_migrations
//      über loadAppliedMigrations).
//   2. drizzle-kit migrate fährt alle pending SQL-Files. Idempotent —
//      bei Re-Run no-op weil Hashes schon getrackt sind.
//   3. Post-apply: Journal-Slice ab dem Pre-apply-Index gibt die neu
//      applied Tags. Für jeden Tag liest migration-hooks.ts die
//      <tag>__rebuild.json-Marker und ruft rebuildProjection.
//
// Ohne DATABASE_URL läuft drizzle-kit selbst los und fällt mit eigenem
// Fehler — wir lassen ihm den Vortritt statt vorab zu prüfen.
async function runMigrateApply(appCwd: string, drizzleKitBin: string): Promise<void> {
  console.log(`\n  Wende Migrations an (${appCwd})…`);

  const dbUrl = process.env["DATABASE_URL"];
  const journalPath = join(appCwd, "drizzle/migrations/meta/_journal.json");
  // Bundle-Container überschreiben den Hooks-Pfad mit der gebundelten
  // Variante (KUMIKO_MIGRATION_HOOKS=/app/migration-hooks.js), weil das
  // unbundled .ts ihre Imports (compose-features etc.) nicht resolven kann.
  const hooksPath =
    process.env["KUMIKO_MIGRATION_HOOKS"] ?? join(appCwd, "drizzle/migration-hooks.ts");

  let appliedBefore = 0;
  if (dbUrl && existsSync(journalPath)) {
    const { createDbConnection } = await import("@kumiko/framework/db");
    const { loadAppliedMigrations } = await import("@kumiko/framework/migrations");
    const { db, close } = createDbConnection(dbUrl);
    try {
      const applied = await loadAppliedMigrations(db);
      appliedBefore = applied.length;
    } finally {
      await close();
    }
  }

  await $`node ${drizzleKitBin} migrate`.cwd(appCwd);

  if (dbUrl && existsSync(journalPath) && existsSync(hooksPath)) {
    const { loadJournal } = await import("@kumiko/framework/migrations");
    const journal = loadJournal(join(appCwd, "drizzle/migrations"));
    const newlyApplied = journal.entries.slice(appliedBefore).map((e) => e.tag);
    if (newlyApplied.length > 0) {
      await $`bun run ${hooksPath} run-rebuilds ${newlyApplied}`.cwd(appCwd);
    }
  }

  console.log("\n  ✓ DB ist aktuell.");
}

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

// --- Check Lock Helpers ---

function acquireCheckLock(lockDir: string, logPath: string, resultPath: string): boolean {
  // mkdirSync ohne recursive ist atomar — EEXIST entscheidet ueber den
  // Wettlauf zweier paralleler Aufrufe. Stale-Locks (Owner ist tot)
  // werden einmal aufgeraeumt und dann neu versucht.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, "pid"), String(process.pid));
      writeFileSync(logPath, "");
      rmSync(resultPath, { force: true });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (isLockHolderAlive(lockDir)) return false;
      rmSync(lockDir, { recursive: true, force: true });
    }
  }
  return false;
}

function isLockHolderAlive(lockDir: string): boolean {
  try {
    const pid = Number.parseInt(readFileSync(join(lockDir, "pid"), "utf8"), 10);
    if (!Number.isFinite(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function registerLockCleanup(lockDir: string): void {
  const release = (): void => {
    try {
      rmSync(lockDir, { recursive: true, force: true });
    } catch {
      // ignore — best effort
    }
  };
  process.on("exit", release);
  process.on("SIGINT", () => {
    release();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    release();
    process.exit(143);
  });
}

function logBoth(line: string, logPath: string): void {
  console.log(line);
  try {
    writeFileSync(logPath, `${line}\n`, { flag: "a" });
  } catch {
    // ignore — log is best effort
  }
}

// Worker-Pool für CPU-bound, kurzlaufende Steps. Jeder Step kriegt einen
// In-Memory-Output-Buffer; das Ergebnis wird in Original-Reihenfolge auf
// stdout und in die Log-Datei serialisiert. Live-Output geht damit
// verloren — das ist OK für Guards/Lints (Sekunden-Range, Output ist
// klein), aber für Unit/Integration Tests bewusst NICHT (siehe runWithTee).
//
// poolSize 6 auf 12-Core-Box: lässt Headroom für IDE/Docker/etc. und ist
// in den Messungen nahe am Sweet-Spot zwischen Wall-Time und Kontext-
// Switch-Overhead.
async function runPoolBuffered(
  steps: ReadonlyArray<{ readonly name: string; readonly cmd: string }>,
  poolSize: number,
  logPath: string,
): Promise<Array<{ name: string; ok: boolean }>> {
  type Result = { name: string; ok: boolean; output: string; durationMs: number };
  const results: Array<Result | undefined> = new Array(steps.length);
  let next = 0;

  const runOne = async (idx: number): Promise<void> => {
    const step = steps[idx];
    if (step === undefined) return;
    const start = performance.now();
    const proc = Bun.spawn(["sh", "-c", step.cmd], {
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    const [stdoutBuf, stderrBuf, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const durationMs = Math.round(performance.now() - start);
    results[idx] = {
      name: step.name,
      ok: code === 0,
      output: stdoutBuf + stderrBuf,
      durationMs,
    };
    process.stdout.write(`  ${code === 0 ? "✓" : "✗"} ${step.name} (${durationMs}ms)\n`);
  };

  const worker = async (): Promise<void> => {
    while (true) {
      const idx = next++;
      if (idx >= steps.length) return;
      await runOne(idx);
    }
  };

  await Promise.all(Array.from({ length: Math.min(poolSize, steps.length) }, worker));

  // Serialisierte Ausgabe: nur Failed-Steps zeigen ihren Output (bei
  // Erfolg ist Guard-Output meist nur "n Dateien geprüft, 0 Verstöße").
  // Logfile bekommt alles für post-hoc-Debugging.
  const final: Array<{ name: string; ok: boolean }> = [];
  for (let i = 0; i < steps.length; i++) {
    const r = results[i];
    if (r === undefined) continue;
    final.push({ name: r.name, ok: r.ok });
    try {
      writeFileSync(
        logPath,
        `\n--- ${r.name} (${r.durationMs}ms, exit ${r.ok ? 0 : 1}) ---\n${r.output}`,
        { flag: "a" },
      );
    } catch {
      // log is best effort
    }
    if (!r.ok) {
      process.stdout.write(`\n--- ${r.name} (FAILED, ${r.durationMs}ms) ---\n${r.output}\n`);
    }
  }
  return final;
}

async function runWithTee(cmd: string, logPath: string): Promise<number> {
  const proc = Bun.spawn(["sh", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const logStream = createWriteStream(logPath, { flags: "a" });

  const pump = async (
    stream: ReadableStream<Uint8Array>,
    sink: NodeJS.WriteStream,
  ): Promise<void> => {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sink.write(value);
      logStream.write(value);
    }
  };

  await Promise.all([pump(proc.stdout, process.stdout), pump(proc.stderr, process.stderr)]);
  const code = await proc.exited;
  await new Promise<void>((resolve) => logStream.end(resolve));
  return code;
}

async function followCheck(lockDir: string, logPath: string, resultPath: string): Promise<number> {
  console.log("kumiko check laeuft schon — haenge mich dran...\n");
  // tail -F (capital F) folgt dem Log auch wenn er noch nicht existiert
  // und ueberlebt File-Rotation. Das deckt den Race ab, in dem wir den
  // Lock sehen aber der Owner die Log-Datei noch nicht angelegt hat.
  const tail = Bun.spawn(["tail", "-n", "+1", "-F", logPath], {
    stdout: "inherit",
    stderr: "inherit",
  });

  while (existsSync(lockDir)) {
    await Bun.sleep(200);
  }
  tail.kill();
  await tail.exited;

  if (!existsSync(resultPath)) {
    console.error("\nLaufender Run beendet, aber kein Result gefunden — vermutlich gecrasht.");
    return 1;
  }
  const raw = readFileSync(resultPath, "utf8").trim();
  const code = Number.parseInt(raw, 10);
  return Number.isFinite(code) ? code : 1;
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
