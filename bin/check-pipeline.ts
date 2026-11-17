#!/usr/bin/env bun

// Internal step pipeline behind `kumiko check`, `check:fast` and `ci:guards`,
// spawned as a subprocess by bin/commands.

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
import { CHECK_PHASES, type CheckPhase, parseCheckPhases } from "./_lib/check-phases";
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
        cmd: `cd ${absPath} && bun check --no-script`,
      });
    }
  }

  // 3. Boot validation + guard suites: delegated to the published `kumiko
  // check` (packages/cli), step list derived from the scanned repo's kumiko.json.
  const guardCwd = guardScanRoot();
  steps.push({ name: "kumiko check (boot + guard suites)", cmd: `cd "${guardCwd}" && bun "${KUMIKO_CLI}" check` });
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
    pushInfraGuardStep("Doc-Status-Index Drift", "docs-status-index.ts");
  } else {
    console.log("Doc-Status-Index step skipped: kumiko-platform not in workspace (CI-standalone).");
  }
  // TODO(2026-07-03): re-enable as-Cast Audit — coverage extended to all repos
  // (enterprise, platform, solon, .tsx) in check-as-casts.ts; baseline must be
  // regenerated with `--write-baseline` from framework repo after validation.
  // Baseline regression guard (infra#295): fails only on NEW DE comments,
  // existing hits are frozen via .kumiko-comment-lang-baseline.json.
  steps.push({ name: "Comment-Language Guard", cmd: "bunx kumiko-guards comment-lang" });
  steps.push({
    name: "Public-Exports-Changelog Guard",
    cmd: "bunx kumiko-guards public-exports-changelog --base=origin/main",
  });
  // Lints this repo's own sample configs with `kumiko agent lint` (findAgentDocGaps);
  // finding none fails instead of passing vacuously.
  {
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
  steps.push({ name: "License Check", cmd: "bunx kumiko-guards licenses" });
  steps.push({ name: "Security Audit", cmd: "bunx kumiko-guards security" });
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
        cmd: `cd ${absPath} && bun test --dots --config=bunfig.dom.toml --timeout=5000 .test.tsx`,
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
      let phases: ReadonlySet<CheckPhase>;
      try {
        phases = parseCheckPhases(Bun.argv.slice(3));
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
      const workCtx = resolveCheckWorkContext(process.cwd(), REPO_ROOT);
      const partialPhase = phases.size < CHECK_PHASES.length ? [...phases].join("-") : undefined;
      const { lockDir, logPath, resultPath } = checkLockPaths(workCtx.cliScope, "", partialPhase);

      if (!acquireCheckLock(lockDir, logPath, resultPath)) {
        const code = await followCheck(lockDir, logPath, resultPath);
        if (code !== 0) process.exit(code);
        return;
      }

      registerLockCleanup(lockDir);

      logBoth(`${formatCheckWorkContext(workCtx)}\n`, logPath);
      logBoth("Check everything...\n", logPath);
      const results: Array<{ name: string; ok: boolean }> = [];

      if (phases.has("static")) {
        logBoth(`--- ${FAST_CHECK_STEPS.length} fast checks (parallel, pool=${FAST_POOL}) ---`, logPath);
        const fastResults = await runPoolBuffered(FAST_CHECK_STEPS, FAST_POOL, logPath);
        for (const r of fastResults) results.push(r);
        logBoth("", logPath);
      }

      // KUMIKO_CHECK=1 enables the higher Vitest thread cap (8 instead of 4)
      // in vitest.config.ts — the box is saturated anyway during a
      // check run, so wall-time should count. In Watch mode/IDE the
      // conservative default stays active.
      //
      // Integration tests locally in `check`, skip in CI (require Docker stack). skip (requires Docker stack).
      if (phases.has("tests")) {
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
} satisfies Record<string, { description: string; run: () => Promise<void> }>;

// --- Helpers ---
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

function isStepSet(value: string): value is keyof typeof commands {
  return Object.hasOwn(commands, value);
}

const stepSet = Bun.argv[2];
const handler = stepSet !== undefined && isStepSet(stepSet) ? commands[stepSet] : undefined;
if (!handler) {
  console.error(
    `check-pipeline: unknown step set "${stepSet ?? ""}", expected one of: ${Object.keys(commands).join(", ")}`,
  );
  process.exit(1);
}
await handler.run();
