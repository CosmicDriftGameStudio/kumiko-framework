#!/usr/bin/env bun
/**
 * Guard: escape-hatch declarations for the cross-tenant/system-identity
 * surface (ctx.db.raw / ctx.systemDb.unsafeRaw / ctx.queryAs|writeAs(system)).
 *
 *   R1 raw-outside-system-scope: a TenantDb `.raw` escape used outside a
 *      `r.systemScope()` feature.
 *   R2 unsafe-raw-outside-system-scope: `ctx.systemDb.unsafeRaw(...)` outside
 *      systemScope and outside a handler/hook that lexically declares
 *      `escapeHatch`.
 *   R3 system-identity-outside-declared-scope: `queryAs`/`writeAs` called
 *      with a system identity outside systemScope, `.job.ts`, an `r.job(...)`
 *      call, a `*Job` function, or a handler/hook that lexically declares
 *      `escapeHatch`.
 *   R4 generic-reason: `acknowledgeCrossTenant`/`unsafeRaw`, or a declared
 *      `escapeHatch: { reason }`/`unsafeAllTenants: { reason }`, given a
 *      placeholder reason literal — hard-fails everywhere, not baselined.
 *   R5 unsafe-all-tenants-outside-declared-scope: an `unsafeAllTenants: true`
 *      or `unsafeAllTenants: { reason: "..." }` option, passed directly as a
 *      call argument, outside systemScope, `.job.ts`, an `r.job(...)` call,
 *      a `*Job` function, or a scope that already declares `escapeHatch`.
 *
 * escapeHatch (R2/R3) is recognized only as a direct, literal `escapeHatch`
 * property (object literal, or ternary of two object literals) either in the
 * same object literal as an inline `handler` function, in an options object
 * passed to `r.hook`/`writeHandler`/`queryHandler`/`streamHandler` alongside
 * the handler function argument, or in the options object passed directly to
 * `r.useExtension(...)` alongside any of its hook function properties
 * (`export`, `forget`, ...) — the grant covers every hook in that one options
 * object, matching the runtime per-usage scope. Referenced-by-variable
 * functions, spread options, computed/string keys, and non-literal
 * escapeHatch values are conservatively not recognized (miss, don't falsely
 * clear).
 *
 * Empty reasons, `openToAll.personalData` and PII are the framework boot validator's
 * job (access-declarations.ts), not this guard's. Known false-negatives:
 * multi-hop aliasing, `ctx["db"]` through an intermediate variable, and a
 * TenantDb/system-identity handed to another function across file
 * boundaries — all conservative (miss, don't falsely flag). R5 additionally
 * misses `unsafeAllTenants` given via an identifier, a ternary, `false`, or
 * `undefined`, and an options object passed by variable reference or spread
 * rather than as a literal call argument — all conservative (miss, don't
 * falsely flag).
 *
 * Usage:
 *   bun guards/guard-escape-hatch-declared.ts
 *   Baseline: bun guards/run-guards.ts --write-security-baseline
 */
import * as path from "node:path";
import { type Node, type ObjectLiteralExpression, type SourceFile, SyntaxKind } from "ts-morph";
import { isGenericReason, literalReasonText } from "./_lib/generic-reason";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};
const EXCLUDE = /(__tests__\/|\.test\.tsx?$|\.d\.ts$)/;

const DB_RECEIVER_NAMES = new Set(["db", "dbOutsideTransaction"]);
const SYSTEM_IDENTITY_RE = /^(SYSTEM(_[A-Z0-9_]+)?|system(User|Actor)?)$/;
const CTX_IDENTIFIER_NAMES = new Set(["ctx", "context", "handlerCtx", "handlerContext"]);

export type EscapeHatchFinding = {
  file: string;
  line: number;
  rule:
    | "raw-outside-system-scope"
    | "unsafe-raw-outside-system-scope"
    | "system-identity-outside-declared-scope"
    | "unsafe-all-tenants-outside-declared-scope";
  message: string;
};

export type GenericReasonFinding = {
  file: string;
  line: number;
  message: string;
};

function scannableFiles(files: readonly SourceFile[]): SourceFile[] {
  return files.filter((sf) => !EXCLUDE.test(sf.getFilePath()));
}

export function systemScopeDirs(files: readonly SourceFile[]): string[] {
  const dirs: string[] = [];
  for (const sf of scannableFiles(files)) {
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (
        expr.isKind(SyntaxKind.PropertyAccessExpression) &&
        expr.getName() === "systemScope" &&
        call.getArguments().length === 0
      ) {
        dirs.push(path.dirname(sf.getFilePath()));
        break;
      }
    }
  }
  return dirs;
}

function isInSystemScope(filePath: string, dirs: readonly string[]): boolean {
  return dirs.some((dir) => filePath.startsWith(`${dir}/`));
}

function isDirectTenantDbAccess(node: Node): boolean {
  if (node.isKind(SyntaxKind.PropertyAccessExpression)) {
    return DB_RECEIVER_NAMES.has(node.getName());
  }
  if (node.isKind(SyntaxKind.ElementAccessExpression)) {
    const arg = node.getArgumentExpression();
    if (arg?.isKind(SyntaxKind.StringLiteral)) {
      return DB_RECEIVER_NAMES.has(arg.getLiteralValue());
    }
  }
  return false;
}

function isTenantDbExpression(node: Node): boolean {
  if (isDirectTenantDbAccess(node)) return true;
  if (!node.isKind(SyntaxKind.Identifier)) return false;
  const decls = node.getSymbol()?.getDeclarations() ?? [];
  for (const decl of decls) {
    if (decl.isKind(SyntaxKind.VariableDeclaration)) {
      if (decl.getTypeNode()?.getText() === "TenantDb") return true;
      const init = decl.getInitializer();
      if (init && isDirectTenantDbAccess(init)) return true;
    } else if (decl.isKind(SyntaxKind.BindingElement)) {
      const propName = decl.getPropertyNameNode()?.getText() ?? decl.getName();
      if (!DB_RECEIVER_NAMES.has(propName)) continue;
      // Only `const { db } = ctx` — parameter destructuring (`({ db }) =>`)
      // stays a deliberate false-negative, not worth the ambiguity.
      const owner = decl.getParent()?.getParent();
      const init = owner?.isKind(SyntaxKind.VariableDeclaration)
        ? owner.getInitializer()
        : undefined;
      if (init?.isKind(SyntaxKind.Identifier) && CTX_IDENTIFIER_NAMES.has(init.getText())) {
        return true;
      }
    } else if (decl.isKind(SyntaxKind.Parameter)) {
      if (decl.getTypeNode()?.getText() === "TenantDb") return true;
    }
  }
  return false;
}

function findRawFindings(
  sf: SourceFile,
  root: string,
  systemDirs: readonly string[],
): EscapeHatchFinding[] {
  if (isInSystemScope(sf.getFilePath(), systemDirs)) return [];
  const out: EscapeHatchFinding[] = [];
  for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (pa.getName() !== "raw") continue;
    if (!isTenantDbExpression(pa.getExpression())) continue;
    out.push({
      file: path.relative(root, sf.getFilePath()),
      line: pa.getStartLineNumber(),
      rule: "raw-outside-system-scope",
      message:
        "ctx.db.raw used outside a systemScope feature — a tenant-scoped raw escape needs a systemScope feature, or route the actual query through the framework's tenant filtering.",
    });
  }
  return out;
}

function findUnsafeRawFindings(
  sf: SourceFile,
  root: string,
  systemDirs: readonly string[],
): EscapeHatchFinding[] {
  if (isInSystemScope(sf.getFilePath(), systemDirs)) return [];
  const out: EscapeHatchFinding[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) continue;
    if (expr.getName() !== "unsafeRaw") continue;
    if (isInsideEscapeHatchDeclaredFunction(call)) continue;
    out.push({
      file: path.relative(root, sf.getFilePath()),
      line: call.getStartLineNumber(),
      rule: "unsafe-raw-outside-system-scope",
      message:
        'unsafeRaw(...) used outside a systemScope feature and outside a handler/hook declaring escapeHatch — declare { escapeHatch: { reason: "..." } } on the handler or hook, declare the feature systemScope, or use ctx.systemDb.acknowledgeCrossTenant(reason) for a scoped read.',
    });
  }
  return out;
}

function isSystemIdentityExpression(node: Node): boolean {
  if (node.isKind(SyntaxKind.CallExpression)) {
    const calleeText = node.getExpression().getText();
    return calleeText.endsWith("createSystemUser") || calleeText.endsWith("systemUserOf");
  }
  if (!node.isKind(SyntaxKind.Identifier)) return false;
  if (SYSTEM_IDENTITY_RE.test(node.getText())) return true;
  const decls = node.getSymbol()?.getDeclarations() ?? [];
  for (const decl of decls) {
    if (!decl.isKind(SyntaxKind.VariableDeclaration)) continue;
    const init = decl.getInitializer();
    if (init && isSystemIdentityExpression(init)) return true;
  }
  return false;
}

function hasJobScopeAncestor(call: Node): boolean {
  let ancestor: Node | undefined = call.getParent();
  while (ancestor) {
    if (ancestor.isKind(SyntaxKind.CallExpression)) {
      const calleeExpr = ancestor.getExpression();
      if (
        calleeExpr.isKind(SyntaxKind.PropertyAccessExpression) &&
        calleeExpr.getName() === "job"
      ) {
        return true;
      }
    }
    if (
      ancestor.isKind(SyntaxKind.FunctionDeclaration) ||
      ancestor.isKind(SyntaxKind.MethodDeclaration)
    ) {
      if (ancestor.getName()?.endsWith("Job")) return true;
    }
    if (ancestor.isKind(SyntaxKind.ArrowFunction)) {
      const parent = ancestor.getParent();
      if (parent?.isKind(SyntaxKind.VariableDeclaration) && parent.getName().endsWith("Job")) {
        return true;
      }
    }
    ancestor = ancestor.getParent();
  }
  return false;
}

function unwrapParenthesized(node: Node): Node {
  let current = node;
  while (current.isKind(SyntaxKind.ParenthesizedExpression)) {
    current = current.getExpression();
  }
  return current;
}

function isEscapeHatchDeclarationValue(node: Node | undefined): boolean {
  if (!node) return false;
  const value = unwrapParenthesized(node);
  if (value.isKind(SyntaxKind.ObjectLiteralExpression)) return true;
  if (value.isKind(SyntaxKind.ConditionalExpression)) {
    const whenTrue = unwrapParenthesized(value.getWhenTrue());
    const whenFalse = unwrapParenthesized(value.getWhenFalse());
    return (
      whenTrue.isKind(SyntaxKind.ObjectLiteralExpression) &&
      whenFalse.isKind(SyntaxKind.ObjectLiteralExpression)
    );
  }
  return false;
}

function objectDeclaresEscapeHatch(obj: ObjectLiteralExpression): boolean {
  return obj.getProperties().some((prop) => {
    if (!prop.isKind(SyntaxKind.PropertyAssignment)) return false;
    const nameNode = prop.getNameNode();
    if (!nameNode.isKind(SyntaxKind.Identifier) || nameNode.getText() !== "escapeHatch") {
      return false;
    }
    return isEscapeHatchDeclarationValue(prop.getInitializer());
  });
}

function isUseExtensionOptionsArgument(obj: ObjectLiteralExpression): boolean {
  const call = obj.getParent();
  if (!call?.isKind(SyntaxKind.CallExpression)) return false;
  if (!call.getArguments().includes(obj)) return false;
  const callee = call.getExpression();
  return callee.isKind(SyntaxKind.PropertyAccessExpression) && callee.getName() === "useExtension";
}

const ESCAPE_HATCH_CALL_METHODS = new Set([
  "hook",
  "writeHandler",
  "queryHandler",
  "streamHandler",
]);

function isDeclaredExtensionOrHandlerProperty(fn: Node, parent: Node): boolean {
  if (!parent.isKind(SyntaxKind.PropertyAssignment)) return false;
  const nameNode = parent.getNameNode();
  const obj = parent.getParent();
  if (
    !nameNode.isKind(SyntaxKind.Identifier) ||
    parent.getInitializer() !== fn ||
    !obj.isKind(SyntaxKind.ObjectLiteralExpression) ||
    !objectDeclaresEscapeHatch(obj)
  ) {
    return false;
  }
  return nameNode.getText() === "handler" || isUseExtensionOptionsArgument(obj);
}

function isEscapeHatchDeclaredFunction(fn: Node): boolean {
  const parent = fn.getParent();
  if (!parent) return false;

  if (fn.isKind(SyntaxKind.MethodDeclaration)) {
    const nameNode = fn.getNameNode();
    return (
      nameNode.isKind(SyntaxKind.Identifier) &&
      nameNode.getText() === "handler" &&
      parent.isKind(SyntaxKind.ObjectLiteralExpression) &&
      objectDeclaresEscapeHatch(parent)
    );
  }

  if (!fn.isKind(SyntaxKind.ArrowFunction) && !fn.isKind(SyntaxKind.FunctionExpression)) {
    return false;
  }

  if (parent.isKind(SyntaxKind.PropertyAssignment)) {
    return isDeclaredExtensionOrHandlerProperty(fn, parent);
  }

  if (parent.isKind(SyntaxKind.CallExpression)) {
    const args = parent.getArguments();
    if (!args.includes(fn)) return false;
    const callee = parent.getExpression();
    if (
      !callee.isKind(SyntaxKind.PropertyAccessExpression) ||
      !ESCAPE_HATCH_CALL_METHODS.has(callee.getName())
    ) {
      return false;
    }
    return args.some(
      (arg) =>
        arg !== fn &&
        arg.isKind(SyntaxKind.ObjectLiteralExpression) &&
        objectDeclaresEscapeHatch(arg),
    );
  }

  return false;
}

function isInsideEscapeHatchDeclaredFunction(node: Node): boolean {
  let ancestor: Node | undefined = node.getParent();
  while (ancestor) {
    if (
      ancestor.isKind(SyntaxKind.ArrowFunction) ||
      ancestor.isKind(SyntaxKind.FunctionExpression) ||
      ancestor.isKind(SyntaxKind.MethodDeclaration)
    ) {
      if (isEscapeHatchDeclaredFunction(ancestor)) return true;
    }
    ancestor = ancestor.getParent();
  }
  return false;
}

function isAllowedEscapeHatchCall(
  call: Node,
  sf: SourceFile,
  systemDirs: readonly string[],
): boolean {
  const filePath = sf.getFilePath();
  if (isInSystemScope(filePath, systemDirs)) return true;
  if (filePath.endsWith(".job.ts")) return true;
  return hasJobScopeAncestor(call) || isInsideEscapeHatchDeclaredFunction(call);
}

function findSystemIdentityFindings(
  sf: SourceFile,
  root: string,
  systemDirs: readonly string[],
): EscapeHatchFinding[] {
  const out: EscapeHatchFinding[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) continue;
    const methodName = expr.getName();
    if (methodName !== "queryAs" && methodName !== "writeAs") continue;
    const firstArg = call.getArguments()[0];
    if (!firstArg || !isSystemIdentityExpression(firstArg)) continue;
    if (isAllowedEscapeHatchCall(call, sf, systemDirs)) continue;
    out.push({
      file: path.relative(root, sf.getFilePath()),
      line: call.getStartLineNumber(),
      rule: "system-identity-outside-declared-scope",
      message: `${methodName}(...) called with a system identity outside a declared scope — restrict to a systemScope feature, a .job.ts / r.job(...) job, or declare { escapeHatch: { reason: "..." } } on the handler or hook.`,
    });
  }
  return out;
}

function isUnsafeAllTenantsDeclarationValue(node: Node): boolean {
  if (node.isKind(SyntaxKind.TrueKeyword)) return true;
  return node.isKind(SyntaxKind.ObjectLiteralExpression);
}

function findUnsafeAllTenantsFindings(
  sf: SourceFile,
  root: string,
  systemDirs: readonly string[],
): EscapeHatchFinding[] {
  const out: EscapeHatchFinding[] = [];
  for (const prop of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    const nameNode = prop.getNameNode();
    if (!nameNode.isKind(SyntaxKind.Identifier) || nameNode.getText() !== "unsafeAllTenants") {
      continue;
    }
    const initializer = prop.getInitializer();
    if (!initializer) continue;
    const value = unwrapParenthesized(initializer);
    if (!isUnsafeAllTenantsDeclarationValue(value)) continue;
    const obj = prop.getParent();
    if (!obj.isKind(SyntaxKind.ObjectLiteralExpression)) continue;
    const call = obj.getParent();
    if (!call?.isKind(SyntaxKind.CallExpression)) continue;
    if (!call.getArguments().includes(obj)) continue;
    if (objectDeclaresEscapeHatch(obj)) continue;
    if (isAllowedEscapeHatchCall(call, sf, systemDirs)) continue;
    out.push({
      file: path.relative(root, sf.getFilePath()),
      line: prop.getStartLineNumber(),
      rule: "unsafe-all-tenants-outside-declared-scope",
      message:
        'unsafeAllTenants used outside a declared scope — restrict to a systemScope feature, a .job.ts / r.job(...) job, or declare { escapeHatch: { reason: "..." } } alongside it.',
    });
  }
  return out;
}

export function findEscapeHatchFindings(
  files: readonly SourceFile[],
  root: string,
): EscapeHatchFinding[] {
  const systemDirs = systemScopeDirs(files);
  const out: EscapeHatchFinding[] = [];
  for (const sf of scannableFiles(files)) {
    out.push(...findRawFindings(sf, root, systemDirs));
    out.push(...findUnsafeRawFindings(sf, root, systemDirs));
    out.push(...findSystemIdentityFindings(sf, root, systemDirs));
    out.push(...findUnsafeAllTenantsFindings(sf, root, systemDirs));
  }
  return out;
}

const GENERIC_REASON_METHODS = new Set(["acknowledgeCrossTenant", "unsafeRaw"]);

function findGenericReasonMethodCalls(sf: SourceFile, root: string): GenericReasonFinding[] {
  const out: GenericReasonFinding[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) continue;
    const methodName = expr.getName();
    if (!GENERIC_REASON_METHODS.has(methodName)) continue;
    const reasonText = literalReasonText(call.getArguments()[0]);
    if (reasonText === undefined || !isGenericReason(reasonText)) continue;
    out.push({
      file: path.relative(root, sf.getFilePath()),
      line: call.getStartLineNumber(),
      message: `${methodName}("${reasonText}") uses a placeholder reason — give a concrete, reviewable justification for this cross-tenant/unsafe access.`,
    });
  }
  return out;
}

const REASON_OBJECT_PROPERTY_NAMES = ["escapeHatch", "unsafeAllTenants"] as const;

function findGenericReasonObjectProperty(
  sf: SourceFile,
  root: string,
  propertyName: string,
): GenericReasonFinding[] {
  const out: GenericReasonFinding[] = [];
  for (const pa of sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
    if (pa.getName() !== propertyName) continue;
    const init = pa.getInitializer();
    if (!init?.isKind(SyntaxKind.ObjectLiteralExpression)) continue;
    const reasonProp = init.getProperty("reason");
    if (!reasonProp?.isKind(SyntaxKind.PropertyAssignment)) continue;
    const reasonText = literalReasonText(reasonProp.getInitializer());
    if (reasonText === undefined) continue;
    // Empty/whitespace is the boot validator's job — no double-check.
    if (reasonText.trim() === "") continue;
    if (!isGenericReason(reasonText)) continue;
    out.push({
      file: path.relative(root, sf.getFilePath()),
      line: pa.getStartLineNumber(),
      message: `${propertyName}: { reason: "${reasonText}" } uses a placeholder reason — give a concrete, reviewable justification for this cross-tenant/unsafe access.`,
    });
  }
  return out;
}

export function findGenericReasonCalls(
  files: readonly SourceFile[],
  root: string,
): GenericReasonFinding[] {
  const out: GenericReasonFinding[] = [];
  for (const sf of scannableFiles(files)) {
    out.push(...findGenericReasonMethodCalls(sf, root));
    for (const propertyName of REASON_OBJECT_PROPERTY_NAMES) {
      out.push(...findGenericReasonObjectProperty(sf, root, propertyName));
    }
  }
  return out;
}

export function createEscapeHatchGuard(opts: { root: string }): AstGuard {
  return {
    name: "Escape-Hatch-Declared Guard",
    scan: SCAN,
    security: true,
    hint: 'Escape-Hatch deklarieren (r.systemScope() auf der Feature-Definition, .job.ts/r.job(...) fuer Jobs, oder { escapeHatch: { reason: "..." } } auf dem Handler oder Hook) oder den ctx.db.raw/unsafeRaw/queryAs|writeAs(system)/unsafeAllTenants-Zugriff entfernen. Baseline nach bewusster Reduktion: `bun guards/run-guards.ts --write-security-baseline`',
    run(files) {
      const violations: GuardViolation[] = [
        ...findGenericReasonCalls(files, opts.root).map((f) => ({
          file: f.file,
          line: f.line,
          message: f.message,
          neverFrozen: true,
        })),
        ...findEscapeHatchFindings(files, opts.root).map((f) => ({
          file: f.file,
          line: f.line,
          message: f.message,
        })),
      ];
      return { violations };
    },
  };
}

export const guard = createEscapeHatchGuard({ root: process.cwd() });

if (import.meta.main) {
  runStandalone(guard);
}
