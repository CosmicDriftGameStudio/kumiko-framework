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

type ChangelogEntry = {
  version: string;
  type: "breaking" | "improvement" | "fix";
  title: string;
  detail?: string;
  migration?: string;
};

const FEATURES_DIRS = [
  "packages/bundled-features/src",  // framework
  "packages",                        // enterprise (packages/<name>/src/)
];
const CORE_FILE = "packages/framework/src/changes.json"; // framework core — belongs to no feature
const DEFAULT_OUT = "docs/reference/migration-guide.md";

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function readEntries(filePath: string, fromVersion?: string): ChangelogEntry[] {
  if (!existsSync(filePath)) return [];

  const entries: ChangelogEntry[] = [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    if (!Array.isArray(parsed)) return [];

    for (const entry of parsed) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        typeof entry["version"] === "string" &&
        ["breaking", "improvement", "fix"].includes(entry["type"]) &&
        typeof entry["title"] === "string"
      ) {
        const e: ChangelogEntry = {
          version: entry["version"],
          type: entry["type"],
          title: entry["title"],
          detail: typeof entry["detail"] === "string" ? entry["detail"] : undefined,
          migration: typeof entry["migration"] === "string" ? entry["migration"] : undefined,
        };

        if (fromVersion && compareVersions(e.version, fromVersion) <= 0) continue;
        entries.push(e);
      }
    }
  } catch {
    // Skip malformed files
  }

  return entries;
}

function collectChangelogs(fromVersion?: string): Map<string, ChangelogEntry[]> {
  const result = new Map<string, ChangelogEntry[]>();

  const coreEntries = readEntries(CORE_FILE, fromVersion);
  if (coreEntries.length > 0) result.set("framework-core", coreEntries);

  for (const featuresDir of FEATURES_DIRS) {
    if (!existsSync(featuresDir)) continue;

    const features = readdirSync(featuresDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const name of features) {
      // Enterprise: features live in packages/<name>/src/changes.json
      // Framework: features live in packages/<name>/changes.json
      const isEnterprisePkg = featuresDir === "packages";
      const dir = isEnterprisePkg
        ? join(featuresDir, name, "src")
        : join(featuresDir, name);

      const entries = readEntries(join(dir, "changes.json"), fromVersion);
      if (entries.length > 0) {
        const featureKey = isEnterprisePkg ? `enterprise:${name}` : name;
        result.set(featureKey, entries);
      }
    }
  }

  return result;
}

function generateMarkdown(changelogs: Map<string, ChangelogEntry[]>): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push("title: Migration Guide");
  lines.push("description: Breaking changes and migration hints for Kumiko upgrades");
  lines.push("status: reference");
  // guard-doc-status requires an ISO `verified` on every doc under docs/.
  // For a derived doc that date is the generation date — regenerating IS the
  // verification, there is nothing else to check by hand.
  lines.push(`verified: ${new Date().toISOString().slice(0, 10)}`);
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

  // Sort by version descending
  breaking.sort((a, b) => compareVersions(b.entry.version, a.entry.version));

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

    for (const { feature, entry } of items) {
      lines.push(`### ${feature}`);
      lines.push("");
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
  const markdown = generateMarkdown(changelogs);

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

main();
