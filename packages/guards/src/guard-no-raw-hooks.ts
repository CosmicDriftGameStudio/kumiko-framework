#!/usr/bin/env bun
// Rerender protection: raw useEffect/useLayoutEffect + fetch() in app
// screens are the source of the endless-rerender class (unstable deps,
// setState-in-effect) and bypass the framework hook set (useQuery/
// useMutation/useDisclosure — useQuery can go live via SSE). Endless
// rerenders aren't reliably detectable statically; the guard eliminates the
// pattern that produces them.
//
// Local UI state via useState stays allowed.
//
// Part of App-Mounting 2.0 (infra#208).

import { Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import { hasIgnoreTag } from "./_lib/ignore-tag";

// Match property/identifier names instead of call text — otherwise
// namespace-/alias-qualified calls (`React.useEffect(...)`, a renamed
// import `useEffect as useFx`) slip through, because getText() returns the
// full expression ("React.useEffect") instead of just the banned name.
function calleeName(expr: import("ts-morph").Node): string {
  if (Node.isPropertyAccessExpression(expr)) return expr.getName();
  return expr.getText();
}

// Only component files in web/public code. API clients (*.ts) stay out of
// scope — they encapsulate fetch deliberately in one place.
const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["tsx"],
  within: ["**/web/**", "public/**"],
  frameworkWithin: ["packages/bundled-features/src/**"],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;
const IGNORE_TAG = "kumiko-lint-ignore no-raw-hooks";

const BANNED_HOOKS = new Set(["useEffect", "useLayoutEffect"]);

export const guard: AstGuard = {
  name: "No-Raw-Hooks Guard (App-Repos)",
  scan: SCAN,
  hint:
    "Use the framework hook set: useQuery (live: true for SSE), useMutation, useDisclosure. " +
    `Real special case (DOM integration or similar): // ${IGNORE_TAG} <reason>`,
  run(files: readonly SourceFile[]) {
    const violations: GuardViolation[] = [];
    for (const sf of files) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression();
        const name = calleeName(callee);
        if (BANNED_HOOKS.has(name)) {
          if (hasIgnoreTag(call, IGNORE_TAG)) continue;
          violations.push({
            file: sf.getFilePath(),
            line: call.getStartLineNumber(),
            message: `${name} in App-Screen — use framework hooks (useQuery/useMutation/useDisclosure)`,
          });
          continue;
        }
        if (name === "fetch") {
          if (hasIgnoreTag(call, IGNORE_TAG)) continue;
          violations.push({
            file: sf.getFilePath(),
            line: call.getStartLineNumber(),
            message: "fetch() in App-Screen — use useQuery/useMutation or an API client (*.ts)",
          });
        }
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
