#!/usr/bin/env bun
/**
 * Guard: keeps the row-level-security escape hatches out of consumer code.
 *
 * 1. Outside the framework repo nothing may import `@cosmicdrift/kumiko-framework/internal/*`.
 * 2. `runInRowLevelSecurityScope`, `runInSystemRowLevelSecurityScope` and
 *    `tenantRowLevelSecurityScope` from `@cosmicdrift/kumiko-testing/helpers` are test-only.
 * 3. `runInSystemRowLevelSecurityScope` and `systemScopedRunner` take a non-empty string literal
 *    reason, so every system-scope entry stays greppable; `SYSTEM_ROW_LEVEL_SECURITY_SCOPE` is
 *    framework-internal and only used by an allowlist.
 *
 * Usage:
 *   bun guards/guard-internal-subpath-imports.ts
 *
 * Exit 1 on violations, 0 when clean.
 */

import { type Node, type SourceFile, SyntaxKind } from "ts-morph";
import { findRepoRootFor } from "./_lib/baseline-compare";
import {
  ALL_REPO_KINDS,
  type AstGuard,
  isAllowlisted,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { resolveRepoRoots } from "./_lib/roots";
import { TEST_FILE_RE } from "./_lib/test-file";

const SCAN: ScanSpec = {
  kinds: ALL_REPO_KINDS,
  scope: "source+tests",
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

const INTERNAL_PREFIX = "@cosmicdrift/kumiko-framework/internal/";
const TESTING_HELPERS = "@cosmicdrift/kumiko-testing/helpers";

const TEST_ONLY_SCOPE_SYMBOLS = new Set([
  "runInRowLevelSecurityScope",
  "runInSystemRowLevelSecurityScope",
  "tenantRowLevelSecurityScope",
]);

// Position of the reason argument per call.
const REASON_ARG_INDEX: Record<string, number> = {
  runInSystemRowLevelSecurityScope: 0,
  systemScopedRunner: 1,
};

const FIXED_SCOPE_SYMBOL = "SYSTEM_ROW_LEVEL_SECURITY_SCOPE";

const FIXED_SCOPE_ALLOWLIST = [
  /^packages\/framework\/src\/db\/row-level-security-scope\.ts$/,
  /^packages\/framework\/src\/pipeline\/dispatch-scope\.ts$/,
  /^packages\/framework\/src\/db\/migrate-runner\.ts$/,
];

// Exercises the empty-reason rejection, so it passes empty literals on purpose.
const REASON_RULE_EXEMPT = [
  /^packages\/framework\/src\/db\/__tests__\/row-level-security-scope\.test\.ts$/,
];

type Finding = { line: number; message: string };

function isTestFile(rel: string): boolean {
  return rel.split("/").includes("__tests__") || TEST_FILE_RE.test(rel);
}

function isInternalSpecifier(specifier: string): boolean {
  return specifier.startsWith(INTERNAL_PREFIX);
}

// Literal text of a string argument; for a template with substitutions only its static head.
function staticSpecifierHead(arg: Node): string | undefined {
  const kind = arg.getKind();
  if (kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return arg.getText().slice(1, -1);
  }
  if (kind === SyntaxKind.TemplateExpression) {
    return arg.asKindOrThrow(SyntaxKind.TemplateExpression).getHead().getLiteralText();
  }
  return undefined;
}

function findInternalImports(sf: SourceFile): Finding[] {
  const findings: Finding[] = [];
  const report = (line: number, specifier: string): void => {
    findings.push({
      line,
      message: `[internal-import] "${specifier}" is framework-internal; consumer code must not import it`,
    });
  };
  for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
    const specifier = decl.getModuleSpecifierValue();
    if (specifier !== undefined && isInternalSpecifier(specifier)) {
      report(decl.getStartLineNumber(), specifier);
    }
  }
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const isDynamicImport = callee.getKind() === SyntaxKind.ImportKeyword;
    const isRequire = callee.getKind() === SyntaxKind.Identifier && callee.getText() === "require";
    if (!isDynamicImport && !isRequire) continue;
    const arg = call.getArguments()[0];
    if (arg === undefined) continue;
    const specifier = staticSpecifierHead(arg);
    if (specifier !== undefined && isInternalSpecifier(specifier)) {
      report(call.getStartLineNumber(), specifier);
    }
  }
  return findings;
}

function findTestOnlyScopeImports(sf: SourceFile): Finding[] {
  const findings: Finding[] = [];
  const decls = [
    ...sf.getImportDeclarations(),
    ...sf.getExportDeclarations().filter((d) => d.getModuleSpecifier() !== undefined),
  ];
  for (const decl of decls) {
    if (decl.getModuleSpecifierValue() !== TESTING_HELPERS) continue;
    const named =
      "getNamedImports" in decl
        ? decl.getNamedImports().map((n) => n.getName())
        : decl.getNamedExports().map((n) => n.getName());
    for (const name of named) {
      if (!TEST_ONLY_SCOPE_SYMBOLS.has(name)) continue;
      findings.push({
        line: decl.getStartLineNumber(),
        message: `[test-only-scope] ${name} from ${TESTING_HELPERS} is allowed in test files only`,
      });
    }
  }
  const namespaces = new Set<string>();
  for (const decl of sf.getImportDeclarations()) {
    if (decl.getModuleSpecifierValue() !== TESTING_HELPERS) continue;
    const ns = decl.getNamespaceImport();
    if (ns !== undefined) namespaces.add(ns.getText());
  }
  if (namespaces.size > 0) {
    for (const access of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      const name = access.getName();
      if (!TEST_ONLY_SCOPE_SYMBOLS.has(name)) continue;
      if (!namespaces.has(access.getExpression().getText())) continue;
      findings.push({
        line: access.getStartLineNumber(),
        message: `[test-only-scope] ${name} from ${TESTING_HELPERS} is allowed in test files only`,
      });
    }
  }
  return findings;
}

// Maps local binding names (aliases included) to the symbol they import.
function localNamesOf(sf: SourceFile, symbols: ReadonlySet<string>): Map<string, string> {
  const names = new Map<string, string>();
  for (const decl of sf.getImportDeclarations()) {
    for (const named of decl.getNamedImports()) {
      const original = named.getName();
      if (symbols.has(original)) names.set(named.getAliasNode()?.getText() ?? original, original);
    }
  }
  for (const symbol of symbols) {
    if (!names.has(symbol)) names.set(symbol, symbol);
  }
  return names;
}

function isNonEmptyStringLiteral(node: { getKind(): SyntaxKind; getText(): string }): boolean {
  const kind = node.getKind();
  if (kind !== SyntaxKind.StringLiteral && kind !== SyntaxKind.NoSubstitutionTemplateLiteral) {
    return false;
  }
  return node.getText().slice(1, -1).trim() !== "";
}

// `fn(...)` through a local binding (aliases included) or `<namespace>.fn(...)` by property name.
function reasonSymbolOf(callee: Node, locals: ReadonlyMap<string, string>): string | undefined {
  if (callee.getKind() === SyntaxKind.Identifier) return locals.get(callee.getText());
  if (callee.getKind() === SyntaxKind.PropertyAccessExpression) {
    const name = callee.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
    return Object.hasOwn(REASON_ARG_INDEX, name) ? name : undefined;
  }
  return undefined;
}

function findReasonViolations(sf: SourceFile): Finding[] {
  const findings: Finding[] = [];
  const locals = localNamesOf(sf, new Set(Object.keys(REASON_ARG_INDEX)));
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const symbol = reasonSymbolOf(callee, locals);
    if (symbol === undefined) continue;
    const reasonArg = call.getArguments()[REASON_ARG_INDEX[symbol] ?? 0];
    if (reasonArg !== undefined && isNonEmptyStringLiteral(reasonArg)) continue;
    findings.push({
      line: call.getStartLineNumber(),
      message: `[system-scope-reason] ${symbol} needs a non-empty string literal reason as argument ${(REASON_ARG_INDEX[symbol] ?? 0) + 1}`,
    });
  }
  return findings;
}

function findFixedScopeUses(sf: SourceFile): Finding[] {
  return sf
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .filter((id) => id.getText() === FIXED_SCOPE_SYMBOL)
    .map((id) => ({
      line: id.getStartLineNumber(),
      message: `[fixed-system-scope] ${FIXED_SCOPE_SYMBOL} carries no call-site reason; use runInSystemRowLevelSecurityScope(reason, fn)`,
    }));
}

export const guard: AstGuard = {
  name: "Internal-Subpath-Imports Guard",
  scan: SCAN,
  hint: "Consumer repos use the public subpaths only; `@cosmicdrift/kumiko-framework/internal/*` is for framework packages. Scope helpers from kumiko-testing/helpers belong in tests. Every system-scope entry passes a specific string-literal reason (why it needs cross-tenant access). SYSTEM_ROW_LEVEL_SECURITY_SCOPE is limited to row-level-security-scope.ts, dispatch-scope.ts and migrate-runner.ts; extend that allowlist in guard-internal-subpath-imports.ts with a reason.",
  run(files, roots = resolveRepoRoots()) {
    const violations: Array<{ file: string; line: number; message: string }> = [];

    for (const sf of files) {
      const file = sf.getFilePath();
      const rel = relFromRepoRoot(file, roots);
      const isFrameworkRepo = findRepoRootFor(file, roots)?.kind === "framework";
      const findings: Finding[] = [];
      if (!isFrameworkRepo) findings.push(...findInternalImports(sf));
      if (!isTestFile(rel)) findings.push(...findTestOnlyScopeImports(sf));
      if (!isAllowlisted(rel, REASON_RULE_EXEMPT)) findings.push(...findReasonViolations(sf));
      if (!isAllowlisted(rel, FIXED_SCOPE_ALLOWLIST)) findings.push(...findFixedScopeUses(sf));
      for (const f of findings) violations.push({ file: rel, ...f });
    }

    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
