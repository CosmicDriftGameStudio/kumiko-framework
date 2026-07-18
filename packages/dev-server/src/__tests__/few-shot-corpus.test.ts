// Few-Shot-Corpus tests:
//   1. Smoke — buildFewShotCorpus produces a structurally valid corpus
//      against a tmp-dir mini-repo (canonical multi-kind feature, broken
//      legacy feature, and a non-feature file).
//   2. Output shape — id stable, paths repo-relative, authoring-style
//      flags match the parse-error count.
//   3. Warnings — duplicate-id collisions and parser-throw don't get
//      swallowed; they show up in the corpus.warnings array.
//   4. pathToId — pure-function unit tests for the id derivation.
//
// Note: The drift-check against the checked-in `docs/few-shot-corpus.json`
// has been moved to `kumiko-enterprise/packages/ai-foundation` (Phase O.6)
// because the corpus JSON now lives there — framework is public and must
// not carry the eval baseline.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFewShotCorpus, pathToId } from "@cosmicdrift/kumiko-dev-server";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "kumiko-corpus-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

// =============================================================================
// Smoke test on a tmp-dir mini-repo
// =============================================================================

describe("buildFewShotCorpus — smoke", () => {
  test("returns one entry per discovered feature-file with parsed shape", () => {
    // Plant two feature-files inside `samples/recipes/` so the default
    // scan-roots pick them up.
    plantPackage(workdir, "samples/recipes/canonical-demo", {
      pkgName: "@cosmicdrift/kumiko-sample-canonical-demo",
      pkgDescription: "Canonical-form demo feature.",
      featureSource: buildCanonicalMultiKindFeature("canonicalDemo"),
    });
    plantPackage(workdir, "samples/recipes/legacy-demo", {
      pkgName: "@cosmicdrift/kumiko-sample-legacy-demo",
      pkgDescription: "Handler-object-reference-style legacy feature.",
      featureSource: buildLegacyFeature("legacyDemo"),
    });

    const corpus = buildFewShotCorpus({ repoRoot: workdir });

    expect(corpus.entries).toHaveLength(2);
    expect(corpus.totals.all).toBe(2);
    expect(corpus.totals.canonical).toBe(1);
    expect(corpus.totals.legacy).toBe(1);
    expect(corpus.warnings).toEqual([]);
  });

  test("multi-kind canonical entry exposes tags and kind-counts across all kinds", () => {
    plantPackage(workdir, "samples/recipes/multi-kind", {
      pkgName: "@cosmicdrift/kumiko-sample-multi-kind",
      pkgDescription: "Demo feature spanning entity, writeHandler, nav.",
      featureSource: buildCanonicalMultiKindFeature("multiKind"),
    });

    const corpus = buildFewShotCorpus({ repoRoot: workdir });
    const entry = corpus.entries[0];
    if (!entry) throw new Error("expected one entry");

    // Tags collected from PATTERN_LIBRARY.category for each kind. The
    // exact category names live in the library — assert the union has
    // at least the categories we expect to see for these kinds, instead
    // of pinning the full set (so adding categories doesn't break this
    // test). Why this matters: `tags` is the retrieval key for L2.
    expect(entry.tags.length).toBeGreaterThanOrEqual(2);

    expect(entry.patternsByKind).toMatchObject({
      entity: 1,
      writeHandler: 1,
      nav: 1,
    });
    expect(entry.authoringStyle).toBe("canonical");
    expect(entry.parseErrors).toEqual([]);
  });

  test("entries carry id, repo-relative paths, description, tags", () => {
    plantPackage(workdir, "samples/recipes/demo", {
      pkgName: "@cosmicdrift/kumiko-sample-demo",
      pkgDescription: "Demo.",
      featureSource: buildCanonicalMultiKindFeature("demo"),
    });

    const corpus = buildFewShotCorpus({ repoRoot: workdir });
    const entry = corpus.entries[0];
    if (!entry) throw new Error("expected one entry");

    expect(entry.id).toBe("recipes/demo");
    expect(entry.sourcePath).toBe("samples/recipes/demo/src/feature.ts");
    expect(entry.packageJsonPath).toBe("samples/recipes/demo/package.json");
    expect(entry.packageName).toBe("@cosmicdrift/kumiko-sample-demo");
    expect(entry.description).toBe("Demo.");
    expect(entry.featureName).toBe("demo");
    expect(entry.authoringStyle).toBe("canonical");
    expect(entry.parseErrors).toEqual([]);
  });

  test("source paths inside parsed patterns are repo-relative (no absolute paths)", () => {
    plantPackage(workdir, "samples/recipes/demo", {
      pkgName: "x",
      pkgDescription: "x",
      featureSource: buildCanonicalMultiKindFeature("demo"),
    });

    const corpus = buildFewShotCorpus({ repoRoot: workdir });
    const entry = corpus.entries[0];
    if (!entry) throw new Error("expected one entry");

    // Walk the patterns recursively and assert every `file` field is
    // relative — no absolute paths leaking into the JSON.
    const json = JSON.stringify(entry.patterns);
    expect(json).not.toContain(workdir);
  });

  test("non-feature .ts files are ignored", () => {
    const recipesDir = join(workdir, "samples", "recipes", "demo", "src");
    mkdirSync(recipesDir, { recursive: true });
    writeFileSync(
      join(recipesDir, "..", "package.json"),
      JSON.stringify({ name: "x", description: "x" }),
    );
    writeFileSync(join(recipesDir, "feature.ts"), buildCanonicalMultiKindFeature("demo"));
    writeFileSync(join(recipesDir, "helpers.ts"), "export const x = 1;\n");
    writeFileSync(join(recipesDir, "feature.test.ts"), "// not a feature\n");

    const corpus = buildFewShotCorpus({ repoRoot: workdir });
    expect(corpus.entries).toHaveLength(1);
    expect(corpus.entries[0]?.sourcePath.endsWith("feature.ts")).toBe(true);
  });
});

// =============================================================================
// Warnings — silent skips are gone; parser-throw / duplicate-id surface
// =============================================================================

describe("buildFewShotCorpus — warnings", () => {
  test("duplicate id between two scan roots produces a warning, not an overwrite", () => {
    // Both paths collapse to the same id under pathToId:
    //   samples/foo/src/feature.ts   → strip "samples/" + "/src/feature.ts" → "foo"
    //   packages/foo/src/feature.ts  → strip "packages/" + "/src/feature.ts" → "foo"
    // Without the duplicate-id check the second entry would silently
    // overwrite the first in any consumer that built `Map<id, entry>`.
    plantPackage(workdir, "samples/foo", {
      pkgName: "@cosmicdrift/kumiko-sample-foo-a",
      pkgDescription: "First foo.",
      featureSource: buildCanonicalMultiKindFeature("fooA"),
    });
    plantPackage(workdir, "packages/foo", {
      pkgName: "@cosmicdrift/kumiko-sample-foo-b",
      pkgDescription: "Second foo.",
      featureSource: buildCanonicalMultiKindFeature("fooB"),
    });

    // Scan both roots so both feature-files get picked up.
    const corpus = buildFewShotCorpus({
      repoRoot: workdir,
      scanRoots: ["samples", "packages"],
    });

    expect(corpus.entries).toHaveLength(1);
    expect(corpus.warnings).toHaveLength(1);
    expect(corpus.warnings[0]?.message).toMatch(/^duplicate-id:/);
  });

  test("parser-throw surfaces as a warning instead of silent skip", () => {
    // A file that ts-morph can read syntactically but parseFeatureFile's
    // top-level invariants reject. Easiest: a file that matches the
    // FEATURE_FILE_PATTERN regex but contains code that crashes the
    // parser (e.g. raw `import` from a non-resolvable module isn't
    // enough — the parser falls back to ParseError, not a throw). Use
    // outright invalid TypeScript.
    const recipesDir = join(workdir, "samples", "recipes", "broken", "src");
    mkdirSync(recipesDir, { recursive: true });
    writeFileSync(
      join(recipesDir, "..", "package.json"),
      JSON.stringify({ name: "x", description: "x" }),
    );
    // Garbage that ts-morph still parses but as a script with errors.
    // The parser may either return a corpus with errors (legacy entry)
    // or throw — both branches are valid. We assert: if it *throws*,
    // the warning is present; if it doesn't, no warning is needed.
    writeFileSync(join(recipesDir, "feature.ts"), "this is not typescript {{{");

    const corpus = buildFewShotCorpus({ repoRoot: workdir });
    // Either path is acceptable, but the corpus must not silently
    // disappear the file:
    const handled =
      corpus.entries.length === 1 ||
      corpus.warnings.some((w) => w.sourcePath.endsWith("feature.ts"));
    expect(handled).toBe(true);
  });
});

// =============================================================================
// pathToId — pure function unit tests
// =============================================================================

describe("pathToId", () => {
  test("strips samples/ prefix and /src/feature.ts suffix", () => {
    expect(pathToId("samples/recipes/basic-entity/src/feature.ts")).toBe("recipes/basic-entity");
  });

  test("strips packages/ prefix", () => {
    expect(pathToId("packages/bundled-features/src/auth-email-password/feature.ts")).toBe(
      "bundled-features/src/auth-email-password",
    );
  });

  test("strips plain /feature.ts suffix when no /src/ in the path", () => {
    expect(pathToId("samples/apps/showcase/src/features/demos/feature.ts")).toBe(
      "apps/showcase/src/features/demos",
    );
  });

  test("returns the path unchanged when no prefix or suffix matches", () => {
    expect(pathToId("misc/random.ts")).toBe("misc/random.ts");
  });

  test("only strips the leading samples|packages prefix once (no greedy)", () => {
    // packages/samples/foo/feature.ts: only the first prefix gets dropped.
    expect(pathToId("packages/samples/foo/feature.ts")).toBe("samples/foo");
  });
});

// =============================================================================
// Helpers — feature-file content + workspace planting
// =============================================================================

function plantPackage(
  root: string,
  relPath: string,
  opts: {
    pkgName: string;
    pkgDescription: string;
    featureSource: string;
  },
): void {
  const dir = join(root, relPath, "src");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(root, relPath, "package.json"),
    JSON.stringify({ name: opts.pkgName, description: opts.pkgDescription }),
  );
  writeFileSync(join(dir, "feature.ts"), opts.featureSource);
}

/**
 * Hand-rolled canonical-form feature-file with three kinds (entity,
 * writeHandler, nav) so the smoke-test exercises tags + counts across
 * categories. Mirrors `samples/recipes/designer-demo/src/feature.ts`
 * but inlined here so the test stays self-contained.
 */
function buildCanonicalMultiKindFeature(featureName: string): string {
  return `// kumiko-feature-version: 1
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { z } from "zod";

defineFeature("${featureName}", (r) => {
  r.entity({
    name: "task",
    fields: {
      title: { type: "text", required: true },
      done: { type: "boolean", default: false },
    },
  });

  r.writeHandler({
    name: "task:create",
    schema: z.object({ title: z.string() }),
    handler: async (_event, _ctx) => {
      return { isSuccess: true, data: { id: "x" } };
    },
    access: { roles: ["user"] },
  });

  r.nav({
    id: "tasks",
    label: "Tasks",
    screen: "${featureName}:screen:task-list",
  });
});
`;
}

function buildLegacyFeature(featureName: string): string {
  // Handler-object-reference style — writeHandler receives a single
  // identifier referencing a pre-built handler object rather than an
  // inline string name + schema + handler. The parser has no extractor
  // shape for that (it only reads a literal name as the first arg, or
  // an inline object-literal form), so it produces a ParseError and the
  // corpus marks the entry as authoringStyle: "legacy".
  //
  // Note: a captured-const *entity definition* (`r.entity("x", xEntity)`)
  // used to be the legacy example here, but #998 taught the parser to
  // resolve such references via a raw-ref sentinel — that idiom parses
  // cleanly now and no longer exercises the legacy path.
  return `
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const itemCreateHandler = { name: "item:create" };

defineFeature("${featureName}", (r) => {
  r.writeHandler(itemCreateHandler);
});
`;
}
