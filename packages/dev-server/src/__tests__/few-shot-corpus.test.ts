// Few-Shot-Corpus tests:
//   1. Smoke — buildFewShotCorpus produces a structurally valid corpus
//      against a tmp-dir mini-repo (canonical feature, broken legacy
//      feature, and a non-feature file).
//   2. Output shape — id stable, paths repo-relative, authoring-style
//      flags match the parse-error count.
//   3. Drift — the live build against the real repo matches the
//      checked-in docs/few-shot-corpus.json. Catches "feature changed,
//      corpus didn't get refreshed" in CI.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFewShotCorpus, type FewShotCorpus } from "@kumiko/dev-server";
import { renderFeatureFile } from "@kumiko/framework/engine";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..", "..", "..");

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
    const recipesDir = join(workdir, "samples", "recipes");
    mkdirSync(join(recipesDir, "canonical-demo", "src"), { recursive: true });
    writeFileSync(
      join(recipesDir, "canonical-demo", "package.json"),
      JSON.stringify({
        name: "@kumiko/sample-canonical-demo",
        description: "Canonical-form demo feature.",
      }),
    );
    writeFileSync(
      join(recipesDir, "canonical-demo", "src", "feature.ts"),
      buildCanonicalFeature("canonicalDemo"),
    );

    mkdirSync(join(recipesDir, "legacy-demo", "src"), { recursive: true });
    writeFileSync(
      join(recipesDir, "legacy-demo", "package.json"),
      JSON.stringify({
        name: "@kumiko/sample-legacy-demo",
        description: "Identifier-ref-style legacy feature.",
      }),
    );
    writeFileSync(
      join(recipesDir, "legacy-demo", "src", "feature.ts"),
      buildLegacyFeature("legacyDemo"),
    );

    const corpus = buildFewShotCorpus({ repoRoot: workdir });

    expect(corpus.entries).toHaveLength(2);
    expect(corpus.totals.all).toBe(2);
    expect(corpus.totals.canonical).toBe(1);
    expect(corpus.totals.legacy).toBe(1);
  });

  test("entries carry id, repo-relative paths, description, tags", () => {
    const recipesDir = join(workdir, "samples", "recipes");
    mkdirSync(join(recipesDir, "demo", "src"), { recursive: true });
    writeFileSync(
      join(recipesDir, "demo", "package.json"),
      JSON.stringify({ name: "@kumiko/sample-demo", description: "Demo." }),
    );
    writeFileSync(join(recipesDir, "demo", "src", "feature.ts"), buildCanonicalFeature("demo"));

    const corpus = buildFewShotCorpus({ repoRoot: workdir });
    const entry = corpus.entries[0];
    if (!entry) throw new Error("expected one entry");

    expect(entry.id).toBe("recipes/demo");
    expect(entry.sourcePath).toBe("samples/recipes/demo/src/feature.ts");
    expect(entry.packageJsonPath).toBe("samples/recipes/demo/package.json");
    expect(entry.packageName).toBe("@kumiko/sample-demo");
    expect(entry.description).toBe("Demo.");
    expect(entry.featureName).toBe("demo");
    expect(entry.tags).toContain("data");
    expect(entry.authoringStyle).toBe("canonical");
    expect(entry.parseErrors).toEqual([]);
    expect(entry.patternsByKind["entity"]).toBe(1);
  });

  test("source paths inside parsed patterns are repo-relative (no absolute paths)", () => {
    const recipesDir = join(workdir, "samples", "recipes");
    mkdirSync(join(recipesDir, "demo", "src"), { recursive: true });
    writeFileSync(
      join(recipesDir, "demo", "package.json"),
      JSON.stringify({ name: "x", description: "x" }),
    );
    writeFileSync(join(recipesDir, "demo", "src", "feature.ts"), buildCanonicalFeature("demo"));

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
    writeFileSync(join(recipesDir, "feature.ts"), buildCanonicalFeature("demo"));
    writeFileSync(join(recipesDir, "helpers.ts"), "export const x = 1;\n");
    writeFileSync(join(recipesDir, "feature.test.ts"), "// not a feature\n");

    const corpus = buildFewShotCorpus({ repoRoot: workdir });
    expect(corpus.entries).toHaveLength(1);
    expect(corpus.entries[0]?.sourcePath.endsWith("feature.ts")).toBe(true);
  });
});

// =============================================================================
// Drift test against the checked-in docs/few-shot-corpus.json
// =============================================================================

describe("docs/few-shot-corpus.json — drift check", () => {
  test("checked-in corpus matches the live repo state", () => {
    const checkedInPath = join(REPO_ROOT, "docs", "few-shot-corpus.json");
    const checkedIn = JSON.parse(readFileSync(checkedInPath, "utf8")) as FewShotCorpus;
    const live = buildFewShotCorpus({ repoRoot: REPO_ROOT });

    // Compare structural data only — generatedAt is intentionally
    // static in the build output (the regenerate-script could have
    // overwritten it with a real timestamp; either way drift-tests
    // ignore it). totals + entries must match exactly.
    expect(live.totals).toEqual(checkedIn.totals);
    expect(live.entries.length).toBe(checkedIn.entries.length);

    // Per-entry comparison: id + sourcePath + featureName + counts +
    // tags + authoringStyle. Skip rawSource + patterns themselves —
    // they're long, the totals and per-kind counts are the cheap
    // proxy for "did anything change here?".
    for (const liveEntry of live.entries) {
      const checkedEntry = checkedIn.entries.find((e) => e.id === liveEntry.id);
      expect(checkedEntry, `missing entry ${liveEntry.id} in checked-in corpus`).toBeDefined();
      if (!checkedEntry) continue;
      expect({
        sourcePath: liveEntry.sourcePath,
        featureName: liveEntry.featureName,
        authoringStyle: liveEntry.authoringStyle,
        tags: liveEntry.tags,
        patternsByKind: liveEntry.patternsByKind,
      }).toEqual({
        sourcePath: checkedEntry.sourcePath,
        featureName: checkedEntry.featureName,
        authoringStyle: checkedEntry.authoringStyle,
        tags: checkedEntry.tags,
        patternsByKind: checkedEntry.patternsByKind,
      });
    }
  });
});

// =============================================================================
// Helpers — feature-file content for the smoke tests
// =============================================================================

function buildCanonicalFeature(featureName: string): string {
  return renderFeatureFile({
    featureName,
    patterns: [
      {
        kind: "entity",
        source: {
          file: "<test>",
          start: { line: 1, column: 1 },
          end: { line: 1, column: 1 },
          raw: "",
        },
        entityName: "item",
        definition: { fields: { title: { type: "text", required: true } } } as never,
      },
    ],
  });
}

function buildLegacyFeature(featureName: string): string {
  // Identifier-ref style — the parser refuses (entity definition is a
  // captured const), produces a ParseError, and the corpus marks the
  // entry as authoringStyle: "legacy".
  return `
import { defineFeature, createEntity, createTextField } from "@kumiko/framework/engine";

const itemEntity = createEntity({
  table: "items",
  fields: { title: createTextField({ required: true }) },
});

defineFeature("${featureName}", (r) => {
  r.entity("item", itemEntity);
});
`;
}
