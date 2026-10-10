#!/usr/bin/env bun
// App features follow the bundled-features convention (reference: tenant/):
// feature.ts = registration only, screens under web/, handlers under handlers/.
// This guard flags the three most expensive deviations:
//   1. web.tsx/web.ts monolith or JSX screens directly at the feature root
//   2. feature.ts as a logic dump (> MAX_FEATURE_TS_LINES lines)
//   3. r.screen({ type: "custom" }) without an allowlist tag — declarative
//      screen types (entityList/dashboard/data-table) are the default.
//
// ponytail: the handler file convention (*.query.ts/*.write.ts under handlers/)
// is not enforced yet — add it once the registration API shapes are
// inventoried and stable.
//
// Part of App-Mounting 2.0 (infra#208).

import * as path from "node:path";
import { type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import { hasIgnoreTag } from "./_lib/ignore-tag";

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  within: ["features/**"],
  frameworkWithin: ["packages/bundled-features/src/**"],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;
const IGNORE_TAG = "kumiko-lint-ignore app-feature-structure";

const MAX_FEATURE_TS_LINES = 300;

// src/features/<name>/<file> or packages/bundled-features/src/<name>/<file>
// — exactly one level below the feature folder.
function isFeatureRootFile(filePath: string): boolean {
  const m = filePath.match(/(src\/features|packages\/bundled-features\/src)\/[^/]+\/[^/]+$/);
  return m !== null;
}

export const guard: AstGuard = {
  name: "App-Feature-Structure Guard (App-Repos)",
  scan: SCAN,
  hint:
    "Convention: feature.ts is registration only, screens live under web/ (one file per screen), handlers under handlers/, " +
    `domain logic under lib/. Custom screens need // ${IGNORE_TAG} <reason> (declarative screen types are the default).`,
  run(files: readonly SourceFile[]) {
    const violations: GuardViolation[] = [];
    for (const sf of files) {
      const filePath = sf.getFilePath();
      if (EXCLUDE.test(filePath)) continue;
      const base = path.basename(filePath);

      // 1a. web.ts(x)-Monolith am Feature-Root
      if (isFeatureRootFile(filePath) && (base === "web.tsx" || base === "web.ts")) {
        if (!hasIgnoreTag(sf.getChildren()[0] ?? sf, IGNORE_TAG)) {
          violations.push({
            file: filePath,
            line: 1,
            message:
              "web monolith at feature root — screens/client def belong under web/ (index.ts + one file per screen)",
          });
        }
      }

      // 1b. JSX directly at the feature root (screens belong under web/)
      if (
        isFeatureRootFile(filePath) &&
        filePath.endsWith(".tsx") &&
        base !== "web.tsx" &&
        sf.getDescendantsOfKind(SyntaxKind.JsxElement).length +
          sf.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length >
          0 &&
        !hasIgnoreTag(sf.getChildren()[0] ?? sf, IGNORE_TAG)
      ) {
        violations.push({
          file: filePath,
          line: 1,
          message: "JSX component at feature root — move it under web/",
        });
      }

      // 2. feature.ts als Logik-Dump
      if (base === "feature.ts" && isFeatureRootFile(filePath)) {
        const lines = sf.getEndLineNumber();
        if (lines > MAX_FEATURE_TS_LINES && !hasIgnoreTag(sf.getChildren()[0] ?? sf, IGNORE_TAG)) {
          violations.push({
            file: filePath,
            line: 1,
            message: `feature.ts has ${lines} lines (max ${MAX_FEATURE_TS_LINES}) — move handlers to handlers/, schemas to schema/, logic to lib/`,
          });
        }
      }

      // 3. type: "custom" without an allowlist tag
      for (const prop of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
        if (prop.getName() !== "type") continue;
        const init = prop.getInitializer();
        if (init === undefined || init.getKind() !== SyntaxKind.StringLiteral) continue;
        if (init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText() !== "custom") continue;
        // Nur r.screen-Kontext: das umgebende Call-Target muss auf .screen enden.
        const call = prop.getFirstAncestorByKind(SyntaxKind.CallExpression);
        if (call === undefined || !call.getExpression().getText().endsWith(".screen")) continue;
        // Only the screen's own config declares its type; nested `{ type: "custom" }` objects are widget config.
        if (prop.getParent() !== call.getArguments()[0]) continue;
        if (hasIgnoreTag(call, IGNORE_TAG) || hasIgnoreTag(prop, IGNORE_TAG)) continue;
        violations.push({
          file: filePath,
          line: prop.getStartLineNumber(),
          message: `r.screen type:"custom" without allowlist tag — use a declarative screen type or // ${IGNORE_TAG} <reason>`,
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
