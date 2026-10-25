#!/usr/bin/env bun

import { $ } from "bun";
import { createWriteStream, existsSync, readdirSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import {
  formatCheckWorkContext,
  resolveCheckWorkContext,
} from "./_lib/check-work-context";
import {
  acquireCheckLock,
  checkLockPaths,
  followCheck,
  parseCliScope,
  registerLockCleanup,
} from "./_lib/check-lock";
import { decideGuardScanRoot } from "./_lib/guard-scan-root";

// Fast checks are CPU-bound (tsc, ts-morph guards). A fixed pool=6 thrashes
// wherever spare CPU < 6 — the 1-CPU CI runner, or a loaded dev box (4 parallel
// sessions) — inflating every step 5-6×. Size to *currently free* capacity
// (cores − 1-min load), not raw core count, so a busy machine doesn't
// oversubscribe. Override with KUMIKO_FAST_POOL.
const FAST_POOL =
  Number(process.env.KUMIKO_FAST_POOL) ||
  Math.max(1, Math.min(availableParallelism() - 1, Math.round(availableParallelism() - loadavg()[0])));
import {
  INTEGRATION_RUNNER,
} from "./_lib/integration-test";
import {
  findOutputDiagnostics,
  formatCompactFailure,
  formatCompactSuccess,
  formatDiagnosticLines,
  isCI,
} from "./_lib/ci-output";

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
    console.warn(`\n  Hmm, something is missing:\n${missing.join("\n")}\n  -> cp .env.example .env\n`);
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
// Derived from import.meta, not repoAbsPath: under .wt/ the latter resolves
// siblings of the worktree dir, not of this checkout.
const FRAMEWORK_REPO_ROOT = resolvePath(import.meta.dir, "..");
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
const KUMIKO_CLI = resolvePath(import.meta.dir, "..", "packages", "cli", "bin", "cli.ts");

// Shared list of CPU-bound, short-running steps. `kumiko check` appends
// unit tests afterwards (+ integration locally, not in CI); `kumiko check:fast`
// appends only `bun test --changed` and skips integration entirely.
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
  const names = parseCliScope(process.env["KUMIKO_CLI_SCOPE"]);
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

/**
 * cwd for the guard runners: the pushed repo when the run is scoped to exactly
 * one (the pre-push case), else this framework checkout as the tooling anchor.
 * Never the parent workspace — that resolves no repo root at all.
 */
function guardScanRoot(): string {
  const scoped = SCOPED_CLI_REPOS && SCOPED_CLI_REPOS.size === 1 ? [...SCOPED_CLI_REPOS][0] : undefined;
  const candidate = scoped !== undefined ? repoAbsPath(scoped) : undefined;
  const decision = decideGuardScanRoot({
    scopedRepo: scoped,
    scopedRepoPath: candidate,
    scopedRepoExists: candidate !== undefined && existsSync(candidate),
    anchorPath: FRAMEWORK_REPO_ROOT,
  });
  if (decision.kind === "missing-scoped-repo") {
    console.error(
      `KUMIKO_CLI_SCOPE=${decision.repo}: repo path not found at ${decision.path} — refusing to fall back to the framework checkout`,
    );
    process.exit(1);
  }
  return decision.path;
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
      // One `tsc -b` builds every root project (framework, bundled-features,
      // testing, testing/e2e, guards, cli, …, via the root tsconfig.json
      // reference) AND type-checks every sample against the emitted .d.ts.
      // Sole owner of packages/dist → no pool write-race, and the framework
      // graph is parsed once instead of per-sample (was a separate `tsc -b .`
      // + 52× `tsc --noEmit`, ~430s → ~15s cold / ~2s warm).
      steps.push({
        name: `TypeScript (framework + samples)`,
        cmd: `cd ${absPath} && bun scripts/check-app-tsc.ts`,
      });
    } else if (root.kind === "platform") {
      // Nested workspaces plus generated Astro types: the repo's own script
      // owns that layout and runs `astro sync` before tsc.
      steps.push({
        name: `TypeScript (${root.kind})`,
        cmd: `cd ${absPath} && bun run typecheck`,
      });
    } else if (existsSync(join(absPath, "tsconfig.json"))) {
      steps.push({
        name: `TypeScript (${root.kind})`,
        cmd: `cd ${absPath} && ${TSC} --noEmit`,
      });
    }
  }

  // 3. Boot validation + guard suites: delegated to the published `kumiko
  // check` (packages/cli), step list derived from the scanned repo's kumiko.json.
  const guardCwd = guardScanRoot();
  steps.push({ name: "kumiko check (boot + guard suites)", cmd: `cd "${guardCwd}" && bun "${KUMIKO_CLI}" check` });
  // Warn-only (exit 0): run-config preset names vs composeStacks fingerprints.
  // Parent-workspace only until kumiko-guard-compose-stacks-parity is published.
  const composeStacksParityGuard = join(REPO_ROOT, "infra/guards/guard-compose-stacks-parity.ts");
  if (existsSync(composeStacksParityGuard)) {
    steps.push({
      name: "Compose-Stacks-Parity Guard",
      cmd: `bun "${composeStacksParityGuard}"`,
    });
  }
  // Runtime-isolation runs inside the `kumiko check` step above (checks bundle).
  // Guards living in the parent workspace's infra/ are optional: without the file
  // (standalone CI checkout) the step is skipped loudly, never through a bunx fallback
  // that could resolve a same-named foreign package from the public registry.
  const pushInfraGuardStep = (name: string, file: string, args = ""): void => {
    const guardPath = join(REPO_ROOT, "infra/guards", file);
    if (existsSync(guardPath)) {
      steps.push({ name, cmd: `bun "${guardPath}"${args}` });
    } else {
      console.log(`${name} skipped: infra/guards/${file} not in workspace (CI-standalone).`);
    }
  };
  // Doc-Status needs the multi-repo parent (STATUS.md lives in kumiko-platform), which
  // a standalone CI checkout lacks. Skip loudly; the drift check runs in the local
  // parent context, where `bun run check` is mandatory before every push.
  if (existsSync(join(REPO_ROOT, "kumiko-platform"))) {
    pushInfraGuardStep("Doc-Status Guard", "guard-doc-status.ts");
    pushInfraGuardStep("Doc-Status-Index Drift", "docs-status-index.ts");
    // Concept pages must start with "## In plain words" (docs standard,
    // kumiko-platform docs/reference/doku-standard.md).
    pushInfraGuardStep("Docs-Plain-Words Guard", "guard-docs-plain-words.ts", " --strict");
    // Needs the legal-templates source (kumiko-platform/tools/legal-templates)
    // to verify committed app JSONs against a fresh compilation.
    pushInfraGuardStep("Legal-Template-Drift Guard", "guard-legal-template-drift.ts");
  } else {
    console.log("Doc-Status steps skipped: kumiko-platform not in workspace (CI-standalone).");
  }
  // TODO(2026-07-03): re-enable as-Cast Audit — coverage extended to all repos
  // (enterprise, platform, solon, .tsx) in check-as-casts.ts; baseline must be
  // regenerated with `--write-baseline` from framework repo after validation.
  // App-Dockerfile Guard needs the app-repo siblings in the parent workspace,
  // hence loud-skip in a standalone checkout (infra#514).
  const appDockerfileGuard = join(REPO_ROOT, "infra/guards/guard-app-dockerfile.ts");
  if (existsSync(appDockerfileGuard)) {
    steps.push({ name: "App-Dockerfile Guard", cmd: `bun ${appDockerfileGuard}` });
  } else {
    console.log("App-Dockerfile Guard skipped: infra/guards not in workspace (CI-standalone).");
  }
  // Baseline regression guard (infra#295): fails only on NEW DE comments,
  // existing hits are frozen via .kumiko-comment-lang-baseline.json.
  steps.push({ name: "Comment-Language Guard", cmd: "bunx kumiko-guards comment-lang" });
  steps.push({
    name: "Public-Exports-Changelog Guard",
    cmd: "bunx kumiko-guards public-exports-changelog --base=origin/main",
  });
  // Agent-Manifest Guard (infra#702). The parent workspace's cross-repo guard also
  // flags apps without a kumiko.config.ts. A standalone checkout lints this repo's own
  // sample configs with `kumiko agent lint` (same findAgentDocGaps rule); finding none
  // fails instead of passing vacuously.
  const agentManifestGuard = join(REPO_ROOT, "infra/guards/guard-agent-manifest.ts");
  if (existsSync(agentManifestGuard)) {
    steps.push({ name: "Agent-Manifest Guard", cmd: `bun "${agentManifestGuard}"` });
  } else {
    const sampleConfigDirs = ["samples/apps", "samples/recipes"].flatMap((sampleRoot) => {
      const samplesDir = join(FRAMEWORK_REPO_ROOT, sampleRoot);
      if (!existsSync(samplesDir)) return [];
      return readdirSync(samplesDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(samplesDir, entry.name))
        .filter((dir) => existsSync(join(dir, "kumiko.config.ts")));
    });
    if (sampleConfigDirs.length === 0) {
      steps.push({
        name: "Agent-Manifest Guard",
        cmd: `echo "Agent-Manifest Guard: no samples/apps/*/kumiko.config.ts or samples/recipes/*/kumiko.config.ts found under ${FRAMEWORK_REPO_ROOT}, nothing to lint." >&2 && exit 1`,
      });
    }
    for (const dir of sampleConfigDirs.sort()) {
      steps.push({
        name: `Agent-Manifest Guard (${dir.slice(FRAMEWORK_REPO_ROOT.length + 1)})`,
        cmd: `cd "${dir}" && bun "${KUMIKO_CLI}" agent lint`,
      });
    }
  }
  // Baseline regression guard (infra#440): fails only on NEW structural
// duplicates (cross-module/cross-file), existing entries via
// .kumiko-semantic-duplicates-baseline.json frozen. Cross-repo scan
// (see roots.ts); runs only from the parent workspace, no bunx
// fallback (a standalone checkout has no sibling repos to scan).
  const semanticDuplicatesGuard = join(REPO_ROOT, "infra/guards/guard-semantic-duplicates.ts");
  if (existsSync(semanticDuplicatesGuard)) {
    steps.push({ name: "Semantic-Duplicates Guard", cmd: `bun ${semanticDuplicatesGuard}` });
  } else {
    console.log(
      "Semantic-Duplicates guard skipped: infra/guards not in workspace (CI-standalone).",
    );
  }
  // Stay on 0.x — block major changesets and package.json major ≥ 1 (accidental 1.0/2.0).
  steps.push({
    name: "No-Major-Gt-Zero Guard",
    cmd: `bun ${join(FRAMEWORK_REPO_ROOT, "scripts/guard-no-major-gt-zero.ts")}`,
  });
  // Uses the framework's own parseFeatureChangelog/validateChangelog/compareVersions
  // so the rules cannot drift from the runtime parser; also owns the kumiko-changes-block
  // and direct-edit rules that the former private feature-changelog guard enforced.
  steps.push({
    name: "Changes-JSON Guard",
    cmd: `bun "${join(FRAMEWORK_REPO_ROOT, "scripts/guard-changes-json.ts")}"`,
  });
  // The platform docs build rejects bare ts blocks in guides it copies from here.
  steps.push({
    name: "Guide-Code-Blocks Guard",
    cmd: `bun "${join(FRAMEWORK_REPO_ROOT, "scripts/guard-guide-code-blocks.ts")}"`,
  });
  steps.push({
    name: "Package-Cycles Check",
    cmd: `bun "${join(FRAMEWORK_REPO_ROOT, "scripts/check-package-cycles.ts")}"`,
  });
  steps.push({
    name: "Integration-Mock Guard",
    cmd: `cd "${FRAMEWORK_REPO_ROOT}" && bun integration.guard.ts`,
  });
  // Local override only; the "kumiko check" step above already covers
  // raw-sql detection via the public package when this file is absent.
  const rawSqlGuard = join(REPO_ROOT, "infra/guards/guard-raw-sql.ts");
  if (existsSync(rawSqlGuard)) {
    steps.push({ name: "Raw-SQL Guard", cmd: `bun ${rawSqlGuard}` });
  } else {
    console.log('Raw-SQL guard skipped: already covered by "kumiko check".');
  }
  steps.push({ name: "License Check", cmd: "bunx kumiko-guards licenses" });
  steps.push({ name: "Security Audit", cmd: "bunx kumiko-guards security" });
  // Cross-repo scan: gates on the guard file (parent workspace) and LAUT-skips
  // standalone — no bunx fallback, the pinned guards version doesn't ship this bin.
  const secretLiteralGuard = join(REPO_ROOT, "infra/guards/check-secret-literals.ts");
  if (existsSync(secretLiteralGuard)) {
    steps.push({ name: "Secret-Literal Guard", cmd: `bun ${secretLiteralGuard}` });
  } else {
    console.log("Secret-Literal guard skipped: infra/guards not in workspace (CI-standalone).");
  }
  const processEnvGuard = join(REPO_ROOT, "infra/guards/guard-no-direct-process-env.ts");
  if (existsSync(processEnvGuard)) {
    steps.push({ name: "No-Direct-Process-Env Guard", cmd: `bun ${processEnvGuard}` });
  } else {
    console.log(
      "No-Direct-Process-Env guard skipped: infra/guards not in workspace (CI-standalone).",
    );
  }
  // No bunx fallback here on purpose: the guard checks GUARD_REPO_PRESETS (the
  // required repo list), not just whatever siblings happen to exist — a
  // standalone run with missing siblings would fail for a reason unrelated to
  // this repo's own renovate.json, so it only runs from the parent workspace.
  const renovatePresetsGuard = join(REPO_ROOT, "infra/guards/check-renovate-presets.ts");
  if (existsSync(renovatePresetsGuard)) {
    steps.push({ name: "Renovate-Presets Guard", cmd: `bun ${renovatePresetsGuard}` });
  } else {
    console.log("Renovate-Presets guard skipped: infra/guards not in workspace (CI-standalone).");
  }
  const subpathExportsGuard = join(REPO_ROOT, "infra/guards/check-subpath-exports.ts");
  if (existsSync(subpathExportsGuard)) {
    steps.push({ name: "Subpath-Exports Guard", cmd: `bun ${subpathExportsGuard}` });
  } else {
    console.log("Subpath-Exports guard skipped: infra/guards not in workspace (CI-standalone).");
  }
  // No bunx fallback here on purpose (infra#538): the guard reads the parent's
  // own `workspaces` array, not just whatever siblings happen to exist — it
  // only makes sense from the parent workspace.
  const workspaceDriftGuard = join(REPO_ROOT, "infra/guards/check-workspace-drift.ts");
  if (existsSync(workspaceDriftGuard)) {
    steps.push({ name: "Workspace-Drift Guard", cmd: `bun ${workspaceDriftGuard}` });
  } else {
    console.log("Workspace-Drift guard skipped: infra/guards not in workspace (CI-standalone).");
  }
  steps.push({ name: "Deprecated Deps", cmd: "bunx kumiko-guards outdated" });

  return steps;
})();

// bun 1.4.0's --parallel implies --isolate, which leaks native memory per
// test file until it OOMs the runner; --no-isolate keeps the speedup without it.
const FRAMEWORK_UNIT_TEST_PARALLEL = 4;

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
      const ciFlag =
        process.env.CI === "true" && existsSync(join(absPath, "bunfig.ci.toml"))
          ? " --config=bunfig.ci.toml"
          : "";
      const parallelFlags =
        root.kind === "framework" ? ` --parallel=${FRAMEWORK_UNIT_TEST_PARALLEL} --no-isolate` : "";
      steps.push({
        name: `Unit Tests (${root.kind})`,
        cmd: `cd ${absPath} && KUMIKO_CHECK=1 bun${ciFlag} --env-file=../.env test${parallelFlags}`,
      });
    }

    // DOM/render tests (*.test.tsx) run separately from the node-only unit run
    // (Issue #1330) — repos with bunfig.dom.toml get their own step.
    if (existsSync(join(absPath, "bunfig.dom.toml"))) {
      steps.push({
        name: `DOM Tests (${root.kind})`,
        cmd: `cd ${absPath} && bun test --dots --config=bunfig.dom.toml --timeout=15000 .test.tsx`,
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
    description: "Here we go! Start Docker services",
    run: async () => {
      console.log("Wake up PostgreSQL and Redis...");
      await $`docker compose up -d`.quiet();
      await waitForPostgres();
      console.log(`  PostgreSQL   localhost:${Bun.env.KUMIKO_PG_PORT ?? "15432"}`);
      console.log(`  Redis        localhost:${Bun.env.KUMIKO_REDIS_PORT ?? "16379"}`);
      console.log(`  Meilisearch  localhost:${Bun.env.KUMIKO_MEILI_PORT ?? "17700"}`);
      console.log(`  MinIO (S3)   localhost:${Bun.env.KUMIKO_MINIO_PORT ?? "19000"}`);
      console.log("\nRunning! Happy coding.");
    },
  },

  stop: {
    description: "Done for the day. Stop Docker services",
    run: async () => {
      console.log("Shutting everything down...");
      await $`docker compose down`.quiet();
      console.log("Everything off. See you tomorrow!");
    },
  },

  reset: {
    description: "Tabula rasa. Everything wiped, everything new",
    run: async () => {
      console.log("Delete everything and start fresh...");
      await $`docker compose down -v`.quiet();
      await $`docker compose up -d`.quiet();
      await waitForPostgres();
      console.log("Like new. No byte survives.");
    },
  },

  build: {
    description: "Production build for an app (dist/) — takes path or $INIT_CWD",
    run: async () => {
      // Discovery + Bun.build + Tailwind + Public-folder copy.
// Convention-driven: src/client.tsx → bundle, src/styles.css →
// Tailwind, public/ → 1:1, index.html → Template. Output lands
// under <cwd>/dist.
//
// CWD-Resolution:
//   1. Bun.argv[3] (explicit path)        → kumiko build samples/apps/showcase
//   2. $INIT_CWD (yarn workspace invocation)  → cd <app> && yarn build
//   3. process.cwd() (fallback)arn build
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
    description: "Scaffold an empty feature workspace — kumiko create <camelCaseName> [--path <dir>]",
    run: async () => {
      // CLI: bun kumiko create <name> [--path <destination>]
//   <name>: required, camelCase feature identifier (validated)
//   --path: optional override; default samples/recipes/<kebab-name>/
//
// Output: minimal workspace with package.json + src/feature.ts.
// feature.ts is canonical Object form (// kumiko-feature-version: 1)
// with a starter entity — directly editable through the parser/patcher
// afterwards. Run bun install after create for workspace wiring.
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
    description: "Delete orphaned kumiko_test_* DBs (SIGKILLed tests, aborted runs)",
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
    description: "Run tests (test | integration | e2e | all | <path>)",
    run: async () => {
      const scope = Bun.argv[3];
      if (scope === "all") {
        console.log("Full blast — Unit + DOM + Integration...\n");
        await $`bun test --dots`;
        if (existsSync("bunfig.dom.toml")) {
          await $`bun test --dots --config=bunfig.dom.toml --timeout=15000 .test.tsx`;
        }
        await $`bun ${INTEGRATION_RUNNER}`;
      } else if (scope === "integration") {
        console.log("Integration tests (Docker must be running)...\n");
        await $`bun ${INTEGRATION_RUNNER}`;
      } else if (scope === "e2e") {
        // E2E runs opt-in (not part of `kumiko check`). Each
        // Package/Sample with a playwright.config.ts gets a
        // separate run — the webServer hook boots the real dev-
        // server per Config. Docker must be running (Postgres + Redis, like the
        // integration tests). Packages first (smaller scope),
        // then Sample apps + Showcases.
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
            "No E2E configs found (packages/*/playwright.config.ts or samples/{apps,showcases}/*/playwright.config.ts).",
          );
          return;
        }
        const labels = targets.map((t) => `${t.root}/${t.name}`).join(", ");
        console.log(`E2E via Playwright — ${targets.length} Target(s): ${labels}\n`);
        for (const target of targets) {
          console.log(`\n=== ${target.root}/${target.name} ===`);
          // Yarn 4 resolves `yarn <bin>` only from the workspace's direct deps,
          // and `@playwright/test` lives only in the root package.json, so we
          // invoke the hoisted bin directly from the root node_modules/.bin/.
          const playwrightBin = `${process.cwd()}/node_modules/.bin/playwright`;
          await $`${playwrightBin} test`.cwd(`${target.root}/${target.name}`);
        }
      } else if (scope) {
        await $`bun test --dots ${scope}`;
      } else {
        await $`bun test --dots`;
      }
    },
  },

  check: {
    description: "Check everything: Lint, Types, Tests",
    run: async () => {
      // Parallel dedup: two concurrent `kumiko check` runs for the SAME
      // scope should only do the real work once. The first call holds the
      // lock and streams output to console AND a log file; follow-up calls
      // tail the log live and adopt the exit code from the result file.
      //
      // Lock/log/result are named after KUMIKO_CLI_SCOPE: the pre-push hook
      // cd's into the same parent workspace for EVERY sub-repo, so scope-
      // less file names would let concurrent pushes from different repos
      // collide on the same lock — the loser would then adopt the other
      // repo's scope and exit code (infra#722).
      const workCtx = resolveCheckWorkContext(process.cwd(), REPO_ROOT);
      const { lockDir, logPath, resultPath } = checkLockPaths(workCtx.cliScope);

      if (!acquireCheckLock(lockDir, logPath, resultPath)) {
        const code = await followCheck(lockDir, logPath, resultPath);
        if (code !== 0) process.exit(code);
        return;
      }

      registerLockCleanup(lockDir);

      logBoth(`${formatCheckWorkContext(workCtx)}\n`, logPath);
      logBoth("Check everything...\n", logPath);
      const results: Array<{ name: string; ok: boolean }> = [];

      logBoth(`--- ${FAST_CHECK_STEPS.length} fast checks (parallel, pool=${FAST_POOL}) ---`, logPath);
      const fastResults = await runPoolBuffered(FAST_CHECK_STEPS, FAST_POOL, logPath);
      for (const r of fastResults) results.push(r);
      logBoth("", logPath);

      // KUMIKO_CHECK=1 enables the higher Vitest thread cap (8 instead of 4)
// in vitest.config.ts — the box is saturated anyway during a
// check run, so wall-time should count. In Watch mode/IDE the
// conservative default stays active.
//
// Integration tests locally in `check`, skip in CI (require Docker stack). skip (requires Docker stack).
      for (const step of UNIT_TEST_STEPS) {
        logBoth(`--- ${step.name} ---`, logPath);
        const code = await runWithTee(step.cmd, logPath, step.name);
        results.push({ name: step.name, ok: code === 0 });
        logBoth("", logPath);
      }

      if (process.env.CI === "true") {
        logBoth("--- Integration Tests (framework) --- skipped (CI)", logPath);
      } else {
        for (const step of INTEGRATION_TEST_STEPS) {
          logBoth(`--- ${step.name} ---`, logPath);
          const code = await runWithTee(step.cmd, logPath, step.name);
          results.push({ name: step.name, ok: code === 0 });
          logBoth("", logPath);
        }
      }

      const allGood = results.every((r) => r.ok);
      logBoth(allGood ? "All green!" : "Some steps need attention:", logPath);
      for (const r of results) {
        logBoth(`  ${r.ok ? "PASS" : "FAIL"} ${r.name}`, logPath);
      }

      writeFileSync(resultPath, allGood ? "0" : "1");
      if (!allGood) process.exit(1);
    },
  },

  "check:fast": {
    description: "Fast check (skip Integration, Unit tests only --changed)",
    run: async () => {
      // Deliberately no lock and no Tee logfile — check:fast is for
      // quick iteration in between (5-15s), not a shared CI-
      // operation. If someone runs `kumiko check` in parallel,
      // there's IO contention on .tsbuildinfo but no actual conflict.
      console.log("Fast check — Integration is skipped.\n");
      const results: Array<{ name: string; ok: boolean }> = [];

      console.log(`--- ${FAST_CHECK_STEPS.length} fast checks (parallel, pool=${FAST_POOL}) ---`);
      // runPoolBuffered requires a logPath; we pass /dev/null —
      // Output shows the ✓/✗ live line per step plus failed outputs anyway.
      const fastResults = await runPoolBuffered(FAST_CHECK_STEPS, FAST_POOL, "/dev/null");
      for (const r of fastResults) results.push(r);
      console.log();

      console.log("--- Unit Tests (only --changed) ---");
      const proc = Bun.spawn(["sh", "-c", "KUMIKO_CHECK=1 bun test --dots --changed"], {
        stdout: "inherit",
        stderr: "inherit",
        env: process.env,
      });
      const code = await proc.exited;
      results.push({ name: "Unit Tests (changed)", ok: code === 0 });
      console.log();

      const allGood = results.every((r) => r.ok);
      console.log(allGood ? "Fast check green." : "Fast check red:");
      for (const r of results) {
        console.log(`  ${r.ok ? "PASS" : "FAIL"} ${r.name}`);
      }
      console.log("\nBefore commit: `kumiko check` for the full suite (including Integration).");
      if (!allGood) process.exit(1);
    },
  },

  // CI-only subcommands — split FAST_CHECK_STEPS into parallel
  // GitHub-Actions jobs. Trade-off to the single-`kumiko check`-CLI: in CI
  // halve wall-time via job parallelism, locally `kumiko
  // check` remains the single-call aggregator.
  //
  // Drift protection: ci:guards runs FAST_CHECK_STEPS minus the explicitly
  // named Lint/TSC steps. New guards in FAST_CHECK_STEPS end up
  // automatically in the CI-guards job, without touching ci.yml.
  "ci:guards": {
    description: "CI-only — all guards/audits from FAST_CHECK_STEPS except Lint/TSC (parallel)",
    run: async () => {
      // Lint and TSC run in separate CI jobs — excluded here, otherwise
      // duplicate effort. These three names are the only place
      // where the split is defined manually; everything else
      // is captured automatically.
      const SPLIT_OUT = new Set(["Biome", "TypeScript", "TypeScript (framework + samples)"]);
      const guards = FAST_CHECK_STEPS.filter((s) => !SPLIT_OUT.has(s.name));
      console.log(`--- ${guards.length} guards (parallel, pool=${FAST_POOL}) ---`);
      const results = await runPoolBuffered(guards, FAST_POOL, "/dev/null");
      const allGood = results.every((r) => r.ok);
      console.log(allGood ? "\nGuards green." : "\nGuards red:");
      for (const r of results) {
        console.log(`  ${r.ok ? "PASS" : "FAIL"} ${r.name}`);
      }
      if (!allGood) process.exit(1);
    },
  },

  status: {
    description: "What's up? Services, Git, everything at a glance",
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
    description: "Manage projections (list | status <name> | rebuild <name>)",
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
          `\n  kumiko.config.ts not found: ${configPath}\n\n` +
            `  Create a file that exports your features:\n\n` +
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
      const { db, close } = createDbConnection({ url: databaseUrl });
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
            console.log("\n  No projections registered.\n");
            break;
          }
          console.log("\n  Registered projections:\n");
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
              console.error(`\n  Projection "${arg}" is not registered.\n`);
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
    description:
      "Manage events table (prune --aggregate-types <a,b> [--older-than <days>] [--dry-run])",
    run: async () => {
      const subCommand = Bun.argv[3];

      if (subCommand !== "prune") {
        console.log(
          "\n  Usage: bun kumiko events prune --aggregate-types <a,b> [--older-than <days>] [--dry-run]\n",
        );
        process.exit(1);
      }

      // Simple flag parsing — no positional args here, so flags can appear
      // in any order.
      let olderThanDays = 30;
      let dryRun = false;
      let aggregateTypes: string[] = [];
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
        } else if (flag === "--aggregate-types") {
          const value = Bun.argv[++i];
          if (value === undefined || value.startsWith("--")) {
            console.error("\n  --aggregate-types requires a value (comma-separated list)\n");
            process.exit(1);
          }
          aggregateTypes = value
            .split(",")
            .map((name) => name.trim())
            .filter(Boolean);
        }
      }
      if (aggregateTypes.length === 0) {
        console.error("\n  --aggregate-types <a,b> is required (pruning the event log is destructive)\n");
        process.exit(1);
      }

      const { createDbConnection } = await import("@cosmicdrift/kumiko-framework/db");
      const { ConsumerLagError, pruneEvents } = await import("@cosmicdrift/kumiko-framework/pipeline");

      const databaseUrl = Bun.env["DATABASE_URL"];
      if (!databaseUrl) {
        console.error("\n  DATABASE_URL not set. Run against a configured env.\n");
        process.exit(1);
      }
      const { db, close } = createDbConnection({ url: databaseUrl });
      const green = "\x1b[32m";
      const yellow = "\x1b[33m";
      const red = "\x1b[31m";
      const dim = "\x1b[2m";
      const reset = "\x1b[0m";

      try {
        const result = await pruneEvents(db, { olderThanDays, dryRun, aggregateTypes });
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
      "Manage event consumers (list | status <name> | restart <name> | disable <name> | enable <name> | skip <name>)",
    run: async () => {
      const subCommand = Bun.argv[3];
      const arg = Bun.argv[4];

      const configPath = `${process.cwd()}/kumiko.config.ts`;
      if (!existsSync(configPath)) {
        console.error(
          `\n  kumiko.config.ts not found: ${configPath}\n\n` +
            `  Create a file that exports your features:\n\n` +
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
      const { db, close } = createDbConnection({ url: databaseUrl });
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
              console.log("\n  No event consumers registered.\n");
              break;
            }
            console.log("\n  Registered event consumers:\n");
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
                  `\n  Consumer "${arg}" is not registered. List via "bun kumiko consumer list".\n`,
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
    description: "Health check. Probably everything okay.",
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
      "Code migrations — kumiko codemod pipeline [--dry-run] [--verbose] [--dir <path>]",
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
        "@cosmicdrift/kumiko-feature-ast/codemod"
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
  // Sprint A spike: Ink-TUI for interactive browsing. If the module
  // is not installed or Ink fails to load, fall back to the old
  // Number-Input menu (keep working-on-any-machine guarantee).
  if (process.stdout.isTTY) {
    try {
      const { runTui } = await import("./kumiko-tui/index.tsx");
      await runTui();
      return;
    } catch (e) {
      console.warn(
        `\n  Ink-TUI unavailable (${e instanceof Error ? e.message : "?"}), fallback to legacy menu.\n`,
      );
    }
  }

  const entries = Object.entries(commands);

  banner();
  console.log("  What'll it be?\n");
  entries.forEach(([name, cmd], i) => {
    console.log(`  ${i + 1}) ${name.padEnd(10)} ${cmd.description}`);
  });
  console.log(`  q) bye\n`);

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
  console.log(`  🍺 Cheers!`);
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

function logBoth(line: string, logPath: string): void {
  console.log(line);
  try {
    writeFileSync(logPath, `${line}\n`, { flag: "a" });
  } catch {
    // ignore — log is best effort
  }
}

// Worker pool for CPU-bound, short-lived steps. Each step gets an
// in-memory output buffer; the result is serialized in original order to
// stdout and the log file. Live output is thereby
// lost — that's OK for guards/lints (seconds range, output is
// small), but deliberately NOT for unit/integration tests (see runWithTee).
//
// poolSize 6 on a 12-core box: leaves headroom for IDE/Docker/etc. and is
// close to the sweet spot between wall time and context
// switch overhead.
async function runPoolBuffered(
  steps: ReadonlyArray<{ readonly name: string; readonly cmd: string }>,
  poolSize: number,
  logPath: string,
): Promise<Array<{ name: string; ok: boolean }>> {
  type Result = {
    name: string;
    ok: boolean;
    output: string;
    durationMs: number;
    exitCode: number;
  };
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
      exitCode: code,
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

  // serialized output: only failed steps show their output (on
  // success, guard output is usually just "n files checked, 0 violations").
  // the log file gets everything for post-hoc debugging.
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
      process.stdout.write(
        isCI()
          ? `\n${formatCompactFailure(r.name, r.exitCode, r.output)}`
          : `\n--- ${r.name} (FAILED, ${r.durationMs}ms) ---\n${r.output}\n`,
      );
    } else if (isCI()) {
      const diagnostics = findOutputDiagnostics(r.output);
      if (diagnostics.total > 0) {
        process.stdout.write(
          `  ! ${r.name}: ${diagnostics.total} unique warning/error line(s) emitted\n${formatDiagnosticLines(diagnostics, "    ").join("\n")}\n`,
        );
      }
    }
  }
  return final;
}

async function runWithTee(cmd: string, logPath: string, label: string): Promise<number> {
  const proc = Bun.spawn(["sh", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const logStream = createWriteStream(logPath, { flags: "a" });
  const compact = isCI();
  // Buffered per stream (not decoded per chunk) so a multi-byte UTF-8
  // character split across two reads doesn't get corrupted mid-sequence.
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const pump = async (
    stream: ReadableStream<Uint8Array>,
    sink: NodeJS.WriteStream | undefined,
    chunks: Buffer[],
  ): Promise<void> => {
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sink?.write(value);
      logStream.write(value);
      if (compact) chunks.push(Buffer.from(value));
    }
  };

  // Compact mode buffers everything until the process exits, so a hang would
  // otherwise print nothing at all until the job's own timeout kills it.
  const heartbeatStart = Date.now();
  const heartbeat = compact
    ? setInterval(
        () => process.stdout.write(`  … ${label} still running (${Math.round((Date.now() - heartbeatStart) / 1000)}s)\n`),
        30_000,
      )
    : undefined;

  try {
    await Promise.all([
      pump(proc.stdout, compact ? undefined : process.stdout, stdoutChunks),
      pump(proc.stderr, compact ? undefined : process.stderr, stderrChunks),
    ]);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
  const code = await proc.exited;
  await new Promise<void>((resolve) => logStream.end(resolve));
  if (compact) {
    const captured =
      Buffer.concat(stdoutChunks).toString("utf8") + Buffer.concat(stderrChunks).toString("utf8");
    process.stdout.write(
      code === 0 ? formatCompactSuccess(label, captured) : `\n${formatCompactFailure(label, code, captured)}`,
    );
  }
  return code;
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
