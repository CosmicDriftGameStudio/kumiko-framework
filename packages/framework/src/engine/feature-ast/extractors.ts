// Per-pattern extractors — read the arguments of an `r.<method>(...)`
// call and produce the matching FeaturePattern. Each extractor is a
// pure function on (CallExpression, SourceFile) and either returns a
// pattern or a ParseError describing why the arguments could not be
// read statically.
//
// **Implementation order (C1.5):**
//   - Round 1 (this file's first slice): the simplest static patterns —
//     requires, optionalRequires, readsConfig, systemScope, toggleable.
//   - Round 2: object-literal-based statics — entity, relation, nav,
//     workspace.
//   - Round 3: complex statics — config, translations, metric, secret,
//     claimKey, referenceData, useExtension.
//   - Round 4: mixed (header + body) — screen, writeHandler,
//     queryHandler, hook, entityHook, job, notification, httpRoute,
//     defineEvent, eventMigration, projection, multiStreamProjection.
//   - Round 5: opaque — authClaims, extendsRegistrar.
//
// Until a pattern's extractor lands, the dispatcher in parse.ts falls
// back to UnknownPattern with the right method name. That's why the
// dispatcher's switch lists all method names — the catch-all default
// is reserved for r.* calls we have no pattern type for at all.

import type { CallExpression, Node, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";

import type {
  OptionalRequiresPattern,
  ReadsConfigPattern,
  RequiresPattern,
  SystemScopePattern,
  ToggleablePattern,
} from "./patterns";
import type { ParseError } from "./parse";
import { sourceLocationFromNode } from "./source-location";

// =============================================================================
// Result helpers — every extractor returns ExtractOutput so the
// dispatcher can route patterns vs errors uniformly.
// =============================================================================

export type ExtractOutput<TPattern> =
  | { readonly kind: "pattern"; readonly pattern: TPattern }
  | { readonly kind: "error"; readonly error: ParseError };

function ok<TPattern>(pattern: TPattern): ExtractOutput<TPattern> {
  return { kind: "pattern", pattern };
}

function fail(methodName: string, source: ParseError["source"], reason: string): ExtractOutput<never> {
  return { kind: "error", error: { methodName, source, reason } };
}

// =============================================================================
// Argument readers — small primitives reused across extractors.
// =============================================================================

/**
 * Read a list of arguments where every entry must be a string literal.
 * Returns the list of literal values or undefined when any argument is
 * not a literal (e.g. spread of a const, identifier).
 */
function readStringLiteralArgs(call: CallExpression): readonly string[] | undefined {
  const out: string[] = [];
  for (const arg of call.getArguments()) {
    const literal = arg.asKind(SyntaxKind.StringLiteral);
    if (!literal) return undefined;
    out.push(literal.getLiteralValue());
  }
  return out;
}

/**
 * Read a property from an object-literal node by name and return the
 * boolean literal it points at. Returns undefined when the property is
 * missing or not a `true`/`false` literal.
 */
function readBooleanProperty(objectLiteral: Node, propertyName: string): boolean | undefined {
  const obj = objectLiteral.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj) return undefined;
  const prop = obj.getProperty(propertyName);
  if (!prop) return undefined;
  const assignment = prop.asKind(SyntaxKind.PropertyAssignment);
  if (!assignment) return undefined;
  const initializer = assignment.getInitializer();
  if (!initializer) return undefined;
  const kind = initializer.getKind();
  if (kind === SyntaxKind.TrueKeyword) return true;
  if (kind === SyntaxKind.FalseKeyword) return false;
  return undefined;
}

// =============================================================================
// Round 1 — simplest static patterns
// =============================================================================

export function extractRequires(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<RequiresPattern> {
  const names = readStringLiteralArgs(call);
  if (!names) {
    return fail(
      "requires",
      sourceLocationFromNode(call, sourceFile),
      "every argument must be a string literal",
    );
  }
  return ok({
    kind: "requires",
    source: sourceLocationFromNode(call, sourceFile),
    featureNames: names,
  });
}

export function extractOptionalRequires(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<OptionalRequiresPattern> {
  const names = readStringLiteralArgs(call);
  if (!names) {
    return fail(
      "optionalRequires",
      sourceLocationFromNode(call, sourceFile),
      "every argument must be a string literal",
    );
  }
  return ok({
    kind: "optionalRequires",
    source: sourceLocationFromNode(call, sourceFile),
    featureNames: names,
  });
}

export function extractReadsConfig(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ReadsConfigPattern> {
  const keys = readStringLiteralArgs(call);
  if (!keys) {
    return fail(
      "readsConfig",
      sourceLocationFromNode(call, sourceFile),
      "every argument must be a string literal",
    );
  }
  return ok({
    kind: "readsConfig",
    source: sourceLocationFromNode(call, sourceFile),
    qualifiedKeys: keys,
  });
}

export function extractSystemScope(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<SystemScopePattern> {
  // r.systemScope() takes no arguments. We don't fail when extras are
  // present — the runtime ignores them, and the Designer doesn't lose
  // anything by dropping them.
  return ok({
    kind: "systemScope",
    source: sourceLocationFromNode(call, sourceFile),
  });
}

export function extractToggleable(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ToggleablePattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "toggleable",
      sourceLocationFromNode(call, sourceFile),
      "expected an object argument with a `default` boolean",
    );
  }
  const defaultValue = readBooleanProperty(arg, "default");
  if (defaultValue === undefined) {
    return fail(
      "toggleable",
      sourceLocationFromNode(call, sourceFile),
      "argument must be `{ default: true | false }`",
    );
  }
  return ok({
    kind: "toggleable",
    source: sourceLocationFromNode(call, sourceFile),
    default: defaultValue,
  });
}
