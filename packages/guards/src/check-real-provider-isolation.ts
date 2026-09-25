#!/usr/bin/env bun
/**
 * Real-Provider-Isolation-Guard (stack-agnostisch, #3118).
 *
 * Real-provider specs (`*.real.test.ts`, `*.real.spec.ts`) hit live third-party
 * services and must only ever run manually, opt-in, via `bun run test:real` /
 * `bun run e2e:real` — never inside a default `bun test`/`playwright test`
 * glob and never inside CI (an accidental `KUMIKO_REAL_PROVIDERS=1` in a
 * workflow spends real quota/credentials on every push).
 *
 * Flags:
 *   (a) any CI workflow (`.github/workflows/*.{yml,yaml}`) that references
 *       KUMIKO_REAL_PROVIDERS, `test:real`, or `e2e:real` — CI must never run
 *       real-provider tests, full stop, so any mention is a violation.
 *   (b) one of the template's own non-`real` bunfig files (`bunfig.toml`,
 *       `bunfig.integration.toml`, `bunfig.dom.toml` — see BUNFIG_FILES in
 *       packages/testing/src/bunfig.ts) whose pathIgnorePatterns doesn't
 *       exclude `**\/*.real.test.ts` — the default-glob discovery trap. A
 *       repo-specific bunfig outside that set (e.g. a coverage-ratchet
 *       config invoked with an explicit path filter, never a bare
 *       `bun test`) is not the template's concern and is left alone.
 *   (c) a package.json script other than `test:real`/`e2e:real` that sets
 *       KUMIKO_REAL_PROVIDERS or references a `.real.` spec/test file.
 *
 * `bunfig.real.toml` itself, and the `test:real`/`e2e:real` scripts, are the
 * accepted, designated home for all three signals — see
 * packages/testing/src/scaffold.ts and packages/testing/src/bunfig.ts, which
 * generate them. Apps that use kumiko-testing's scaffold never trip this;
 * it catches a hand-rolled or drifted bunfig/CI setup.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Glob } from "bun";
import { type RepoCheck, reportResults, runRepoChecks } from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";
import { scanLinesForPredicate, type TextLineFinding } from "./_lib/scan-lines";

const REAL_PROVIDERS_ENV = "KUMIKO_REAL_PROVIDERS";
const REAL_SCRIPT_NAMES: ReadonlySet<string> = new Set(["test:real", "e2e:real"]);
const REAL_TEST_IGNORE_ENTRY = "**/*.real.test.ts";

const CI_WORKFLOW_GLOB = ".github/workflows/*.{yml,yaml}";
// Only the template's own generated bunfig files (BUNFIG_FILES in
// packages/testing/src/bunfig.ts) minus the real variant itself — a
// hand-rolled bunfig outside this set (coverage ratchet, CI-only tweaks)
// isn't what the template owns and is never invoked as a bare `bun test`.
const TEMPLATE_OWNED_NON_REAL_BUNFIGS: readonly string[] = [
  "bunfig.toml",
  "bunfig.integration.toml",
  "bunfig.dom.toml",
];

function ciWorkflowViolation(line: string): boolean {
  return (
    line.includes(REAL_PROVIDERS_ENV) || /\btest:real\b/.test(line) || /\be2e:real\b/.test(line)
  );
}

function scanCiWorkflows(root: RepoRoot, findings: TextLineFinding[]): number {
  let scanned = 0;
  for (const rel of new Glob(CI_WORKFLOW_GLOB).scanSync({ cwd: root.absPath })) {
    scanned++;
    scanLinesForPredicate(join(root.absPath, rel), rel, ciWorkflowViolation, findings);
  }
  return scanned;
}

// package.json scripts: a real-provider signal in any script OTHER than the
// two designated ones is a leak (e.g. a "test" or "ci" script that pulls in
// the real env or filters for a .real. spec by hand).
function scriptLeaksRealProvider(name: string, command: string): string | undefined {
  if (REAL_SCRIPT_NAMES.has(name)) return undefined;
  if (command.includes(REAL_PROVIDERS_ENV)) {
    return `script "${name}" sets ${REAL_PROVIDERS_ENV} outside test:real/e2e:real: ${command}`;
  }
  if (/\.real\.(test|spec)\.ts/.test(command)) {
    return `script "${name}" references a *.real. spec/test outside test:real/e2e:real: ${command}`;
  }
  return undefined;
}

function scanPackageJsonScripts(root: RepoRoot, findings: TextLineFinding[]): number {
  const path = join(root.absPath, "package.json");
  let parsed: { scripts?: Record<string, string> };
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as { scripts?: Record<string, string> };
  } catch {
    return 0;
  }
  const scripts = parsed.scripts ?? {};
  let scanned = 0;
  for (const [name, command] of Object.entries(scripts)) {
    scanned++;
    const message = scriptLeaksRealProvider(name, command);
    if (message !== undefined) {
      findings.push({ file: "package.json", line: 1, text: message });
    }
  }
  return scanned;
}

// The generated bunfig template (packages/testing/src/bunfig.ts) is what app
// and library repos consume via `kumiko-testing bunfig` — the framework repo
// hand-maintains its own root bunfig*.toml files and doesn't run this
// template on itself, so it's excluded here to avoid flagging a convention
// it was never meant to follow.
function bunfigMissingRealExclusion(root: RepoRoot, findings: TextLineFinding[]): number {
  if (root.kind === "framework") return 0;
  let scanned = 0;
  for (const rel of TEMPLATE_OWNED_NON_REAL_BUNFIGS) {
    const abs = join(root.absPath, rel);
    let content: string;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    scanned++;
    if (!content.includes(REAL_TEST_IGNORE_ENTRY)) {
      findings.push({
        file: rel,
        line: 1,
        text: `[test] pathIgnorePatterns is missing "${REAL_TEST_IGNORE_ENTRY}" — a default \`bun test\` would pick up real-provider specs`,
      });
    }
  }
  return scanned;
}

export const check: RepoCheck = {
  name: "Real-Provider-Isolation Guard",
  hint:
    `Real-provider tests run only via \`bun run test:real\`/\`bun run e2e:real\`, ` +
    `never in CI and never in a default test glob. Regenerate bunfig via ` +
    `\`kumiko-testing bunfig\` instead of hand-editing pathIgnorePatterns.`,
  async run(roots) {
    if (roots.length === 0) {
      return { violations: [], matchedFiles: 0, notApplicable: true };
    }
    const findings: TextLineFinding[] = [];
    let matchedFiles = 0;
    for (const root of roots) {
      matchedFiles += scanCiWorkflows(root, findings);
      matchedFiles += scanPackageJsonScripts(root, findings);
      matchedFiles += bunfigMissingRealExclusion(root, findings);
    }
    return {
      violations: findings.map((f) => ({ file: f.file, line: f.line, message: f.text })),
      matchedFiles,
      notApplicable: false,
    };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check], resolveRepoRoots()));
  process.exit(failed > 0 ? 1 : 0);
}
