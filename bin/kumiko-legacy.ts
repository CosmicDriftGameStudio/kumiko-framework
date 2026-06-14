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
import {
  formatCheckWorkContext,
  resolveCheckWorkContext,
} from "./_lib/check-work-context";
import {
  INTEGRATION_RUNNER,
} from "./_lib/integration-test";

// NODE_OPTIONS removed after bun cutover — no longer needed

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

const REPO_ROOT = resolvePath(import.meta.dir, "..", "..");
const BIN_PATH = (() => {
  const rootBin = join(REPO_ROOT, "node_modules", ".bin");
  if (existsSync(rootBin)) return rootBin;
  const localBin = join(process.cwd(), "node_modules", ".bin");
  if (existsSync(localBin)) return localBin;
  return rootBin; // Fallback
})();
const BIOME = join(BIN_PATH, "biome");
const TSC = join(BIN_PATH, "tsc");
const CHECK_APP_TSC = resolvePath(import.meta.dir, "..", "scripts", "check-app-tsc.ts");

// Geteilte Liste der CPU-bound, kurzlaufenden Steps. `kumiko check` hängt
// danach Unit-Tests (+ Integration lokal, nicht in CI) an; `kumiko check:fast`
// hängt nur `bun test --changed` an und skipt Integration komplett.
// Optional scope-down via env-var: `KUMIKO_CLI_SCOPE=kumiko-framework`
// (or comma-separated list) limits Biome/TypeScript per-repo steps + the
// Unit-Tests-loop to those repos. Used by the pre-push hook so "push
// from kumiko-framework" doesn't run all 5 repos' checks.
//
// Distinct from `KUMIKO_GUARD_ROOTS` (infra/guards/_lib/roots.ts): that
// one scopes the cross-repo source-file scan inside individual guards.
// We deliberately don't reuse it — many guards need kumiko-framework as
// a tooling-anchor (typing reference, ES-table discovery, ...) even when
// the actual scope of interest is one of the other repos.
const SCOPED_CLI_REPOS: ReadonlySet<string> | null = (() => {
  const env = process.env["KUMIKO_CLI_SCOPE"];
  if (!env) return null;
  const names = env
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return names.length > 0 ? new Set(names) : null;
})();

function inScope(repoName: string): boolean {
  return SCOPED_CLI_REPOS === null || SCOPED_CLI_REPOS.has(repoName);
}

/** Resolve sibling repo path; prefer git worktree when `kumiko check` runs from one. */
function repoAbsPath(repoName: string): string {
  const sibling = join(REPO_ROOT, repoName);
  const workCtx = resolveCheckWorkContext(process.cwd(), REPO_ROOT);
  if (workCtx.localRepoName === repoName && workCtx.localRepoPath) {
    return workCtx.localRepoPath;
  }
  return sibling;
}

const FAST_CHECK_STEPS: ReadonlyArray<{ readonly name: string; readonly cmd: string }> = (() => {
  const steps: Array<{ name: string; cmd: string }> = [];

  const siblings = [
    { name: "kumiko-framework", kind: "framework" },
    { name: "kumiko-enterprise", kind: "enterprise" },
    { name: "kumiko-studio", kind: "studio" },
    { name: "kumiko-platform", kind: "platform" },
    { name: "publicstatus", kind: "publicstatus" },
  ];

  for (const root of siblings) {
    if (!inScope(root.name)) continue;
    const absPath = repoAbsPath(root.name);
    if (!existsSync(absPath)) continue;

    // 1. Biome Check
    if (root.kind === "framework") {
      // Framework layout is special (packages/samples)
      steps.push({
        name: `Biome (${root.kind})`,
        cmd: `cd ${absPath} && ${BIOME} check packages samples`,
      });
    } else {
      steps.push({ name: `Biome (${root.kind})`, cmd: `cd ${absPath} && ${BIOME} check .` });
    }

    // 2. TypeScript Check
    if (root.kind === "framework") {
      // One `tsc -b` builds the framework packages (the root tsconfig
      // references exactly these seven) AND type-checks every sample against
      // the emitted .d.ts. Sole owner of packages/dist → no pool write-race,
      // and the framework graph is parsed once instead of per-sample (was a
      // separate `tsc -b .` + 52× `tsc --noEmit`, ~430s → ~15s cold / ~2s warm).
      steps.push({
        name: `TypeScript (framework + samples)`,
        cmd: `cd ${absPath} && bun scripts/check-app-tsc.ts`,
      });
    } else if (existsSync(join(absPath, "tsconfig.json"))) {
      steps.push({
        name: `TypeScript (${root.kind})`,
        cmd: `cd ${absPath} && ${TSC} --noEmit`,
      });
    } else if (root.kind === "platform") {
      // Platform has nested workspaces, call tsc directly to avoid yarn state issues
      steps.push({
        name: "TypeScript (platform/docs)",
        cmd: `cd ${join(absPath, "apps/docs")} && ${TSC} --noEmit`,
      });
      steps.push({
        name: "TypeScript (platform/marketing)",
        cmd: `cd ${join(absPath, "apps/marketing")} && ${TSC} --noEmit`,
      });
      steps.push({
        name: "TypeScript (platform/docgen)",
        cmd: `cd ${join(absPath, "tools/docgen")} && ${TSC} --noEmit`,
      });
    }
  }

  // 3. Guards (already cross-repo aware via roots.ts)
  steps.push({ name: "Silent-Skip Guard", cmd: "bunx kumiko-guard-silent-skip" });
  steps.push({ name: "Admin-API Guard", cmd: "bunx kumiko-guard-admin-api" });
  steps.push({ name: "Unsafe-JSON-Parse Guard", cmd: "bunx kumiko-guard-unsafe-json-parse" });
  steps.push({ name: "No-Function-Renderer Guard", cmd: "bunx kumiko-guard-no-function-renderer" });
  steps.push({ name: "No-Date-API Guard", cmd: "bunx kumiko-guard-no-date-api" });
  steps.push({ name: "Pre-ES-Patterns Guard", cmd: "bunx kumiko-guard-pre-es-patterns" });
  steps.push({ name: "Direct-Entity-Writes Guard", cmd: "bunx kumiko-guard-direct-entity-writes" });
  steps.push({ name: "Cross-Feature-Import Guard", cmd: "bunx kumiko-guard-cross-feature-imports" });
  steps.push({ name: "Renderer-Boundaries Guard", cmd: "bunx kumiko-guard-renderer-boundaries" });
  steps.push({
    name: "Primitives-Discipline Guard",
    cmd: "bunx kumiko-guard-primitives-discipline --strict-bundled",
  });
  steps.push({ name: "Fake-Test Guard", cmd: "bunx kumiko-guard-fake-tests" });
  steps.push({
    name: "Feature-Integration-Test Guard",
    cmd: "bunx kumiko-guard-feature-integration-tests",
  });
  steps.push({ name: "i18n-Keys Guard", cmd: "bunx kumiko-guard-i18n-keys" });
  steps.push({ name: "Test-Stack-Drift Guard", cmd: "bunx kumiko-guard-test-stack-drift" });
  steps.push({ name: "Runtime-Isolation Guard", cmd: "bunx kumiko-check-runtime-isolation" });
  steps.push({ name: "Error-Reasons Guard", cmd: "bunx kumiko-guard-error-reasons" });
  steps.push({ name: "Predicate Extraction Check", cmd: "bunx kumiko-check-predicates" });
  // Action-Wiring + Doc-Status waren als bins registriert, hingen aber an
  // keinem Pipeline-Step — ein nicht-aufgerufener Guard ist ein No-op.
  steps.push({ name: "Action-Wiring Guard", cmd: "bunx kumiko-guard-action-wiring" });
  // Doc-Status braucht das Multi-Repo-Parent (STATUS.md lebt in
  // kumiko-platform) — im standalone CI-Checkout existiert das nicht.
  // LAUT überspringen statt silent-skip; der Drift-Check läuft im lokalen
  // Parent-Kontext, wo bun run check vor jedem Push Pflicht ist.
  if (existsSync(join(REPO_ROOT, "kumiko-platform"))) {
    steps.push({ name: "Doc-Status Guard", cmd: "bunx kumiko-guard-doc-status" });
    steps.push({ name: "Doc-Status-Index Drift", cmd: "bunx kumiko-docs-status-index" });
  } else {
    console.log("Doc-Status-Steps übersprungen: kumiko-platform nicht im Workspace (CI-standalone).");
  }
  // TODO(2026-07-03): re-enable as-Cast Audit — coverage extended to all repos
  // (enterprise, platform, solon, .tsx) in check-as-casts.ts; baseline must be
  // regenerated with `--write-baseline` from framework repo after validation.
  // steps.push({ name: "as-Cast Audit", cmd: "bunx kumiko-check-as-casts" });
  steps.push({ name: "Table-DDL Guard", cmd: "bunx kumiko-guard-table-ddl" });
  const frameworkRepoRoot = resolvePath(import.meta.dir, "..");
  const rawSqlGuard = join(REPO_ROOT, "infra/guards/guard-raw-sql.ts");
  const sqlInventoryScript = join(frameworkRepoRoot, "scripts/sql-inventory.ts");
  steps.push({
    name: "Raw-SQL Guard",
    cmd: existsSync(rawSqlGuard)
      ? `bun ${rawSqlGuard}`
      : existsSync(sqlInventoryScript)
        ? `cd ${frameworkRepoRoot} && bun scripts/sql-inventory.ts --compare-baseline`
        : "bunx kumiko-guard-raw-sql",
  });
  steps.push({ name: "License Check", cmd: "bunx kumiko-check-licenses" });

  return steps;
})();

const UNIT_TEST_STEPS: ReadonlyArray<{ readonly name: string; readonly cmd: string }> = (() => {
  const steps: Array<{ name: string; cmd: string }> = [];
  const siblings = [
    { name: "kumiko-framework", kind: "framework" },
    { name: "kumiko-enterprise", kind: "enterprise" },
    { name: "kumiko-studio", kind: "studio" },
    { name: "kumiko-platform", kind: "platform" },
    { name: "publicstatus", kind: "publicstatus" },
  ];

  for (const root of siblings) {
    if (!inScope(root.name)) continue;
    const absPath = repoAbsPath(root.name);
    if (!existsSync(absPath)) continue;

    if (existsSync(join(absPath, "bunfig.toml"))) {
      const ciFlag = root.name === "kumiko-framework" && process.env.CI === "true"
        ? " --config=bunfig.ci.toml" : "";
      steps.push({
        name: `Unit Tests (${root.kind})`,
        cmd: `cd ${absPath} && KUMIKO_CHECK=1 bun${ciFlag} --env-file=../.env test`,
      });
    }
  }
  return steps;
})();

const INTEGRATION_TEST_STEPS: ReadonlyArray<{ readonly name: string; readonly cmd: string }> =
  (() => {
    const steps: Array<{ name: string; cmd: string }> = [];
    if (!inScope("kumiko-framework")) return steps;

    const absPath = repoAbsPath("kumiko-framework");
    if (!existsSync(absPath)) return steps;
    if (!existsSync(join(absPath, INTEGRATION_RUNNER))) return steps;

    steps.push({
      name: "Integration Tests (framework)",
      cmd: `cd ${absPath} && bun ${INTEGRATION_RUNNER}`,
    });
    return steps;
  })();

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
      console.log(`  MinIO (S3)   localhost:${Bun.env.KUMIKO_MINIO_PORT ?? "19000"}`);
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
      const { runCodegen } = await import("@cosmicdrift/kumiko-dev-server");
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
      const { buildProdBundle, formatBuildResult } = await import("@cosmicdrift/kumiko-dev-server/build");
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
      // CLI: bun kumiko create <name> [--path <destination>]
      //   <name>: required, camelCase feature-Identifier (validiert)
      //   --path: optional Override; default samples/recipes/<kebab-name>/
      //
      // Output: minimal-Workspace mit package.json + src/feature.ts.
      // feature.ts ist canonical Object-Form (// kumiko-feature-version: 1)
      // mit einem Starter-Entity — direkt durch parser/patcher
      // weiterbearbeitbar. bun install nach create für Workspace-Wiring.
      const { scaffoldFeature } = await import("@cosmicdrift/kumiko-dev-server");
      const args = Bun.argv.slice(3);
      const name = args.find((a) => !a.startsWith("--"));
      if (!name) {
        console.error("\n  Usage: bun kumiko create <camelCaseName> [--path <dir>]\n");
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
            "  Next: run bun install, then edit src/feature.ts.\n",
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
        await $`bun test`;
        await $`bun ${INTEGRATION_RUNNER}`;
      } else if (scope === "integration") {
        console.log("Integration Tests (Docker muss laufen)...\n");
        await $`bun ${INTEGRATION_RUNNER}`;
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
        await $`bun test ${scope}`;
      } else {
        await $`bun test`;
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

      const workCtx = resolveCheckWorkContext(process.cwd(), REPO_ROOT);
      logBoth(`${formatCheckWorkContext(workCtx)}\n`, logPath);
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
      //
      // Integration-Tests lokal in `check`, in CI skip (brauchen Docker-Stack).
      for (const step of UNIT_TEST_STEPS) {
        logBoth(`--- ${step.name} ---`, logPath);
        const code = await runWithTee(step.cmd, logPath);
        results.push({ name: step.name, ok: code === 0 });
        logBoth("", logPath);
      }

      if (process.env.CI === "true") {
        logBoth("--- Integration Tests (framework) --- skipped (CI)", logPath);
      } else {
        for (const step of INTEGRATION_TEST_STEPS) {
          logBoth(`--- ${step.name} ---`, logPath);
          const code = await runWithTee(step.cmd, logPath);
          results.push({ name: step.name, ok: code === 0 });
          logBoth("", logPath);
        }
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
      const proc = Bun.spawn(["sh", "-c", "KUMIKO_CHECK=1 bun test --changed"], {
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
      const SPLIT_OUT = new Set(["Biome", "TypeScript", "TypeScript (framework + samples)"]);
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
        features: readonly import("@cosmicdrift/kumiko-framework/engine").FeatureDefinition[];
      };

      const { createRegistry } = await import("@cosmicdrift/kumiko-framework/engine");
      const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db");
      const {
        listProjectionsWithState,
        getProjectionState,
        rebuildProjection,
        createProjectionStateTable,
      } = await import("@cosmicdrift/kumiko-framework/pipeline");

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
            console.error("\n  Usage: bun kumiko project status <projection-name>\n");
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
            console.error("\n  Usage: bun kumiko project rebuild <projection-name>\n");
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
          console.log("\n  Usage: bun kumiko project <list | status <name> | rebuild <name>>\n");
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
        console.log("\n  Usage: bun kumiko events prune [--older-than <days>] [--dry-run]\n");
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

      const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db");
      const { ConsumerLagError, pruneEvents } = await import("@cosmicdrift/kumiko-framework/pipeline");

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
            `    ${dim}Options: catch up the consumer, disable it, or "bun kumiko consumer skip <name>".${reset}\n`,
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
              console.error("\n  Usage: bun kumiko consumer status <consumer-name>\n");
              process.exit(1);
            }
            const state = await getConsumerState(db, arg);
            if (!state) {
              if (!registeredConsumerNames.includes(arg)) {
                console.error(
                  `\n  Consumer "${arg}" ist nicht registriert. Liste via "bun kumiko consumer list".\n`,
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
              console.error("\n  Usage: bun kumiko consumer restart <consumer-name>\n");
              process.exit(1);
            }
            const state = await restartConsumer(db, arg);
            printOutcome("restarted", state);
            console.log(`    ${dim}cursor remains at ${state.lastProcessedEventId}; dispatcher will retry the failing event next pass.${reset}\n`);
            break;
          }

          case "disable": {
            if (!arg) {
              console.error("\n  Usage: bun kumiko consumer disable <consumer-name>\n");
              process.exit(1);
            }
            const state = await disableConsumer(db, arg);
            printOutcome("disabled", state);
            break;
          }

          case "enable": {
            if (!arg) {
              console.error("\n  Usage: bun kumiko consumer enable <consumer-name>\n");
              process.exit(1);
            }
            const state = await enableConsumer(db, arg);
            printOutcome("enabled", state);
            break;
          }

          case "skip": {
            if (!arg) {
              console.error("\n  Usage: bun kumiko consumer skip <consumer-name>\n");
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
              "\n  Usage: bun kumiko consumer <list | status <name> | restart <name> | disable <name> | enable <name> | skip <name>>\n",
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
        hint: existsSync("node_modules") ? undefined : "bun install",
      });

      let dockerOk = false;
      try {
        const result = await $`docker compose ps --format json`.quiet();
        dockerOk = result.stdout.toString().trim().split("\n").filter(Boolean).length > 0;
      } catch {}
      checks.push({
        name: "docker services",
        ok: dockerOk,
        hint: dockerOk ? undefined : "bun kumiko dev",
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

  ops: {
    description:
      "ES-Operations — kumiko ops seed:new <slug> | seed:status | seed:apply [--dry-run]",
    run: async () => {
      const { runOpsCommand } = await import("./ops.ts");
      await runOpsCommand(Bun.argv.slice(3));
    },
  },

  codemod: {
    description:
      "Code-Migrationen — kumiko codemod pipeline [--dry-run] [--verbose] [--dir <path>]",
    run: async () => {
      const subcommand = Bun.argv[3];
      if (subcommand !== "pipeline") {
        console.log(
          "\n  Usage: bun kumiko codemod pipeline [--dry-run] [--verbose] [--dir <path>]\n" +
            "    --dry-run    Preview changes without writing\n" +
            "    --verbose    Show per-file conversion details\n" +
            "    --dir        Target directory (default: current directory)\n",
        );
        return;
      }

      const dryRun = Bun.argv.includes("--dry-run");
      const verbose = Bun.argv.includes("--verbose");
      const dirIdx = Bun.argv.indexOf("--dir");
      const targetDir = dirIdx >= 0 ? resolvePath(Bun.argv[dirIdx + 1]!) : process.cwd();

      const { runCodemod } = await import(
        "../packages/framework/src/engine/codemod/index.ts"
      );

      console.log(dryRun ? "\n  🔍 DRY RUN — no files will be modified\n" : "");
      console.log(`  Codemod: convert free-form write handlers → pipeline form`);

      const report = await runCodemod(targetDir, { dryRun, verbose });

      if (report.converted > 0) {
        console.log(`\n  ${dryRun ? "Would convert" : "Converted"} ${report.converted} handler(s).`);
      }
      if (report.errors > 0) {
        console.log(`\n  ${report.errors} error(s) during conversion. Use --verbose for details.`);
      }
    },
  },
} satisfies Record<string, { description: string; run: () => Promise<void> }>;

// --- Interactive menu ---

async function interactiveMenu(): Promise<void> {
  // Sprint A spike: Ink-TUI für interactive Browsing. Wenn das Modul
  // nicht installiert oder Ink lädt fehlschlägt, fallback auf das alte
  // Number-Input-Menü (keep working-on-any-machine garantie).
  if (process.stdout.isTTY) {
    try {
      const { runTui } = await import("./kumiko-tui/index.tsx");
      await runTui();
      return;
    } catch (e) {
      console.warn(
        `\n  Ink-TUI nicht verfügbar (${e instanceof Error ? e.message : "?"}), fallback to legacy menu.\n`,
      );
    }
  }

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

// Easter egg: `bun kumiko prost` — for when you need a moment.
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
      console.error(`\n  I don't know "${command}". Maybe a typo? Try: bun kumiko help\n`);
      process.exit(1);
    }
    await handler.run();
  }
}
