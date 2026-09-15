#!/usr/bin/env bun
/**
 * Guard: raw interactive HTML elements in feature UI. <a>, <details> and
 * <summary> each have a framework replacement (usePrimitives().Link,
 * CollapsibleSection from @cosmicdrift/kumiko-renderer-web) but nothing was
 * checking for them — turn-cards.tsx/agent-layer.tsx (raw <details>/<summary>)
 * and agent-settings.tsx (raw <a href>) shipped past CI in kumiko-enterprise.
 *
 * <button>/<input>/<select>/<textarea>/<dialog>/<form> are deliberately NOT
 * in this guard: <button>/<input>/<select>/<textarea>/<dialog> are already
 * enforced by guard-primitives-discipline.ts (its own CI step, not this
 * bundle), and <form> is a documented exception (PR #488, agent-layer.tsx:71
 * uses a native <form onSubmit> on purpose) — adding either back here would
 * duplicate or contradict an existing rule.
 *
 * Only fires when the file demonstrably has primitives access (same gate as
 * guard-no-custom-primitives's raw-form-html rule) — proof the replacement
 * was reachable, not just a tag ban on files outside the primitives world.
 *
 * Baseline-regression guard like guard-tailwind-scan-surface.ts: pins the
 * currently-known violation count per file. Reductions are allowed but
 * don't auto-update the baseline. Without a baseline file the guard stays
 * warning-only (bootstrap: run `--write-baseline` once).
 *
 * Usage:
 *   bun guards/guard-raw-interactive-elements.ts                  # compare against baseline
 *   bun guards/guard-raw-interactive-elements.ts --write-baseline # (re)write the baseline
 *   bun guards/guard-raw-interactive-elements.ts --no-baseline    # skip the comparison
 */

import * as path from "node:path";
import { type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  baselineRatchet,
  buildSharedProject,
  filesForGuard,
  type GuardOutcome,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { hasIgnoreTag } from "./_lib/ignore-tag";
import { hasPrimitivesAccess } from "./_lib/primitives-access";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["tsx"],
  frameworkWithin: ["packages/bundled-features/src/**"],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;
const IGNORE_TAG = "kumiko-lint-ignore raw-interactive-elements";

type BannedTag = "a" | "details" | "summary";

const REPLACEMENT: Readonly<Record<BannedTag, string>> = {
  a: "usePrimitives().Link",
  details: "CollapsibleSection (@cosmicdrift/kumiko-renderer-web)",
  summary: "CollapsibleSection (@cosmicdrift/kumiko-renderer-web)",
};

function isBannedTag(tag: string): tag is BannedTag {
  return Object.hasOwn(REPLACEMENT, tag);
}

export type Finding = {
  readonly file: string;
  readonly line: number;
  readonly tag: BannedTag;
};

function scan(files: readonly SourceFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    if (!hasPrimitivesAccess(sf)) continue;
    const elements = [
      ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ];
    for (const el of elements) {
      const tag = el.getTagNameNode().getText();
      if (!isBannedTag(tag)) continue;
      if (hasIgnoreTag(el, IGNORE_TAG)) continue;
      const file = path.relative(ROOT, sf.getFilePath());
      const line = el.getStartLineNumber();
      findings.push({ file, line, tag });
      console.warn(
        `  [raw-interactive-elements WARN] ${file}:${line}  raw <${tag}> — use ${REPLACEMENT[tag]}`,
      );
    }
  }
  return findings;
}

export function baselineCounts(findings: readonly Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.file] = (counts[f.file] ?? 0) + 1;
  return counts;
}

const BASELINE_FILE = ".kumiko-raw-interactive-elements-baseline.json";
const rawInteractiveElementsBaseline = baselineRatchet({
  file: path.join(ROOT, BASELINE_FILE),
  formatVersion: 1,
  unit: "Fund(e) rohes interaktives HTML",
});

const REMEDIATION =
  "Framework replacement: <a> → usePrimitives().Link, <details>/<summary> → CollapsibleSection " +
  `(@cosmicdrift/kumiko-renderer-web). Genuine exception: // ${IGNORE_TAG} <reason>`;

function analyse(files: readonly SourceFile[], compareBaseline: boolean): GuardOutcome {
  const findings = scan(files);
  if (!compareBaseline) {
    console.log("  Baseline-Vergleich uebersprungen (--no-baseline).");
    return { violations: [] };
  }
  const resolveLine = (file: string): number => findings.find((f) => f.file === file)?.line ?? 1;
  return {
    violations: rawInteractiveElementsBaseline.check(baselineCounts(findings), REMEDIATION, {
      formatDriftRemediation:
        "Einmalig `bun guards/guard-raw-interactive-elements.ts --write-baseline` aufrufen.",
      resolveLine,
    }),
  };
}

export const guard: AstGuard = {
  name: "Raw-Interactive-Elements Guard (App-Repos)",
  scan: SCAN,
  hint: REMEDIATION,
  run: (files: readonly SourceFile[]) => analyse(files, true),
};

// Flags are read ONLY here, not in run() — the shared runner
// (run-ui-guards.ts) runs every guard with the same argv, a
// --write-baseline there must not silently rewrite the baseline.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    const findings = scan(filesForGuard(project, guard));
    rawInteractiveElementsBaseline.write(baselineCounts(findings));
    process.exit(0);
  }
  if (args.includes("--no-baseline")) {
    const project = buildSharedProject([guard]);
    analyse(filesForGuard(project, guard), false);
    process.exit(0);
  }
  runStandalone(guard);
}
