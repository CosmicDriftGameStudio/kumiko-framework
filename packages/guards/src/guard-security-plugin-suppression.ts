#!/usr/bin/env bun
/**
 * Security-Plugin-Suppression Guard: `// biome-ignore lint/plugin: <reason>` must not silence the security Biome plugins
 * (admin API, event-store literal writes, restricted event-store symbols, direct fs, server-side direct fetch).
 * The category `lint/plugin` covers every plugin, so a three-word reason would pass the ignore-tag-reason guard and still switch off
 * an SSRF, path-traversal or event-store check. The guard re-runs Biome over the files that carry such a comment, in a temp copy
 * with those comments neutralised and only the security plugins (taken from the preset, `includes` untouched) enabled.
 * Every remaining diagnostic is a suppressed security finding. Exceptions live in the reviewed
 * `.kumiko-security-plugin-suppression-baseline.json`; without it the guard fails closed. UI plugins (raw-ui, raw-hooks, ...)
 * and browser-side fetch stay suppressible.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import type { SourceFile } from "ts-morph";
import { scanCommentTrivia } from "./_lib/comment-trivia";
import {
  ALL_REPO_KINDS,
  type AstGuard,
  baselineRatchet,
  buildSharedProject,
  filesForGuard,
  findRepoRootFor,
  type GuardViolation,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const ROOT = process.cwd();
const GUARD_NAME = "security-plugin-suppression";

const SCAN: ScanSpec = {
  scope: "source+tests",
  kinds: ALL_REPO_KINDS,
  extensions: ["ts", "tsx"],
};

const EXCLUDE = /(\.d\.(ts|tsx)$|\/dist\/)/;

const SECURITY_PLUGIN_NAMES: ReadonlySet<string> = new Set([
  "admin-api",
  "es-literal-writes",
  "es-literal-writes-tests",
  "restricted-event-store-symbols",
  "no-direct-fs",
  "no-direct-fetch",
]);
// no-direct-fetch has a second preset entry for browser code, which is no SSRF path.
const BROWSER_ONLY_INCLUDE = "**/web/**/*.tsx";

const PLUGIN_SUPPRESSION_RE = /biome-ignore(?:-all|-start)?\s+lint\/plugin\S*/;
// Same length as the original, so line and column numbers of the diagnostics stay valid.
const NEUTRALIZE_RE = /biome-ignore(?=(?:-all|-start)?\s+lint\/plugin)/g;
const NEUTRALIZED = "biome_ignore";

const PRESET_REPO_PATH = "packages/framework/presets/biome-rules.json";
const PRESET_PACKAGE_PATH = "@cosmicdrift/kumiko-framework/biome-rules";

type PresetPlugin = {
  readonly path: string;
  readonly resolutionKind?: string;
  readonly includes?: readonly string[];
};

type PluginFinding = { readonly count: number; readonly firstLine: number };

export type SecurityPluginScan = {
  readonly findings: Readonly<Record<string, PluginFinding>>;
  readonly failures: readonly string[];
};

export function hasPluginSuppression(fullText: string): boolean {
  if (!fullText.includes("lint/plugin")) return false;
  return scanCommentTrivia(fullText).some((comment) => PLUGIN_SUPPRESSION_RE.test(comment.text));
}

export function neutralizePluginSuppressions(fullText: string): string {
  let result = "";
  let copiedUpTo = 0;
  for (const comment of scanCommentTrivia(fullText)) {
    const neutralized = comment.text.replace(NEUTRALIZE_RE, NEUTRALIZED);
    if (neutralized === comment.text) continue;
    result += fullText.slice(copiedUpTo, comment.start) + neutralized;
    copiedUpTo = comment.start + comment.text.length;
  }
  return result + fullText.slice(copiedUpTo);
}

function isPresetPlugin(value: unknown): value is PresetPlugin {
  return (
    typeof value === "object" &&
    value !== null &&
    "path" in value &&
    typeof value.path === "string" &&
    (!("includes" in value) ||
      (Array.isArray(value.includes) && value.includes.every((item) => typeof item === "string")))
  );
}

function resolvePresetPath(repoRoot: string): string | undefined {
  const inRepo = path.join(repoRoot, PRESET_REPO_PATH);
  if (existsSync(inRepo)) return inRepo;
  try {
    return Bun.resolveSync(PRESET_PACKAGE_PATH, repoRoot);
  } catch {
    return undefined;
  }
}

function resolveBiomeBin(repoRoot: string): string | undefined {
  try {
    return path.join(
      path.dirname(Bun.resolveSync("@biomejs/biome/package.json", repoRoot)),
      "bin",
      "biome",
    );
  } catch {
    return undefined;
  }
}

function pluginName(pluginPath: string): string {
  return path.basename(pluginPath, ".grit");
}

function securityPluginEntries(presetPath: string): PresetPlugin[] | string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(presetPath, "utf-8"));
  } catch (error) {
    return `cannot read Biome preset ${presetPath}: ${error instanceof Error ? error.message : String(error)}`;
  }
  const plugins =
    typeof parsed === "object" && parsed !== null && "plugins" in parsed
      ? parsed.plugins
      : undefined;
  if (!Array.isArray(plugins) || !plugins.every(isPresetPlugin)) {
    return `Biome preset ${presetPath} has no valid "plugins" list`;
  }
  const baseDir = path.dirname(presetPath);
  const entries = plugins
    .filter((entry) => SECURITY_PLUGIN_NAMES.has(pluginName(entry.path)))
    .filter((entry) => !(entry.includes ?? []).includes(BROWSER_ONLY_INCLUDE))
    .map((entry) => ({ ...entry, path: path.resolve(baseDir, entry.path) }));
  const found = new Set(entries.map((entry) => pluginName(entry.path)));
  const missing = [...SECURITY_PLUGIN_NAMES].filter((name) => !found.has(name));
  return missing.length > 0
    ? `Biome preset ${presetPath} lacks security plugin(s): ${missing.join(", ")}`
    : entries;
}

type BiomeDiagnostic = {
  readonly severity: string;
  readonly category: string;
  readonly message: string;
  readonly path: string | undefined;
  readonly line: number;
};

export function parseBiomeDiagnostics(stdout: string): BiomeDiagnostic[] | undefined {
  const jsonLine = stdout.split("\n").find((line) => line.startsWith("{"));
  if (jsonLine === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonLine);
  } catch {
    return undefined;
  }
  const raw = isPlainObject(parsed) ? parsed["diagnostics"] : undefined;
  if (!Array.isArray(raw)) return undefined;
  const diagnostics: BiomeDiagnostic[] = [];
  for (const item of raw) {
    const diagnostic = toBiomeDiagnostic(item);
    if (diagnostic === undefined) return undefined;
    diagnostics.push(diagnostic);
  }
  return diagnostics;
}

function diagnosticLocation(location: unknown): { path: string | undefined; line: number } {
  if (!isPlainObject(location)) return { path: undefined, line: 1 };
  const { path: locPath, start } = location;
  const line = isPlainObject(start) && typeof start["line"] === "number" ? start["line"] : 1;
  return { path: typeof locPath === "string" ? locPath : undefined, line };
}

function toBiomeDiagnostic(item: unknown): BiomeDiagnostic | undefined {
  if (!isPlainObject(item)) return undefined;
  const { severity, category, message, location } = item;
  if (typeof severity !== "string" || typeof category !== "string") return undefined;
  return {
    severity,
    category,
    message: typeof message === "string" ? message : "",
    ...diagnosticLocation(location),
  };
}

function runBiomeInTempRepo(
  biomeBin: string,
  tempDir: string,
  plugins: readonly PresetPlugin[],
): { diagnostics: BiomeDiagnostic[] } | { failure: string } {
  writeFileSync(
    path.join(tempDir, "biome.json"),
    JSON.stringify({
      root: true,
      vcs: { enabled: false },
      formatter: { enabled: false },
      assist: { enabled: false },
      linter: { enabled: true, rules: { preset: "none" } },
      plugins,
    }),
  );
  const proc = Bun.spawnSync(
    ["bun", biomeBin, "lint", "--reporter=json", "--max-diagnostics=none", "."],
    { cwd: tempDir, stdout: "pipe", stderr: "pipe" },
  );
  const diagnostics = parseBiomeDiagnostics(proc.stdout.toString());
  // Exit 1 is Biome's "diagnostics found"; anything else, or an unreadable answer, is a crash.
  if (diagnostics === undefined || (proc.exitCode !== 0 && proc.exitCode !== 1)) {
    return {
      failure: `Biome did not answer with a readable lint report (exit ${proc.exitCode}): ${proc.stderr.toString().trim().slice(0, 300)}`,
    };
  }
  const broken = diagnostics.find((d) => d.severity === "error" && d.category !== "plugin");
  if (broken !== undefined) {
    return { failure: `Biome reported a non-plugin error (${broken.category}): ${broken.message}` };
  }
  return { diagnostics: diagnostics.filter((d) => d.category === "plugin") };
}

export function scanSecurityPluginSuppressions(
  repoRoot: string,
  filesByRelPath: ReadonlyMap<string, string>,
): SecurityPluginScan {
  const suppressed = new Map([...filesByRelPath].filter(([, text]) => hasPluginSuppression(text)));
  if (suppressed.size === 0) return { findings: {}, failures: [] };
  const presetPath = resolvePresetPath(repoRoot);
  const biomeBin = resolveBiomeBin(repoRoot);
  if (presetPath === undefined || biomeBin === undefined) {
    return {
      findings: {},
      failures: [
        `cannot resolve Biome preset/binary from ${repoRoot} to check plugin suppressions`,
      ],
    };
  }
  const plugins = securityPluginEntries(presetPath);
  if (typeof plugins === "string") return { findings: {}, failures: [plugins] };

  const tempDir = mkdtempSync(path.join(tmpdir(), "kumiko-security-plugin-suppression-"));
  try {
    for (const [rel, text] of suppressed) {
      const target = path.join(tempDir, rel);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, neutralizePluginSuppressions(text));
    }
    const result = runBiomeInTempRepo(biomeBin, tempDir, plugins);
    if ("failure" in result) return { findings: {}, failures: [result.failure] };
    const findings: Record<string, PluginFinding> = {};
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.path === undefined) continue;
      const previous = findings[diagnostic.path];
      findings[diagnostic.path] = {
        count: (previous?.count ?? 0) + 1,
        firstLine: previous?.firstLine ?? diagnostic.line,
      };
    }
    return { findings, failures: [] };
  } catch (error) {
    return {
      findings: {},
      failures: [
        `security plugin scan crashed: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function scanRepo(
  files: readonly SourceFile[],
  roots: readonly RepoRoot[],
): { counts: Record<string, number>; firstLine: Record<string, number>; failures: string[] } {
  const byRoot = new Map<string, Map<string, string>>();
  for (const sf of files) {
    const filePath = sf.getFilePath();
    if (EXCLUDE.test(filePath)) continue;
    const root = findRepoRootFor(filePath, roots);
    if (root === undefined) continue;
    const rel = relFromRepoRoot(filePath, roots);
    if (!isLocalFinding({ file: rel })) continue;
    const bucket = byRoot.get(root.absPath) ?? new Map<string, string>();
    bucket.set(rel, sf.getFullText());
    byRoot.set(root.absPath, bucket);
  }
  const counts: Record<string, number> = {};
  const firstLine: Record<string, number> = {};
  const failures: string[] = [];
  for (const [repoRoot, bucket] of byRoot) {
    const scan = scanSecurityPluginSuppressions(repoRoot, bucket);
    failures.push(...scan.failures);
    for (const [file, finding] of Object.entries(scan.findings)) {
      counts[file] = finding.count;
      firstLine[file] = finding.firstLine;
    }
  }
  return { counts, firstLine, failures };
}

function suppressionBaselineFor(baselineRoot: string) {
  return baselineRatchet({
    file: path.join(baselineRoot, ".kumiko-security-plugin-suppression-baseline.json"),
    formatVersion: 1,
    unit: "suppressed security plugin finding(s)",
    failClosed: true,
  });
}

const REMEDIATION =
  "A biome-ignore on lint/plugin cannot silence the security plugins (egress/SSRF, direct fs, event-store writes, admin API). Fix the call: egress(policy), FileStorageProvider, the event-store API. An unavoidable exception needs a reviewed baseline entry.";

export function createGuard(options: { readonly baselineRoot?: string } = {}): AstGuard {
  const suppressionBaseline = suppressionBaselineFor(options.baselineRoot ?? ROOT);
  return {
    name: GUARD_NAME,
    scan: SCAN,
    hint: `reviewed exceptions only: \`kumiko-guards guards --write-baseline --guard=${GUARD_NAME}\``,
    run: (files, roots = resolveRepoRoots()) => {
      const { counts, firstLine, failures } = scanRepo(files, roots);
      const failureViolations: GuardViolation[] = failures.map((message) => ({
        file: ".",
        line: 1,
        message: `security plugin scan failed closed: ${message}`,
      }));
      return {
        violations: [
          ...failureViolations,
          ...suppressionBaseline.check(counts, REMEDIATION, {
            formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard=${GUARD_NAME}\` once.`,
            resolveLine: (file) => firstLine[file] ?? 1,
          }),
        ],
      };
    },
    writeBaseline: (files, roots = resolveRepoRoots()) => {
      suppressionBaseline.write(scanRepo(files, roots).counts);
    },
  };
}

export const guard: AstGuard = createGuard();

if (import.meta.main) {
  if (process.argv.slice(2).includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    guard.writeBaseline?.(filesForGuard(project, guard));
    process.exit(0);
  }
  runStandalone(guard);
}
