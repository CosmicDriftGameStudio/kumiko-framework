#!/usr/bin/env bun
// App-Features folgen der bundled-features-Konvention (Referenz: tenant/):
// feature.ts = nur Registrierung, Screens unter web/, Handler unter handlers/.
// Dieser Guard flaggt die drei teuersten Abweichungen:
//   1. web.tsx/web.ts-Monolith bzw. JSX-Screens direkt am Feature-Root
//   2. feature.ts als Logik-Dump (> MAX_FEATURE_TS_LINES Zeilen)
//   3. r.screen({ type: "custom" }) ohne Allowlist-Tag — deklarative
//      Screen-Typen (entityList/dashboard/data-table) sind der Default.
//
// ponytail: Handler-Datei-Konvention (*.query.ts/*.write.ts unter handlers/)
// wird noch nicht erzwungen — nachziehen, wenn die Registrierungs-API-Formen
// stabil inventarisiert sind.
//
// Teil von App-Mounting 2.0 (infra#208).

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

// src/features/<name>/<file> bzw. packages/bundled-features/src/<name>/<file>
// — genau eine Ebene unter dem Feature-Ordner.
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

      // 1b. JSX direkt am Feature-Root (Screens gehören unter web/)
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

      // 3. type: "custom" ohne Allowlist-Tag
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
