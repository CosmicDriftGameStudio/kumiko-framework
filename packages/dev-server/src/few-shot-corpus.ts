// buildFewShotCorpus — extracts feature-files from the repo into a
// structured JSON corpus that L2 (Prompt-Pipeline) feeds into the LLM
// at generation time. One entry per feature-file, four data sources
// per entry: raw source text, package.json description, parsed
// FeaturePattern[], plus pattern-categories from the C4 library.
//
// **Why a checked-in JSON file (docs/few-shot-corpus.json):**
//   - Offline-consumable: AI-Builder can prompt without re-parsing
//     30+ feature files at request time.
//   - Diff-reviewable: when a feature changes, the corpus diff shows
//     up in the PR — humans see how the example surface shifted.
//   - Portable: the corpus is a flat JSON, can ship to a hosted LLM
//     service / fine-tuning pipeline / customer environment without
//     dragging the framework's parser along.
//
// **Authoring-Style classification:**
//   - `canonical` → 0 ParseErrors. The example is "do it like this"
//     for the LLM.
//   - `legacy` → has ParseErrors. The example shows what code looks
//     like in the wild (Factory-style, identifier-refs) and is useful
//     for understanding intent — but the LLM should NOT replicate
//     this style. L2 marks legacy entries as "do not generate".
//
// **Why the corpus includes legacy entries but the Designer does not:**
//   The two consumers want different slices of the same data. L2 needs
//   counter-examples (showing the LLM what *not* to emit raises the
//   chance of clean output), so legacy entries are kept and tagged.
//   The Designer can only round-trip canonical-form patterns through
//   the AST-Patcher — legacy entries would render as read-only with
//   no edit affordance, which is worse than hiding them. So the corpus
//   builder is permissive, and the Designer filters at read-time.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  type FeaturePattern,
  type FeaturePatternKind,
  PATTERN_LIBRARY,
  type ParseError,
  parseFeatureFile,
} from "@kumiko/framework/engine";

// =============================================================================
// Public types
// =============================================================================

export type AuthoringStyle = "canonical" | "legacy";

export type CorpusWarning = {
  /** Repo-relative path to the file that triggered the warning. */
  readonly sourcePath: string;
  /** Human-readable explanation. Currently only "parser-throw" but
   *  kept open-ended so future builders can add more (e.g.
   *  "duplicate-id", "no-feature-name"). */
  readonly reason: string;
};

export type FewShotEntry = {
  /** Stable id derived from the path (`samples/recipes/basic-entity`). */
  readonly id: string;
  /** Repo-relative path to the feature-file. */
  readonly sourcePath: string;
  /** Repo-relative path to the workspace package.json (for description lookup). */
  readonly packageJsonPath: string | undefined;
  /** Workspace name (`@kumiko/sample-basic-entity`). */
  readonly packageName: string | undefined;
  /** English description from package.json. */
  readonly description: string | undefined;
  /** Feature name from `defineFeature("...", ...)`. Undefined if the
   *  parser couldn't read it (rare — implies a non-feature file got
   *  picked up). */
  readonly featureName: string | undefined;
  /** Pattern-categories present in this feature, deduplicated. Useful
   *  as topic-tags for retrieval ("show me cross-cutting examples"). */
  readonly tags: readonly string[];
  /** Counts per pattern-kind — quick stats without scanning the
   *  patterns array. */
  readonly patternsByKind: Readonly<Record<string, number>>;
  /** All parsed patterns. Same shape the parser emits. */
  readonly patterns: readonly FeaturePattern[];
  /** Errors the parser raised. Empty for canonical-form features. */
  readonly parseErrors: readonly ParseError[];
  /** `canonical` (clean parse) or `legacy` (parser couldn't read it
   *  fully — Factory-style / identifier-refs). */
  readonly authoringStyle: AuthoringStyle;
  /** Raw source text — kept verbatim so the LLM can train on the
   *  exact byte-form, including comments + whitespace. */
  readonly rawSource: string;
};

export type FewShotCorpus = {
  /** ISO-instant when the corpus was generated. */
  readonly generatedAt: string;
  /** Total entry count, broken down by authoringStyle for quick stats. */
  readonly totals: {
    readonly all: number;
    readonly canonical: number;
    readonly legacy: number;
  };
  readonly entries: readonly FewShotEntry[];
  /** Files that were discovered but couldn't be turned into entries.
   *  Surfaces parser crashes + duplicate-id collisions instead of
   *  swallowing them — the regenerate-script reports these to the user
   *  and the drift-test asserts the count stays constant. */
  readonly warnings: readonly CorpusWarning[];
};

export type BuildFewShotCorpusOptions = {
  /** Repo root — used for relative-path output and security guards. */
  readonly repoRoot: string;
  /** Folders to scan recursively. Defaults to samples/* + bundled-features. */
  readonly scanRoots?: readonly string[];
};

// =============================================================================
// Builder
// =============================================================================

const FEATURE_FILE_PATTERN = /(?:^|\/)(feature|.*\.feature)\.ts$/;

const DEFAULT_SCAN_ROOTS: readonly string[] = [
  "samples/recipes",
  "samples/apps",
  "samples/showcases",
  "packages/bundled-features/src",
];

// Static timestamp keeps the JSON output deterministic across CI runs —
// the regenerate-script could overwrite this with a real timestamp,
// but drift-tests compare structural data, not timestamps. Centralized
// here so the build path and any future inspector use the same value.
const STATIC_GENERATED_AT = "1970-01-01T00:00:00Z";

export function buildFewShotCorpus(options: BuildFewShotCorpusOptions): FewShotCorpus {
  const repoRoot = resolve(options.repoRoot);
  const scanRoots = (options.scanRoots ?? DEFAULT_SCAN_ROOTS).map((r) => resolve(repoRoot, r));

  const featureFiles: string[] = [];
  for (const root of scanRoots) {
    if (!existsSync(root)) continue;
    walkDir(root, featureFiles);
  }
  featureFiles.sort();

  const entries: FewShotEntry[] = [];
  const warnings: CorpusWarning[] = [];
  const seenIds = new Map<string, string>();

  for (const filePath of featureFiles) {
    const result = buildEntry(filePath, repoRoot);
    if (result.warning) {
      warnings.push(result.warning);
      continue;
    }
    const entry = result.entry;
    const previousPath = seenIds.get(entry.id);
    if (previousPath) {
      // Two feature-files mapped to the same id. The corpus uses ids
      // for retrieval — duplicates would silently overwrite each other
      // in any consumer that built a Map<id, entry>. Surface as a
      // warning, drop the second occurrence.
      warnings.push({
        sourcePath: entry.sourcePath,
        reason: `duplicate-id: collides with ${previousPath}`,
      });
      continue;
    }
    seenIds.set(entry.id, entry.sourcePath);
    entries.push(entry);
  }

  const canonical = entries.filter((e) => e.authoringStyle === "canonical").length;
  return {
    generatedAt: STATIC_GENERATED_AT,
    totals: {
      all: entries.length,
      canonical,
      legacy: entries.length - canonical,
    },
    entries,
    warnings,
  };
}

type BuildEntryResult =
  | { readonly entry: FewShotEntry; readonly warning?: never }
  | { readonly entry?: never; readonly warning: CorpusWarning };

function buildEntry(filePath: string, repoRoot: string): BuildEntryResult {
  const sourcePath = relative(repoRoot, filePath);

  let parsed: ReturnType<typeof parseFeatureFile>;
  try {
    parsed = parseFeatureFile(filePath);
  } catch (err) {
    // ts-morph couldn't read the file (syntax-error, IO problem, weird
    // encoding). Skip the entry but record *why* — silent skip used to
    // hide newly broken feature-files until L2 hit them.
    const detail = err instanceof Error ? err.message : String(err);
    return {
      warning: { sourcePath, reason: `parser-throw: ${detail}` },
    };
  }

  const rawSource = readFileSync(filePath, "utf8");
  const id = pathToId(sourcePath);

  const pkgInfo = findPackageJson(filePath, repoRoot);

  const tags = collectTags(parsed.patterns);
  const patternsByKind = countPatternsByKind(parsed.patterns);

  const authoringStyle: AuthoringStyle = parsed.errors.length === 0 ? "canonical" : "legacy";

  // SourceLocation.file is an absolute path coming out of the parser —
  // strip it to repo-relative so the corpus diff stays stable across
  // machines / CI runners. Same for ParseError.source.file.
  const patterns = parsed.patterns.map((p) => relativizeSources(p, repoRoot) as FeaturePattern);
  const parseErrors = parsed.errors.map((e) => ({
    ...e,
    source: { ...e.source, file: relative(repoRoot, e.source.file) },
  }));

  return {
    entry: {
      id,
      sourcePath,
      packageJsonPath: pkgInfo?.relPath,
      packageName: pkgInfo?.name,
      description: pkgInfo?.description,
      featureName: parsed.featureName,
      tags,
      patternsByKind,
      patterns,
      parseErrors,
      authoringStyle,
      rawSource,
    },
  };
}

/**
 * Recursively walk a value and rewrite every nested SourceLocation's
 * `file` field to be repo-relative. Identifies SourceLocation by
 * structural shape (`{ file, start, end, raw }`) rather than by
 * type-tag — the parsed objects are plain JSON-ish at this point and
 * a discriminator would complicate the renderer.
 *
 * Typed `unknown → unknown` so the walker stays honest about what it
 * sees. The single boundary cast lives at the call site
 * (`as FeaturePattern`) where the input contract is known.
 */
function relativizeSources(value: unknown, repoRoot: string): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => relativizeSources(v, repoRoot));
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (
      typeof obj["file"] === "string" &&
      typeof obj["raw"] === "string" &&
      typeof obj["start"] === "object" &&
      typeof obj["end"] === "object"
    ) {
      return { ...obj, file: relative(repoRoot, obj["file"]) };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = relativizeSources(v, repoRoot);
    }
    return out;
  }
  return value;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Stable id from the source path. Drops the leading `samples/` or
 * `packages/` prefix and the trailing `/src/feature.ts` suffix so the
 * id reads like the canonical short name (`basic-entity`,
 * `bundled-features/auth-email-password`).
 */
export function pathToId(sourcePath: string): string {
  return sourcePath
    .replace(/^(samples|packages)\//, "")
    .replace(/\/src\/feature\.ts$/, "")
    .replace(/\/feature\.ts$/, "");
}

function walkDir(dir: string, acc: string[]): void {
  let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = String(entry.name);
    const full = join(dir, name);
    if (entry.isDirectory()) {
      if (name === "node_modules" || name === "dist" || name === "dist-server") continue;
      if (name.startsWith(".")) continue;
      walkDir(full, acc);
    } else if (entry.isFile() && FEATURE_FILE_PATTERN.test(full)) {
      acc.push(full);
    }
  }
}

/**
 * Walk upward from `featureFile` to find the nearest `package.json` and
 * pluck name + description out of it. Stops at `repoRoot`.
 */
function findPackageJson(
  featureFile: string,
  repoRoot: string,
): { relPath: string; name: string | undefined; description: string | undefined } | undefined {
  let dir = dirname(featureFile);
  const stopAt = resolve(repoRoot);
  while (true) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
          name?: unknown;
          description?: unknown;
        };
        return {
          relPath: relative(repoRoot, candidate),
          name: typeof pkg.name === "string" ? pkg.name : undefined,
          description: typeof pkg.description === "string" ? pkg.description : undefined,
        };
      } catch {
        // Malformed package.json — keep walking up.
      }
    }
    const parent = dirname(dir);
    if (parent === dir || dir === stopAt) return undefined;
    dir = parent;
  }
}

/**
 * Collect the union of pattern-categories present in the feature.
 * Categories come from the pattern-library — the same vocabulary the
 * Designer / AI-Builder uses for filtering ("show me background-jobs
 * examples").
 */
function collectTags(patterns: readonly FeaturePattern[]): readonly string[] {
  const tags = new Set<string>();
  for (const p of patterns) {
    const schema = PATTERN_LIBRARY[p.kind as FeaturePatternKind];
    if (schema) tags.add(schema.category);
  }
  return [...tags].sort();
}

function countPatternsByKind(
  patterns: readonly FeaturePattern[],
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const p of patterns) {
    counts[p.kind] = (counts[p.kind] ?? 0) + 1;
  }
  return counts;
}
