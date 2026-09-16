#!/usr/bin/env bun
/**
 * Guard: escape-hatch declarations for the cross-tenant/system-identity
 * surface (ctx.db.raw / ctx.systemDb.unsafeRaw / ctx.queryAs|writeAs(system)).
 *
 *   R1 raw-outside-system-scope: a TenantDb `.raw` escape used outside a
 *      `r.systemScope()` feature.
 *   R2 unsafe-raw-outside-system-scope: `ctx.systemDb.unsafeRaw(...)` outside
 *      systemScope, a job scope, an explicit `withUnsafeRawGrant(...)`, a
 *      handler/hook that lexically declares `escapeHatch`, or a standalone
 *      function whose direct body declares `declareEscapeHatch({ reason: "..." })`.
 *   R3 system-identity-outside-declared-scope: `queryAs`/`writeAs` called
 *      with a system identity outside systemScope, `.job.ts`, an `r.job(...)`
 *      call, a `*Job` function, a handler/hook that lexically declares
 *      `escapeHatch`, or a standalone function whose direct body declares
 *      `declareEscapeHatch({ reason: "..." })`.
 *   R4 generic-reason: `acknowledgeCrossTenant`/`unsafeRaw`, a declared
 *      `escapeHatch: { reason }`/`unsafeAllTenants: { reason }`, or a
 *      `declareEscapeHatch({ reason })` call, given a placeholder reason
 *      literal — hard-fails everywhere, not baselined.
 *   R5 unsafe-all-tenants-outside-declared-scope: an `unsafeAllTenants: true`
 *      or `unsafeAllTenants: { reason: "..." }` option, passed directly as a
 *      call argument, outside systemScope, `.job.ts`, an `r.job(...)` call,
 *      a `*Job` function, or a scope that already declares `escapeHatch`.
 *
 * escapeHatch (R2/R3) is recognized only as a direct, literal `escapeHatch`
 * property (object literal, or ternary of two object literals) either in the
 * same object literal as any inline function property (ArrowFunction or
 * FunctionExpression, under any key name — e.g. `handler`, `export`,
 * `delete`), or in an options object passed to
 * `r.hook`/`writeHandler`/`queryHandler`/`streamHandler`/`useExtension`
 * alongside the handler function argument. A standalone function (arrow
 * function, function expression, method declaration, or function
 * declaration) is additionally recognized when a statement in its own direct
 * body — not a nested function's, not inside an `if` — calls the bare
 * identifier `declareEscapeHatch` with exactly one object-literal argument
 * carrying a literal, non-placeholder `reason` (from
 * `@cosmicdrift/kumiko-framework/engine`'s `declareEscapeHatch`: a helper
 * that escalates on a `HandlerContext` handed to it by its caller, rather
 * than a `HandlerContext` from its own registration). The declaration does
 * not propagate upward: it covers escalations inside that function's own
 * body, not the function it is nested inside. This detection is purely
 * lexical — the guard matches on the name `declareEscapeHatch`, not on where
 * it was imported from, so a same-named local function clears just as well;
 * consistent with `escapeHatch:` itself, which is likewise never checked for
 * origin. Referenced-by-variable functions, spread options, computed/string
 * keys, and non-literal escapeHatch/reason values are conservatively not
 * recognized (miss, don't falsely clear).
 *
 * Empty reasons, `openToAll.personalData` and PII are the framework boot validator's
 * job (access-declarations.ts), not this guard's — except a `declareEscapeHatch`
 * reason, which has no boot validator behind it: an empty or placeholder
 * reason there is never recognized as a valid declaration (see R4). Known
 * false-negatives: multi-hop aliasing, `ctx["db"]` through an intermediate
 * variable, and a TenantDb/system-identity handed to another function across
 * file boundaries with no `declareEscapeHatch` call at the escalation site
 * (declarable now, so no longer a blanket false-negative) — all conservative
 * (miss, don't falsely flag). R5 additionally misses `unsafeAllTenants`
 * given via an identifier, a ternary, `false`, or `undefined`, and an
 * options object passed by variable reference or spread rather than as a
 * literal call argument — all conservative (miss, don't falsely flag).
 *
 * Usage:
 *   bun guards/guard-escape-hatch-declared.ts
 *   Baseline: bun guards/run-guards.ts --write-security-baseline
 */
import * as path from "node:path";
import {
  type Node,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
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
    if (isAllowedEscapeHatchCall(call, sf, systemDirs) || isExplicitUnsafeRawGrant(call)) continue;
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

function isExplicitUnsafeRawGrant(call: Node): boolean {
  if (!call.isKind(SyntaxKind.CallExpression)) return false;
  const expr = call.getExpression();
  if (!expr.isKind(SyntaxKind.PropertyAccessExpression) || expr.getName() !== "unsafeRaw") {
    return false;
  }
  const receiver = expr.getExpression();
  return (
    receiver.isKind(SyntaxKind.CallExpression) &&
    receiver.getExpression().getText() === "withUnsafeRawGrant"
  );
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

const ESCAPE_HATCH_CALL_METHODS = new Set([
  "hook",
  "writeHandler",
  "queryHandler",
  "streamHandler",
  "useExtension",
]);

function isEscapeHatchDeclaredFunction(fn: Node): boolean {
  const parent = fn.getParent();
  if (!parent) return false;

  if (fn.isKind(SyntaxKind.MethodDeclaration)) {
    return parent.isKind(SyntaxKind.ObjectLiteralExpression) && objectDeclaresEscapeHatch(parent);
  }

  if (!fn.isKind(SyntaxKind.ArrowFunction) && !fn.isKind(SyntaxKind.FunctionExpression)) {
    return false;
  }

  if (parent.isKind(SyntaxKind.PropertyAssignment)) {
    const obj = parent.getParent();
    return (
      parent.getInitializer() === fn &&
      obj.isKind(SyntaxKind.ObjectLiteralExpression) &&
      objectDeclaresEscapeHatch(obj)
    );
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

// The bare-identifier `reason` PropertyAssignment on an object literal —
// shared between the declareEscapeHatch statement check below and its R4
// generic-reason collector, so both agree on what counts as the reason.
function findReasonPropertyAssignment(obj: ObjectLiteralExpression): PropertyAssignment | undefined {
  return obj.getProperties().find(
    (prop): prop is PropertyAssignment =>
      prop.isKind(SyntaxKind.PropertyAssignment) &&
      prop.getNameNode().isKind(SyntaxKind.Identifier) &&
      prop.getNameNode().getText() === "reason",
  );
}

// declareEscapeHatch({ reason: "..." }) as a direct-body statement of a
// standalone function. No boot validator backs this form (unlike the
// escapeHatch: {...} property, which access-declarations.ts checks at boot),
// so an empty/placeholder reason is rejected here rather than left to it.
function isValidDeclareEscapeHatchCall(stmt: Node): boolean {
  if (!stmt.isKind(SyntaxKind.ExpressionStatement)) return false;
  const expr = stmt.getExpression();
  if (!expr.isKind(SyntaxKind.CallExpression)) return false;
  const callee = expr.getExpression();
  if (!callee.isKind(SyntaxKind.Identifier) || callee.getText() !== "declareEscapeHatch") {
    return false;
  }
  const args = expr.getArguments();
  const arg = args[0];
  if (args.length !== 1 || !arg?.isKind(SyntaxKind.ObjectLiteralExpression)) return false;
  const reasonProp = findReasonPropertyAssignment(arg);
  if (!reasonProp) return false;
  const reasonText = literalReasonText(reasonProp.getInitializer());
  return reasonText !== undefined && !isGenericReason(reasonText);
}

// Only the function's own direct body — not a nested function's, not an
// `if`'s — so a declareEscapeHatch call does not cover the function it is
// itself nested inside (miss, don't falsely clear).
function hasDeclaredEscapeHatchStatement(fn: Node): boolean {
  let body: Node | undefined;
  if (
    fn.isKind(SyntaxKind.ArrowFunction) ||
    fn.isKind(SyntaxKind.FunctionExpression) ||
    fn.isKind(SyntaxKind.MethodDeclaration) ||
    fn.isKind(SyntaxKind.FunctionDeclaration)
  ) {
    body = fn.getBody();
  }
  if (!body?.isKind(SyntaxKind.Block)) return false;
  return body.getStatements().some((stmt) => isValidDeclareEscapeHatchCall(stmt));
}

function isInsideEscapeHatchDeclaredFunction(node: Node): boolean {
  let ancestor: Node | undefined = node.getParent();
  while (ancestor) {
    if (
      ancestor.isKind(SyntaxKind.ArrowFunction) ||
      ancestor.isKind(SyntaxKind.FunctionExpression) ||
      ancestor.isKind(SyntaxKind.MethodDeclaration) ||
      ancestor.isKind(SyntaxKind.FunctionDeclaration)
    ) {
      if (isEscapeHatchDeclaredFunction(ancestor) || hasDeclaredEscapeHatchStatement(ancestor)) {
        return true;
      }
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

// The declareEscapeHatch({ reason }) form falls through both existing R4
// collectors: its callee is a bare identifier, not a PropertyAccessExpression
// (unlike acknowledgeCrossTenant/unsafeRaw), and its reason sits directly in
// the call argument, not under an escapeHatch:/unsafeAllTenants: property.
function findGenericReasonDeclareEscapeHatchCalls(
  sf: SourceFile,
  root: string,
): GenericReasonFinding[] {
  const out: GenericReasonFinding[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    if (!callee.isKind(SyntaxKind.Identifier) || callee.getText() !== "declareEscapeHatch") {
      continue;
    }
    const arg = call.getArguments()[0];
    if (!arg?.isKind(SyntaxKind.ObjectLiteralExpression)) continue;
    const reasonProp = findReasonPropertyAssignment(arg);
    if (!reasonProp) continue;
    const reasonText = literalReasonText(reasonProp.getInitializer());
    if (reasonText === undefined || !isGenericReason(reasonText)) continue;
    out.push({
      file: path.relative(root, sf.getFilePath()),
      line: call.getStartLineNumber(),
      message: `declareEscapeHatch({ reason: "${reasonText}" }) uses a placeholder reason — give a concrete, reviewable justification for this cross-tenant/unsafe access.`,
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
    out.push(...findGenericReasonDeclareEscapeHatchCalls(sf, root));
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
    hint: 'Declare an escape hatch (r.systemScope() on the feature definition, .job.ts/r.job(...) for jobs, or { escapeHatch: { reason: "..." } } on the handler or hook), or remove the ctx.db.raw/unsafeRaw/queryAs|writeAs(system)/unsafeAllTenants access. Baseline after a deliberate reduction: `bun guards/run-guards.ts --write-security-baseline`',
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
