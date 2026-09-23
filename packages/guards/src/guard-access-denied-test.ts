#!/usr/bin/env bun
/**
 * Guard: role-restricted write handlers need an access-denied test.
 *
 * Rule: any `defineWriteHandler`/`*.writeHandler` call whose `access` object
 * has a `roles` property (and no `openToAll`, and no anonymous/all role) must
 * have a test somewhere in the repo that mentions the handler AND asserts a
 * rejection (AccessDeniedError / access_denied / 403). Matching is file-level
 * and within the handler's own repo, same contract as guard-tenant-escalation.
 *
 * Tripwire: a false-negative (a weak name match hiding a real gap) is
 * tolerated; a false-positive on a clean repo is not.
 *
 * Usage:
 *   bun guards/guard-access-denied-test.ts
 *   Baseline: bun guards/run-guards.ts --write-security-baseline
 */

import * as path from "node:path";
import { type SourceFile, SyntaxKind } from "ts-morph";
import { findRepoRootFor } from "./_lib/baseline-compare";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import {
  escapeRegExp,
  literalStringOf,
  mentionsAsWord,
  nameForms,
} from "./_lib/handler-name-forms";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const ROOT = process.cwd();
const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};
const TEST_FILE = /\.test\.ts$/;

// Any role that lets an unauthenticated/unrestricted caller through means
// nobody is actually excluded by this handler's roles.
const OPEN_ROLE_RE = /["'`](?:anonymous|all)["'`]|\baccess\.(?:all|anonymous)\b/;

type RoleRestrictedHandler = { name: string; file: string; line: number };

export function findRoleRestrictedWriteHandlers(
  files: readonly SourceFile[],
): RoleRestrictedHandler[] {
  const out: RoleRestrictedHandler[] = [];
  for (const sf of files) {
    if (TEST_FILE.test(sf.getFilePath())) continue;
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression().getText();
      if (callee !== "defineWriteHandler" && !/\.writeHandler$/.test(callee)) continue;
      const arg = call.getArguments()[0];
      if (!arg || arg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
      const obj = arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
      const name = literalStringOf(obj.getProperty("name"));
      if (!name) continue;
      const accessProp = obj.getProperty("access");
      if (!accessProp || accessProp.getKind() !== SyntaxKind.PropertyAssignment) continue;
      const accessInit = accessProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
      if (!accessInit || accessInit.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
      const accessObj = accessInit.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
      if (accessObj.getProperty("openToAll")) continue;
      const rolesProp = accessObj.getProperty("roles");
      if (!rolesProp) continue;
      if (
        rolesProp.getKind() !== SyntaxKind.PropertyAssignment &&
        rolesProp.getKind() !== SyntaxKind.ShorthandPropertyAssignment
      )
        continue;
      if (OPEN_ROLE_RE.test(rolesProp.getText())) continue;
      out.push({ name, file: sf.getFilePath(), line: call.getStartLineNumber() });
    }
  }
  return out;
}

const ACCESS_DENIED_ASSERTION = /\bAccessDeniedError\b|\baccess_denied\b|\b403\b/;

const SHORT_WORD = /^[a-z0-9]+$/;

// A single lowercase word ("create", "approve") is common enough in
// unrelated test scaffolding (createTestStack, approveAll) that a bare word-
// boundary match is too loose — only count it as a string-literal end
// ("approve"/"feat:write:approve") or a property access (Handlers.approve).
export function testMentionsHandler(text: string, handlerName: string): boolean {
  return nameForms(handlerName).some((form) => {
    if (!SHORT_WORD.test(form)) return mentionsAsWord(text, form);
    const esc = escapeRegExp(form);
    return new RegExp(`[:"'\`]${esc}["'\`]|\\.${esc}\\b`).test(text);
  });
}

export function findHandlersWithoutAccessDeniedTest(
  files: readonly SourceFile[],
  roots: readonly { readonly absPath: string }[] = [],
): RoleRestrictedHandler[] {
  const repoKeyOf = (filePath: string): string => findRepoRootFor(filePath, roots)?.absPath ?? "";
  const testTextsByRepo = new Map<string, string[]>();
  for (const sf of files) {
    if (!TEST_FILE.test(sf.getFilePath())) continue;
    const text = sf.getFullText();
    if (!ACCESS_DENIED_ASSERTION.test(text)) continue;
    const repoKey = repoKeyOf(sf.getFilePath());
    const texts = testTextsByRepo.get(repoKey) ?? [];
    texts.push(text);
    testTextsByRepo.set(repoKey, texts);
  }
  return findRoleRestrictedWriteHandlers(files).filter((h) => {
    const testTexts = testTextsByRepo.get(repoKeyOf(h.file)) ?? [];
    return !testTexts.some((text) => testMentionsHandler(text, h.name));
  });
}

export const guard: AstGuard = {
  name: "Access-Denied-Test Guard",
  scan: SCAN,
  security: true,
  hint: "Role-restricted write handlers need a test that references the handler and asserts a caller without the role is rejected (AccessDeniedError / access_denied / 403). Existing gaps are frozen in the security baseline; after closing one: `bun guards/run-guards.ts --write-security-baseline`.",
  run(files, roots: readonly RepoRoot[] = resolveRepoRoots()) {
    // consumer CI scans only its own repo, so a sibling repo's test must not count as coverage
    const violations: GuardViolation[] = findHandlersWithoutAccessDeniedTest(files, roots).map(
      (h) => ({
        file: path.relative(ROOT, h.file),
        line: h.line,
        message: `role-restricted write handler "${h.name}" has no access-denied test — add a test that references the handler and asserts a caller without the role is rejected (AccessDeniedError / access_denied / 403).`,
      }),
    );
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
