#!/usr/bin/env bun
/**
 * Guard: apps must not locally reimplement the e2e/screenshot template that
 * `@cosmicdrift/kumiko-testing` already owns (#3118). Flags, in Playwright
 * configs and e2e/screenshot specs/helpers:
 *   (a) a `playwright*.config.ts` that imports `defineConfig` from
 *       `@playwright/test` directly instead of `defineAppE2eConfig` from
 *       `@cosmicdrift/kumiko-testing/e2e` — a hand-rolled config drifts from
 *       the template's timeouts/retries/workers/real-provider wiring.
 *   (b) a literal `deviceScaleFactor: <n>` property anywhere (`test.use(...)`,
 *       a project's `use`, or a config's own `use`), or a literal
 *       `viewport: {…}` property in a `playwright*.config.ts`'s own `use` or
 *       a project's `use` — instead of the template's `DESKTOP_VIEWPORT` /
 *       `SCREENSHOT_DEVICE_SCALE_FACTOR`. A spec's own `test.use({ viewport })`
 *       is not flagged — the 0.310.0 changeset documents it as the way to
 *       assert a layout that only exists below the template's 1920px
 *       default. A `...devices["…"]` spread is not a property assignment and
 *       is never flagged — device-matrix projects (phone/tablet passes via
 *       `runMatrix`) stay allowed.
 *   (c) a direct `page.screenshot(...)` call — the template's
 *       `captureScreenshot` (fit: viewport/fullPage/content) is the one path
 *       apps should call.
 *
 * `packages/testing/**` (the template's own implementation) and
 * `samples/recipes/**` are never scanned.
 *
 * Opt-out on the finding's own line or the line above:
 * `// @template-drift-exception: #<issue> <technical reason>`.
 *
 * Usage (framework dev checkout):
 *   bun guards/guard-test-template-drift.ts
 * Consumer (via the published `kumiko-guards` CLI):
 *   kumiko-guards guards --guard=test-template-drift
 */
import { Node, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  type GuardOutcome,
  type GuardViolation,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const SCAN: ScanSpec = {
  scope: "tests",
  extensions: ["ts", "tsx"],
  kinds: ["framework", "app", "library"],
  frameworkWithin: ["samples/apps/*/playwright*.config.ts", "samples/apps/*/e2e/**/*.{ts,tsx}"],
  // frameworkWithin only narrows what's already collected here — the
  // samples/apps globs must be listed in extraGlobs too, or nothing under
  // samples/apps ever reaches the framework-kind scan in the first place.
  extraGlobs: [
    "playwright*.config.ts",
    "e2e/**/*.{ts,tsx}",
    "packages/*/e2e/**/*.{ts,tsx}",
    "packages/*/src/e2e/**/*.{ts,tsx}",
    "samples/apps/*/playwright*.config.ts",
    "samples/apps/*/e2e/**/*.{ts,tsx}",
  ],
};

const TESTING_DIR = "/packages/testing/";
const RECIPES_DIR = "/samples/recipes/";
const EXCEPTION_TAG = "@template-drift-exception";
const COMPLETE_EXCEPTION = /@template-drift-exception:\s*#\d+\s+\S/;

const CONFIG_FILENAME = /(?:^|\/)playwright[^/]*\.config\.tsx?$/;
const DEFINE_APP_E2E_CONFIG = "defineAppE2eConfig";
const DEFINE_APP_E2E_CONFIG_MODULE = "@cosmicdrift/kumiko-testing/e2e";
const RAW_DEFINE_CONFIG_MODULE = "@playwright/test";

const TEMPLATE_OWNED_KEYS: ReadonlySet<string> = new Set(["viewport", "deviceScaleFactor"]);

export interface Finding {
  file: string;
  line: number;
  message: string;
}

function relFile(sf: SourceFile, roots: readonly RepoRoot[]): string {
  return relFromRepoRoot(sf.getFilePath(), roots);
}

function exceptionNote(node: Node): "allowed" | "incomplete" | "none" {
  const lines = node.getSourceFile().getFullText().split("\n");
  const line = node.getStartLineNumber();
  const nearby = [lines[line - 1] ?? "", lines[line - 2] ?? ""];
  if (nearby.some((text) => COMPLETE_EXCEPTION.test(text))) return "allowed";
  return nearby.some((text) => text.includes(EXCEPTION_TAG)) ? "incomplete" : "none";
}

function withExceptionNote(node: Node, message: string): string | undefined {
  const note = exceptionNote(node);
  if (note === "allowed") return undefined;
  return note === "incomplete"
    ? `${message} [incomplete ${EXCEPTION_TAG} marker: needs "#<issue> <technical reason>"]`
    : message;
}

function importsFrom(sf: SourceFile, moduleSuffix: string): boolean {
  return sf
    .getImportDeclarations()
    .some((imp) => imp.getModuleSpecifierValue().endsWith(moduleSuffix));
}

function callsDefineAppE2eConfig(sf: SourceFile): boolean {
  return sf
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .some((call) => call.getExpression().getText() === DEFINE_APP_E2E_CONFIG);
}

// A raw `defineConfig` import next to a missing `defineAppE2eConfig` call is
// the hand-rolled-config signal — a file that never imports Playwright's
// `defineConfig` at all (e.g. a fixture/helper next to the config) isn't one.
function ownConfigFinding(sf: SourceFile): Finding | undefined {
  if (!CONFIG_FILENAME.test(sf.getFilePath())) return undefined;
  if (!importsFrom(sf, RAW_DEFINE_CONFIG_MODULE)) return undefined;
  if (importsFrom(sf, DEFINE_APP_E2E_CONFIG_MODULE) && callsDefineAppE2eConfig(sf))
    return undefined;
  const message = withExceptionNote(
    sf,
    `Playwright config builds its own defineConfig(...) instead of defineAppE2eConfig() — timeouts, retries, workers and the real-provider spec split drift from the template.`,
  );
  return message === undefined ? undefined : { file: "", line: 1, message };
}

// A `viewport`/`deviceScaleFactor` key is only a Playwright config/test.use
// override — the drift this guard cares about — when the object literal that
// holds it is a `test.use(...)` argument or the value of a `use:` property
// (a config's own use block, or a project's use block). The same key names
// are also legitimate on unrelated app-owned option objects (e.g. runMatrix's
// `Scenario.viewport`, a GIF-recorder's per-clip viewport), which must not be
// flagged.
function isPlaywrightUseObject(node: Node): boolean {
  const parent = node.getParent();
  if (parent === undefined) return false;
  if (Node.isCallExpression(parent)) {
    const callee = parent.getExpression().getText();
    return callee === "test.use" || callee.endsWith(".use");
  }
  if (Node.isPropertyAssignment(parent)) return parent.getName() === "use";
  return false;
}

function templateOwnedKeyFindings(sf: SourceFile): Finding[] {
  const findings: Finding[] = [];
  const isConfigFile = CONFIG_FILENAME.test(sf.getFilePath());
  for (const prop of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const name = prop.getName();
    if (!TEMPLATE_OWNED_KEYS.has(name)) continue;
    // viewport is only drift in the config's own use/project use — a spec's
    // own test.use({ viewport }) is the documented way (0.310.0 changeset) to
    // assert a layout that only exists below the template's 1920px default.
    // deviceScaleFactor has no such legitimate per-spec override, so it stays
    // flagged everywhere.
    if (name === "viewport" && !isConfigFile) continue;
    const objectLiteral = prop.getParent();
    if (!Node.isObjectLiteralExpression(objectLiteral)) continue;
    if (!isPlaywrightUseObject(objectLiteral)) continue;
    const message = withExceptionNote(
      prop,
      `Literal "${name}" — use the template's DESKTOP_VIEWPORT/SCREENSHOT_DEVICE_SCALE_FACTOR (defineAppE2eConfig) instead of overriding it locally.`,
    );
    if (message !== undefined)
      findings.push({ file: "", line: prop.getStartLineNumber(), message });
  }
  return findings;
}

function isPageScreenshotCall(call: Node): boolean {
  if (!Node.isCallExpression(call)) return false;
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return false;
  if (callee.getName() !== "screenshot") return false;
  return /(?:^|\.)page$/i.test(callee.getExpression().getText());
}

function pageScreenshotFindings(sf: SourceFile): Finding[] {
  const findings: Finding[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (!isPageScreenshotCall(call)) continue;
    const message = withExceptionNote(
      call,
      `Direct page.screenshot(...) call — use the template's captureScreenshot (fit: viewport/fullPage/content) instead of a local reimplementation.`,
    );
    if (message !== undefined)
      findings.push({ file: "", line: call.getStartLineNumber(), message });
  }
  return findings;
}

export function scanTemplateDrift(
  sf: SourceFile,
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): Finding[] {
  const path = sf.getFilePath();
  if (path.includes(TESTING_DIR) || path.includes(RECIPES_DIR)) return [];
  const file = relFile(sf, roots);
  const findings: Finding[] = [];
  const own = ownConfigFinding(sf);
  if (own !== undefined) findings.push({ ...own, file });
  for (const f of [...templateOwnedKeyFindings(sf), ...pageScreenshotFindings(sf)]) {
    findings.push({ ...f, file });
  }
  return findings.sort((a, b) => a.line - b.line);
}

const REMEDIATION = `Mark a deliberate exception with \`// ${EXCEPTION_TAG}: #<issue> <technical reason>\`.`;

const HINT =
  "Apps consume the e2e/screenshot template through defineAppE2eConfig, not a hand-rolled Playwright config or a local viewport/DPR/screenshot reimplementation. See https://github.com/CosmicDriftGameStudio/kumiko-framework/blob/main/docs/guides/testing-standard.md.";

function analyse(files: readonly SourceFile[], roots: readonly RepoRoot[]): GuardOutcome {
  const findings: Finding[] = [];
  for (const sf of files) {
    for (const finding of scanTemplateDrift(sf, roots)) {
      findings.push(finding);
      console.warn(
        `  [test-template-drift WARN] ${finding.file}:${finding.line}  ${finding.message}`,
      );
    }
  }
  const violations: GuardViolation[] = findings
    .filter(isLocalFinding)
    .map((f) => ({ file: f.file, line: f.line, message: `${f.message} ${REMEDIATION}` }));
  return { violations };
}

export const guard: AstGuard = {
  name: "test-template-drift",
  scan: SCAN,
  hint: HINT,
  run: (files, roots = resolveRepoRoots()) => analyse(files, roots),
};

if (import.meta.main) runStandalone(guard);
