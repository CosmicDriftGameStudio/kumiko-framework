#!/usr/bin/env bun
/**
 * Generates a migration guide from all feature changes.json files.
 *
 * Usage:
 *   bun scripts/gen-migration-guide.ts [--from <version>] [--out <path>]
 *
 * Output: Markdown document listing all breaking changes across features.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  compareVersions,
  filterEntriesAfter,
  parseFeatureChangelog,
  type ChangelogEntry,
} from "@cosmicdrift/kumiko-framework/engine";

const FEATURES_DIRS = [
  "packages/bundled-features/src",  // framework
  "packages",                        // enterprise (packages/<name>/src/)
];
const CORE_FILE = "packages/framework/src/changes.json"; // framework core — belongs to no feature
const DEFAULT_OUT = "docs/reference/migration-guide.md";

function readEntries(filePath: string, fromVersion?: string): readonly ChangelogEntry[] {
  if (!existsSync(filePath)) return [];
  try {
    const entries = parseFeatureChangelog(readFileSync(filePath, "utf-8"), filePath)?.entries ?? [];
    return fromVersion ? filterEntriesAfter(entries, fromVersion) : entries;
  } catch {
    // Skip malformed files
    return [];
  }
}

// baseDir defaults to cwd (the real CLI invocation) — parameterized so
// tests can point it at a temp-dir fixture instead of the real repo tree.
export function collectChangelogs(
  fromVersion?: string,
  baseDir: string = process.cwd(),
): Map<string, readonly ChangelogEntry[]> {
  const result = new Map<string, readonly ChangelogEntry[]>();

  const coreEntries = readEntries(join(baseDir, CORE_FILE), fromVersion);
  if (coreEntries.length > 0) result.set("framework-core", coreEntries);

  for (const featuresDirRel of FEATURES_DIRS) {
    const featuresDir = join(baseDir, featuresDirRel);
    if (!existsSync(featuresDir)) continue;

    const features = readdirSync(featuresDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    for (const name of features) {
      // Enterprise: features live in packages/<name>/src/changes.json
      // Framework: features live in packages/<name>/changes.json
      const isEnterprisePkg = featuresDirRel === "packages";
      const dir = isEnterprisePkg
        ? join(featuresDir, name, "src")
        : join(featuresDir, name);
      const filePath = join(dir, "changes.json");

      // The generic "packages" scan (enterprise pattern) re-discovers
      // packages/framework/src/changes.json under packages/framework —
      // that IS CORE_FILE, already collected above under "framework-core".
      // Without this guard framework's breaking changes are listed twice.
      if (isEnterprisePkg && filePath === join(baseDir, CORE_FILE)) continue;

      const entries = readEntries(filePath, fromVersion);
      if (entries.length > 0) {
        const featureKey = isEnterprisePkg ? `enterprise:${name}` : name;
        result.set(featureKey, entries);
      }
    }
  }

  return result;
}

function generateMarkdown(
  changelogs: Map<string, readonly ChangelogEntry[]>,
  verifiedDate: string,
): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push("title: Migration Guide");
  lines.push("description: Breaking changes and migration hints for Kumiko upgrades");
  lines.push("status: reference");
  // guard-doc-status requires an ISO `verified` on every doc under docs/.
  // For a derived doc that date is the generation date — regenerating IS the
  // verification, there is nothing else to check by hand.
  lines.push(`verified: ${verifiedDate}`);
  lines.push("---");
  lines.push("");
  lines.push("# Migration Guide");
  lines.push("");
  lines.push("This document lists breaking changes across all bundled features.");
  lines.push("Use `kumiko upgrade` to check what's new since your current version.");
  lines.push("");

  // Collect all breaking changes
  const breaking: Array<{ feature: string; entry: ChangelogEntry }> = [];
  for (const [feature, entries] of changelogs) {
    for (const entry of entries) {
      if (entry.type === "breaking") {
        breaking.push({ feature, entry });
      }
    }
  }

  if (breaking.length === 0) {
    lines.push("No breaking changes recorded yet.");
    lines.push("");
    return lines.join("\n");
  }

  // Sort by version descending, feature name as tiebreaker within a version
  // (readdirSync order isn't guaranteed stable across filesystems/OSes —
  // without this, the same source data could emit sections in a different
  // order on CI vs. locally, making the generated file look "drifted").
  breaking.sort(
    (a, b) => compareVersions(b.entry.version, a.entry.version) || a.feature.localeCompare(b.feature),
  );

  // Group by version
  const byVersion = new Map<string, Array<{ feature: string; entry: ChangelogEntry }>>();
  for (const item of breaking) {
    const existing = byVersion.get(item.entry.version) ?? [];
    existing.push(item);
    byVersion.set(item.entry.version, existing);
  }

  for (const [version, items] of byVersion) {
    lines.push(`## ${version}`);
    lines.push("");

    // A feature can have multiple breaking entries in the same version —
    // one "### feature" header per feature, not per entry, or the same
    // header repeats back-to-back for no reason.
    let lastFeature: string | undefined;
    for (const { feature, entry } of items) {
      if (feature !== lastFeature) {
        lines.push(`### ${feature}`);
        lines.push("");
        lastFeature = feature;
      }
      lines.push(`**${entry.title}**`);
      lines.push("");
      if (entry.detail) {
        lines.push(entry.detail);
        lines.push("");
      }
      if (entry.migration) {
        lines.push("**Migration:** " + entry.migration);
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

const VERIFIED_LINE = /^verified: \d{4}-\d{2}-\d{2}$/m;

export function keepVerifiedDateIfUnchanged(
  generated: string,
  outPath: string,
  today: string,
): string {
  if (!existsSync(outPath)) return generated;
  const previous = readFileSync(outPath, "utf-8");
  const previousDate = previous.match(VERIFIED_LINE)?.[0];
  if (previousDate === undefined) return generated;
  const stripDate = (doc: string) => doc.replace(VERIFIED_LINE, "");
  if (stripDate(previous) !== stripDate(generated)) return generated;
  return generated.replace(`verified: ${today}`, previousDate);
}

function main() {
  const args = process.argv.slice(2);
  let fromVersion: string | undefined;
  let outPath = DEFAULT_OUT;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1]) {
      fromVersion = args[i + 1];
      i++;
    } else if (args[i] === "--out" && args[i + 1]) {
      outPath = args[i + 1];
      i++;
    }
  }

  const changelogs = collectChangelogs(fromVersion);
  const today = new Date().toISOString().slice(0, 10);
  // Keep the committed `verified` date when only the date would change:
  // the CI step regenerates and then runs `git diff --exit-code`, so a
  // fresh stamp on unchanged content turns every day after the last commit
  // into a red pipeline.
  const markdown = keepVerifiedDateIfUnchanged(
    generateMarkdown(changelogs, today),
    outPath,
    today,
  );

  // Ensure output directory exists
  const outDir = outPath.split("/").slice(0, -1).join("/");
  if (!existsSync(outDir)) {
    console.error(`  Directory ${outDir} not found`);
    process.exit(1);
  }

  writeFileSync(outPath, markdown, "utf-8");

  let breakingCount = 0;
  for (const entries of changelogs.values()) {
    breakingCount += entries.filter((e) => e.type === "breaking").length;
  }

  console.log(`  Migration Guide: ${breakingCount} breaking changes → ${outPath}`);
}

// Guarded so importing collectChangelogs() for tests doesn't also run the
// CLI and overwrite docs/reference/migration-guide.md as a side effect.
if (import.meta.main) main();
