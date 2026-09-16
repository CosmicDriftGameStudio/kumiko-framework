#!/usr/bin/env bun
// Usability mistakes in screen definitions that are statically decidable and
// otherwise come back screen by screen: a metric without a label, a
// relatedList section whose rows lead nowhere, a row action labelled "edit"
// that does something else. Opt-in per app repo via _app-test.yml.

import { type ObjectLiteralExpression, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import { hasIgnoreTag } from "./_lib/ignore-tag";

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**"],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;
const IGNORE_TAG = "kumiko-lint-ignore screen-conventions";

const SCREEN_TYPE_SUFFIX = "ScreenDefinition";

// Anchor: only object literals that are unambiguously a screen definition —
// either a `const x: XScreenDefinition = {...}` (the house convention, see
// solon's screens.ts) or an inline literal passed straight to `r.screen(...)`.
// Everything else (unrelated object literals with a coincidental `kind`/
// `metrics` property) is deliberately left unchecked — a missed spot beats a
// false positive here.
function findScreenObjectLiterals(sf: SourceFile): ObjectLiteralExpression[] {
  const roots: ObjectLiteralExpression[] = [];
  for (const decl of sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const typeNode = decl.getTypeNode();
    if (!typeNode?.getText().endsWith(SCREEN_TYPE_SUFFIX)) continue;
    const init = decl.getInitializer();
    if (init?.isKind(SyntaxKind.ObjectLiteralExpression)) roots.push(init);
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) continue;
    if (expr.getName() !== "screen") continue;
    const arg = call.getArguments()[0];
    if (arg?.isKind(SyntaxKind.ObjectLiteralExpression)) roots.push(arg);
  }
  return roots;
}

function stringLiteralValue(obj: ObjectLiteralExpression, name: string): string | undefined {
  const prop = obj.getProperty(name);
  if (!prop?.isKind(SyntaxKind.PropertyAssignment)) return undefined;
  const init = prop.getInitializer();
  return init?.isKind(SyntaxKind.StringLiteral) ? init.getLiteralValue() : undefined;
}

function hasDeclaredProperty(obj: ObjectLiteralExpression, name: string): boolean {
  const prop = obj.getProperty(name);
  if (!prop?.isKind(SyntaxKind.PropertyAssignment)) return false;
  const init = prop.getInitializer();
  return init !== undefined && init.getKind() !== SyntaxKind.UndefinedKeyword;
}

// R1: MetricSpec's plain-string shorthand carries no label — every metrics
// entry on a projectionDetail screen must be the object form with `label`.
function checkMetrics(
  root: ObjectLiteralExpression,
  sf: SourceFile,
  violations: GuardViolation[],
): void {
  const metricsProp = root.getProperty("metrics");
  if (!metricsProp?.isKind(SyntaxKind.PropertyAssignment)) return;
  const init = metricsProp.getInitializer();
  if (!init?.isKind(SyntaxKind.ArrayLiteralExpression)) return;
  for (const el of init.getElements()) {
    if (hasIgnoreTag(el, IGNORE_TAG)) continue;
    if (el.isKind(SyntaxKind.StringLiteral)) {
      violations.push({
        file: sf.getFilePath(),
        line: el.getStartLineNumber(),
        message: `metrics-Eintrag "${el.getLiteralValue()}" ist ein reiner String (Zahl ohne Bedeutung) — Objektform mit \`label\` verwenden.`,
      });
      continue;
    }
    if (el.isKind(SyntaxKind.ObjectLiteralExpression) && !hasDeclaredProperty(el, "label")) {
      violations.push({
        file: sf.getFilePath(),
        line: el.getStartLineNumber(),
        message:
          "metrics-Eintrag ohne `label` (Zahl ohne Bedeutung) — Objektform braucht ein Label.",
      });
    }
  }
}

// R2: a relatedList section with neither rowClick nor rowActions renders a
// list nobody can act on.
function checkRelatedListSections(
  root: ObjectLiteralExpression,
  sf: SourceFile,
  violations: GuardViolation[],
): void {
  for (const obj of root.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    if (stringLiteralValue(obj, "kind") !== "relatedList") continue;
    if (hasIgnoreTag(obj, IGNORE_TAG)) continue;
    if (hasDeclaredProperty(obj, "rowClick") || hasDeclaredProperty(obj, "rowActions")) continue;
    violations.push({
      file: sf.getFilePath(),
      line: obj.getStartLineNumber(),
      message: "relatedList-Section ohne `rowClick`/`rowActions` — die Zeile führt nirgendwohin.",
    });
  }
}

// R3: a rowAction whose id isn't "edit" but whose label resolves to an
// ".action.edit" i18n key promises "Bearbeiten" while doing something else.
function checkRowActions(
  root: ObjectLiteralExpression,
  sf: SourceFile,
  violations: GuardViolation[],
): void {
  for (const prop of root.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const name = prop.getName();
    if (name !== "rowActions" && name !== "actions") continue;
    const init = prop.getInitializer();
    if (!init?.isKind(SyntaxKind.ArrayLiteralExpression)) continue;
    for (const el of init.getElements()) {
      if (!el.isKind(SyntaxKind.ObjectLiteralExpression)) continue;
      if (hasIgnoreTag(el, IGNORE_TAG)) continue;
      const id = stringLiteralValue(el, "id");
      const label = stringLiteralValue(el, "label");
      if (id === undefined || label === undefined) continue;
      if (id !== "edit" && label.endsWith(".action.edit")) {
        violations.push({
          file: sf.getFilePath(),
          line: el.getStartLineNumber(),
          message: `rowAction "${id}" hat Label "${label}" (klingt nach Bearbeiten), id ist aber nicht "edit" — Label/Aktion-Mismatch.`,
        });
      }
    }
  }
}

export const guard: AstGuard = {
  name: "Screen-Conventions Guard",
  scan: SCAN,
  hint:
    "metrics-Einträge brauchen die Objektform mit `label`; relatedList-Sections brauchen " +
    '`rowClick` oder `rowActions`; ein rowAction-Label darf nicht auf ".action.edit" enden, ' +
    'wenn die `id` nicht "edit" ist. ' +
    `Begründete Ausnahme: // ${IGNORE_TAG} <Grund>`,
  run(files: readonly SourceFile[]) {
    const violations: GuardViolation[] = [];
    for (const sf of files) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      for (const root of findScreenObjectLiterals(sf)) {
        checkMetrics(root, sf, violations);
        checkRelatedListSections(root, sf, violations);
        checkRowActions(root, sf, violations);
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
