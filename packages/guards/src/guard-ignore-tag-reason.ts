#!/usr/bin/env bun
/**
 * Ignore-Tag-Reason Guard: every `kumiko-lint-ignore <slug> <reason>` (or file-wide `kumiko-lint-ignore-file <slug> <reason>`) and `biome-ignore[-all|-start] <rule>: <reason>` comment states a real reason.
 * A missing reason, a generic one (`todo`, `legacy`, ...) or one shorter than three words ("invite-flow")
 * only silences a guard without telling the next reader why the exception is safe. Existing hits are
 * frozen per file in `.kumiko-ignore-tag-reason-baseline.json` and may not grow. A missing baseline file counts as an empty baseline, so every existing hit fails until it is frozen with `--write-baseline`.
 * Documentation placeholders (`<reason>`) never count.
 */

import path from "node:path";
import type { SourceFile } from "ts-morph";
import { commentLines } from "./_lib/comment-lines";
import { isGenericReason } from "./_lib/generic-reason";
import {
  ALL_REPO_KINDS,
  type AstGuard,
  baselineRatchet,
  buildSharedProject,
  filesForGuard,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { KUMIKO_IGNORE_ANY_TAG_RE } from "./_lib/ignore-tag";
import { resolveRepoRoots } from "./_lib/roots";

const ROOT = process.cwd();
const GUARD_NAME = "ignore-tag-reason";
const MIN_REASON_WORDS = 3;

const SCAN: ScanSpec = {
  scope: "source+tests",
  kinds: ALL_REPO_KINDS,
  extensions: ["ts", "tsx"],
};

const EXCLUDE = /(\.d\.(ts|tsx)$|\/dist\/)/;
// Only the rules that replaced deleted guards inherit the reason check; other biome-ignore rules never had one.
const BIOME_TAG_LINE_RE =
  /\bbiome-ignore(?:-all|-start)?\s+(lint\/(?:plugin|style\/(?:noProcessEnv|noInlineStyles|noRestrictedImports|noRestrictedGlobals))\S*?)\s*:\s*(.*)$/;

export type WeakIgnoreReason = {
  readonly line: number;
  readonly slug: string;
  readonly reason: string;
};

function isPlaceholder(text: string): boolean {
  return text.startsWith("<");
}

function isWeakReason(reason: string): boolean {
  return isGenericReason(reason) || reason.split(/\s+/).filter(Boolean).length < MIN_REASON_WORDS;
}

export function findWeakIgnoreReasons(fullText: string): WeakIgnoreReason[] {
  const sites: WeakIgnoreReason[] = [];
  for (const { line, body } of commentLines(fullText)) {
    const match = KUMIKO_IGNORE_ANY_TAG_RE.exec(body) ?? BIOME_TAG_LINE_RE.exec(body);
    const slug = match?.[1] ?? "";
    const reason = (match?.[2] ?? "").trim();
    const isCheckable = match !== null && !isPlaceholder(slug) && !isPlaceholder(reason);
    if (isCheckable && isWeakReason(reason)) sites.push({ line, slug, reason });
  }
  return sites;
}

export function weakIgnoreReasonCounts(
  files: readonly SourceFile[],
  roots: ReadonlyArray<{ readonly absPath: string }> = resolveRepoRoots(),
): { counts: Record<string, number>; firstLine: Record<string, number> } {
  const counts: Record<string, number> = {};
  const firstLine: Record<string, number> = {};
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    const sites = findWeakIgnoreReasons(sf.getFullText());
    const first = sites[0];
    if (first === undefined) continue;
    const file = relFromRepoRoot(sf.getFilePath(), roots);
    if (!isLocalFinding({ file })) continue;
    counts[file] = sites.length;
    firstLine[file] = first.line;
  }
  return { counts, firstLine };
}

const weakReasonBaseline = baselineRatchet({
  file: path.join(ROOT, ".kumiko-ignore-tag-reason-baseline.json"),
  formatVersion: 1,
  unit: "ignore tag(s) without a real reason",
});

const REMEDIATION = `Write why the exception is safe in at least ${MIN_REASON_WORDS} words after the slug: // kumiko-lint-ignore <slug> <reason>.`;

export const guard: AstGuard = {
  name: GUARD_NAME,
  scan: SCAN,
  hint: `after fixing hits: \`kumiko-guards guards --write-baseline --guard=${GUARD_NAME}\``,
  run: (files, roots = resolveRepoRoots()) => {
    const { counts, firstLine } = weakIgnoreReasonCounts(files, roots);
    return {
      violations: weakReasonBaseline.check(counts, REMEDIATION, {
        formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard=${GUARD_NAME}\` once.`,
        resolveLine: (file) => firstLine[file] ?? 1,
      }),
    };
  },
  writeBaseline: (files, roots = resolveRepoRoots()) => {
    weakReasonBaseline.write(weakIgnoreReasonCounts(files, roots).counts);
  },
};

if (import.meta.main) {
  if (process.argv.slice(2).includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    guard.writeBaseline?.(filesForGuard(project, guard));
    process.exit(0);
  }
  runStandalone(guard);
}
