#!/usr/bin/env bun
// @runtime dev
// biome-ignore-all lint/suspicious/noConsole: CLI script
//
// Scans samples/ for bundled-feature references and merges curated overrides.
// docs.kumiko.rocks feature-reference reads the output (sample-index.json).
//
// Usage: bun run scripts/gen-sample-index.ts

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "..");
const SAMPLES_ROOT = resolve(APP_ROOT, "../..");
const MANIFEST_PATH = resolve(APP_ROOT, "feature-manifest.json");
const OVERRIDES_PATH = resolve(SAMPLES_ROOT, "sample-index.overrides.json");
export const INDEX_PATH = resolve(SAMPLES_ROOT, "sample-index.json");

const USE_ALL_BUNDLED_SLUG = "apps-use-all-bundled";

const SUMMARY_SECTION_RE =
  /##\s+(?:What (?:it shows|this sample demonstrates|you learn here)|What this shows)[^\n]*\n+([\s\S]*?)(?=\n## |\n---|$)/i;

export type SampleIndexOverride = {
  readonly primarySample: string;
  readonly whenToUse: string;
  readonly sampleBlurb: string;
  readonly screenshot?: string | null;
};

export type SampleIndexOverrides = Readonly<Record<string, SampleIndexOverride>>;

export type SampleIndexFeature = {
  readonly samples: readonly string[];
  readonly hasVisualOutput: boolean;
  readonly readmeSummary?: string;
  readonly primarySample?: string;
  readonly whenToUse?: string;
  readonly sampleBlurb?: string;
  readonly screenshot?: string | null;
};

export type SampleIndex = {
  readonly source: string;
  readonly featureCount: number;
  readonly features: Readonly<Record<string, SampleIndexFeature>>;
};

type MutableFeatureRow = {
  samples: Set<string>;
  hasVisualOutput: boolean;
  readmeSummary?: string;
  primarySample?: string;
  whenToUse?: string;
  sampleBlurb?: string;
  screenshot?: string | null;
};

function toSlug(relPath: string): string {
  return relPath.replace(/\//g, "-");
}

function sampleDirFromSlug(slug: string): string {
  if (slug.startsWith("recipes-")) {
    return join(SAMPLES_ROOT, "recipes", slug.slice("recipes-".length));
  }
  if (slug.startsWith("apps-")) {
    return join(SAMPLES_ROOT, "apps", slug.slice("apps-".length));
  }
  throw new Error(`unknown sample slug: ${slug}`);
}

function extractFeaturesFromText(text: string): Set<string> {
  const feats = new Set<string>();
  for (const m of text.matchAll(/kumiko-bundled-features\/([a-z0-9-]+)/g)) {
    const name = m[1];
    if (name) feats.add(name);
  }
  for (const m of text.matchAll(/r\.requires\(\s*["']([a-z0-9-]+)["']/g)) {
    const name = m[1];
    if (name) feats.add(name);
  }
  for (const m of text.matchAll(/r\.optionalRequires\(\s*["']([a-z0-9-]+)["']/g)) {
    const name = m[1];
    if (name) feats.add(name);
  }
  return feats;
}

function collectSourceFiles(sampleDir: string): readonly string[] {
  const files: string[] = [];
  // usage.ts covers self-hosting recipes (e.g. ledger) that mount a bundled
  // feature directly and carry no host src/feature.ts.
  for (const rel of ["src/feature.ts", "src/run-config.ts", "src/usage.ts", "bin/main.ts"]) {
    const p = join(sampleDir, rel);
    if (existsSync(p)) files.push(p);
  }
  const featuresDir = join(sampleDir, "src/features");
  if (existsSync(featuresDir)) {
    walkTsFiles(featuresDir, files);
  }
  return files;
}

function walkTsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(p, out);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.")
    ) {
      out.push(p);
    }
  }
}

function isVisualSample(dir: string): boolean {
  return (
    existsSync(join(dir, "src/client.tsx")) ||
    existsSync(join(dir, "public")) ||
    existsSync(join(dir, "e2e/screenshot.spec.ts")) ||
    existsSync(join(dir, "e2e/screenshots.spec.ts"))
  );
}

function cleanMarkdownLine(line: string): string {
  return line
    .replace(/^\*\*([^*]+)\*\*:?\s*/, "$1: ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function extractReadmeSummary(readmePath: string): string | undefined {
  if (!existsSync(readmePath)) return undefined;
  const raw = readFileSync(readmePath, "utf-8");
  const body = raw.replace(/^---[\s\S]*?---\n/, "").replace(/^#\s+.+\n+/, "");

  const sectionMatch = SUMMARY_SECTION_RE.exec(body);
  if (sectionMatch?.[1]) {
    // Accumulate consecutive lines of the FIRST paragraph/bullet in the
    // section (stop at a blank line, a table row, or a code fence) — a
    // single-line return truncated any summary that wrapped onto a second
    // physical line in the source README.
    const collected: string[] = [];
    for (const line of sectionMatch[1].split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("```") || trimmed.startsWith("|")) break;
      if (trimmed === "") {
        if (collected.length > 0) break;
        continue;
      }
      if (trimmed.startsWith("#")) continue;
      collected.push(
        collected.length === 0 && trimmed.startsWith("- ") ? trimmed.slice(2) : trimmed,
      );
    }
    if (collected.length > 0) return cleanMarkdownLine(collected.join(" "));
  }

  const para: string[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("#")) continue;
    if (line.trim() === "") {
      if (para.length > 0) break;
      continue;
    }
    if (line.startsWith("```")) break;
    para.push(line.trim());
  }
  const joined = para.join(" ");
  return joined.length > 0 ? joined.slice(0, 320) : undefined;
}

function scanSamples(): Map<string, MutableFeatureRow> {
  const byFeature = new Map<string, MutableFeatureRow>();

  function ensure(feat: string): MutableFeatureRow {
    let row = byFeature.get(feat);
    if (!row) {
      row = { samples: new Set(), hasVisualOutput: false };
      byFeature.set(feat, row);
    }
    return row;
  }

  function walk(dir: string, rel: string): void {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const p = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (!statSync(p).isDirectory()) continue;

      const slug = toSlug(r);
      const sourceFiles = collectSourceFiles(p);
      if (sourceFiles.length > 0) {
        const feats = new Set<string>();
        for (const file of sourceFiles) {
          for (const f of extractFeaturesFromText(readFileSync(file, "utf-8"))) {
            feats.add(f);
          }
        }
        const visual = isVisualSample(p);
        for (const feat of feats) {
          const row = ensure(feat);
          row.samples.add(slug);
          if (visual) row.hasVisualOutput = true;
        }
      }
      walk(p, r);
    }
  }

  walk(join(SAMPLES_ROOT, "recipes"), "recipes");
  walk(join(SAMPLES_ROOT, "apps"), "apps");
  return byFeature;
}

export function loadOverrides(): SampleIndexOverrides {
  if (!existsSync(OVERRIDES_PATH)) return {};
  return JSON.parse(readFileSync(OVERRIDES_PATH, "utf-8")) as SampleIndexOverrides;
}

export function buildSampleIndex(): SampleIndex {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as {
    features: readonly { name: string }[];
  };
  const bundledNames = new Set(manifest.features.map((f) => f.name));
  const overrides = loadOverrides();
  const scanned = scanSamples();

  const features: Record<string, SampleIndexFeature> = {};

  for (const name of bundledNames) {
    const row = scanned.get(name);
    const override = overrides[name];
    const samples = row ? [...row.samples].sort() : [];
    const dedicated = samples.filter((s) => s !== USE_ALL_BUNDLED_SLUG);
    if (dedicated.length === 0 && !override) continue;

    const primarySample = override?.primarySample ?? dedicated[0];
    let readmeSummary: string | undefined;
    if (primarySample) {
      readmeSummary = extractReadmeSummary(join(sampleDirFromSlug(primarySample), "README.md"));
    }

    features[name] = {
      samples: dedicated.length > 0 ? dedicated : samples,
      hasVisualOutput: row?.hasVisualOutput ?? false,
      ...(readmeSummary ? { readmeSummary } : {}),
      ...(override?.primarySample ? { primarySample: override.primarySample } : {}),
      ...(override?.whenToUse ? { whenToUse: override.whenToUse } : {}),
      ...(override?.sampleBlurb != null ? { sampleBlurb: override.sampleBlurb } : {}),
      ...(override && "screenshot" in override ? { screenshot: override.screenshot ?? null } : {}),
    };
  }

  return {
    source:
      "samples/apps/use-all-bundled/scripts/gen-sample-index.ts + sample-index.overrides.json",
    featureCount: Object.keys(features).length,
    features,
  };
}

export function serializeSampleIndex(index: SampleIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const index = buildSampleIndex();
  writeFileSync(INDEX_PATH, serializeSampleIndex(index), "utf-8");
  console.log(`sample-index.json: ${index.featureCount} features → ${INDEX_PATH}`);
}
