#!/usr/bin/env bun
// Apps no longer build their own UI primitives: components with primitive
// names (…Card, …Table, …Badge, …Button, …Chart, ProgressBar, MiniStat, …)
// exist in the framework (usePrimitives() resp. widgets/) — app rebuilds
// drift visually and cost every migration twice.
//
// Second rule (infra#748): raw form HTML (<input>/<select>/<textarea>/
// <label>) in app/feature web code, regardless of what the file imports —
// an import gate here previously let the designer's raw <input>s pass just
// by importing from @cosmicdrift/kumiko-renderer (types only) instead of
// -renderer-web, without ever touching a framework primitive. Baseline-
// ratcheted (freeze the existing backlog, no half-ratchet). Deviating from
// the usual "no baseline file = warn-only until --write-baseline": the
// measured backlog is 0 in every locally checked repo, so this fails
// closed against an empty baseline while no baseline file exists —
// otherwise the rule would stay silent in every app repo until someone
// manually runs --write-baseline there.
//
// Part of App-Mounting 2.0 (infra#208).

import { existsSync } from "node:fs";
import * as path from "node:path";
import { type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  baselineRatchet,
  buildSharedProject,
  compareToBaseline,
  filesForGuard,
  type GuardViolation,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { hasIgnoreTag } from "./_lib/ignore-tag";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["tsx"],
  frameworkWithin: ["packages/bundled-features/src/**"],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;
const IGNORE_TAG = "kumiko-lint-ignore no-custom-primitives";

// PascalCase + primitive suffix, or a known widget name.
const PRIMITIVE_NAME =
  /^[A-Z]\w*(Card|Table|Badge|Button|Chart|Modal|Dialog|Tooltip|Spinner|Sparkline)$|^(ProgressBar|MiniStat|StatCard|EmptyState|LoadingState|ErrorState|ModeSwitch|Collapsible\w*|DetailList)$/;

const RAW_FORM_TAGS = new Set(["input", "select", "textarea", "label"]);

type RawFormFinding = {
  readonly file: string;
  readonly line: number;
  readonly tag: string;
};

function collectRawFormHtml(sf: SourceFile): RawFormFinding[] {
  const findings: RawFormFinding[] = [];
  const elements = [
    ...sf.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];
  for (const el of elements) {
    const tag = el.getTagNameNode().getText();
    if (!RAW_FORM_TAGS.has(tag)) continue;
    if (hasIgnoreTag(el, IGNORE_TAG)) continue;
    findings.push({
      file: path.relative(ROOT, sf.getFilePath()),
      line: el.getStartLineNumber(),
      tag,
    });
  }
  return findings;
}

function countByFile(findings: readonly RawFormFinding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.file] = (counts[f.file] ?? 0) + 1;
  return counts;
}

const BASELINE_FILE = ".kumiko-no-custom-primitives-baseline.json";
const BASELINE_PATH = path.join(ROOT, BASELINE_FILE);
const rawFormHtmlBaseline = baselineRatchet({
  file: BASELINE_PATH,
  formatVersion: 1,
  unit: "raw form HTML finding(s)",
});
const RAW_FORM_HTML_REMEDIATION =
  "Use a framework widget (@cosmicdrift/kumiko-renderer-web: Field/Input, ComboboxInput, …) " +
  `or usePrimitives(). Real exception: // ${IGNORE_TAG} <reason>`;

// The rule is new: measured backlog is 0 in every locally checked repo
// (infra#748). Without a baseline file, check fail-closed against an empty
// baseline instead of (as usual) warn-only until the first
// `--write-baseline` — otherwise the rule would stay silent in every app
// repo until it separately commits its own baseline file (every baseline
// file is repo-local, see .kumiko-comment-lang-baseline.json etc.).
function checkRawFormHtmlBaseline(findings: readonly RawFormFinding[]): GuardViolation[] {
  const resolveLine = (file: string): number => findings.find((f) => f.file === file)?.line ?? 1;
  const current = countByFile(findings);
  if (!existsSync(BASELINE_PATH)) {
    const { regressions } = compareToBaseline(current, {});
    return regressions.map((r) => ({
      file: r.file,
      line: resolveLine(r.file),
      message: `${r.current} raw form HTML finding(s) (no baseline — existing backlog is 0). ${RAW_FORM_HTML_REMEDIATION}`,
    }));
  }
  return rawFormHtmlBaseline.check(current, RAW_FORM_HTML_REMEDIATION, {
    formatDriftRemediation:
      "Run `bun guards/guard-no-custom-primitives.ts --write-baseline` once.",
    resolveLine,
  });
}

function analyse(
  files: readonly SourceFile[],
  compareBaseline: boolean,
): { violations: GuardViolation[] } {
  const violations: GuardViolation[] = [];
  const rawFormFindings: RawFormFinding[] = [];
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    const candidates: {
      name: string;
      line: number;
      node: Parameters<typeof hasIgnoreTag>[0];
    }[] = [];
    for (const fn of sf.getFunctions()) {
      const name = fn.getName();
      if (name !== undefined) candidates.push({ name, line: fn.getStartLineNumber(), node: fn });
    }
    for (const v of sf.getVariableDeclarations()) {
      const init = v.getInitializer();
      if (init === undefined) continue;
      const kind = init.getKind();
      if (kind !== SyntaxKind.ArrowFunction && kind !== SyntaxKind.FunctionExpression) continue;
      candidates.push({
        name: v.getName(),
        line: v.getStartLineNumber(),
        node: v,
      });
    }
    for (const c of candidates) {
      if (!PRIMITIVE_NAME.test(c.name)) continue;
      if (hasIgnoreTag(c.node, IGNORE_TAG)) continue;
      violations.push({
        file: sf.getFilePath(),
        line: c.line,
        message: `App-local UI primitive "${c.name}" — use a framework widget/primitive`,
      });
    }
    rawFormFindings.push(...collectRawFormHtml(sf));
  }
  if (!compareBaseline) {
    console.log("  Baseline comparison skipped (--no-baseline).");
  } else {
    violations.push(...checkRawFormHtmlBaseline(rawFormFindings));
  }
  return { violations };
}

export const guard: AstGuard = {
  name: "No-Custom-Primitives Guard (App-Repos)",
  scan: SCAN,
  hint:
    "Use a framework widget (@cosmicdrift/kumiko-renderer-web: StatCard, SectionCard, StatusBadge, QueryTable, Charts, …) " +
    `or usePrimitives(). Real domain component without a framework equivalent: // ${IGNORE_TAG} <reason>`,
  run: (files: readonly SourceFile[]) => analyse(files, true),
};

// Flags are read ONLY here, not in run() — the shared runner
// (run-guards.ts/run-ui-guards.ts) runs every guard with the same argv, a
// --write-baseline there must not silently rewrite the baseline (same
// pattern as guard-pii-annotations.ts).
//
// No --no-baseline: unlike guard-pii-annotations.ts this guard has a
// second, non-baselined rule (PRIMITIVE_NAME) — a --no-baseline that
// discards analyse()'s return and exits 0 would silence that too. Nobody
// reads the flag (the shared runner only calls run()).
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    const findings: RawFormFinding[] = [];
    for (const sf of filesForGuard(project, guard)) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      findings.push(...collectRawFormHtml(sf));
    }
    rawFormHtmlBaseline.write(countByFile(findings));
    process.exit(0);
  }
  runStandalone(guard);
}
