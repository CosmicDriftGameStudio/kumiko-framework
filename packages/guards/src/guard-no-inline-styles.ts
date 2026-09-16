#!/usr/bin/env bun
// No inline CSS in app code: `style={...}` props and `React.CSSProperties`
// style objects bypass theme tokens and dark mode. Use widgets/tokens.
//
// Part of App-Mounting 2.0 (infra#208).

import { type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import { hasIgnoreTag } from "./_lib/ignore-tag";

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/bundled-features/src/**"],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;
const IGNORE_TAG = "kumiko-lint-ignore no-inline-styles";

export const guard: AstGuard = {
  name: "No-Inline-Styles Guard (App-Repos)",
  scan: SCAN,
  hint:
    "Replace style=/CSSProperties in app code with widgets + theme tokens. " +
    `Justified exception (e.g. dynamic width from data): // ${IGNORE_TAG} <reason>`,
  run(files: readonly SourceFile[]) {
    const violations: GuardViolation[] = [];
    for (const sf of files) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
        if (attr.getNameNode().getText() !== "style") continue;
        if (hasIgnoreTag(attr, IGNORE_TAG)) continue;
        violations.push({
          file: sf.getFilePath(),
          line: attr.getStartLineNumber(),
          message: "style= prop in app code (use theme tokens/widgets)",
        });
      }
      // ponytail: name-text comparison doesn't tolerate aliased imports
      // (import { CSSProperties as CSS }) and false-positives on same-named
      // local types. The style=-JsxAttribute above is the primary, more
      // robust signal path — this TypeReference check is deliberately
      // best-effort.
      for (const ref of sf.getDescendantsOfKind(SyntaxKind.TypeReference)) {
        const name = ref.getTypeName().getText();
        if (name !== "CSSProperties" && name !== "React.CSSProperties") continue;
        if (hasIgnoreTag(ref, IGNORE_TAG)) continue;
        violations.push({
          file: sf.getFilePath(),
          line: ref.getStartLineNumber(),
          message: "CSSProperties style object in app code (use theme tokens/widgets)",
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
