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

import type { EntityDefinition } from "../types/fields";
import type { NavDefinition } from "../types/nav";
import type { RelationDefinition } from "../types/relations";
import type { WorkspaceDefinition } from "../types/workspace";
import type { ParseError } from "./parse";
import type {
  EntityPattern,
  NavPattern,
  OptionalRequiresPattern,
  ReadsConfigPattern,
  RelationPattern,
  RequiresPattern,
  SystemScopePattern,
  ToggleablePattern,
  WorkspacePattern,
} from "./patterns";
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

function fail(
  methodName: string,
  source: ParseError["source"],
  reason: string,
): ExtractOutput<never> {
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

/**
 * Best-effort reader that turns a TypeScript expression into a JSON-like
 * value. Recurses through arrays, object literals, parenthesised
 * expressions, and `as`/`satisfies` wrappers. Returns undefined as
 * "could not read" — used as the failure signal because no legitimate
 * JSON value is undefined (we forbid `{ x: undefined }` shapes by
 * rejecting any unreadable property).
 *
 * Accepts: string / number (incl. negative literals) / boolean / null,
 * array literals, object literals (with PropertyAssignment props only),
 * `as const`, `as Type`, `satisfies Type`, parenthesised expressions.
 *
 * Rejects (returns undefined): identifiers, function calls, arrow
 * functions, template literals with substitutions, spread props,
 * shorthand props, methods, computed keys.
 */
function readJsonLikeNode(node: Node): unknown {
  const kind = node.getKind();
  switch (kind) {
    case SyntaxKind.StringLiteral:
      return node.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
    case SyntaxKind.NoSubstitutionTemplateLiteral:
      return node.asKindOrThrow(SyntaxKind.NoSubstitutionTemplateLiteral).getLiteralValue();
    case SyntaxKind.NumericLiteral:
      return Number(node.asKindOrThrow(SyntaxKind.NumericLiteral).getText());
    case SyntaxKind.TrueKeyword:
      return true;
    case SyntaxKind.FalseKeyword:
      return false;
    case SyntaxKind.NullKeyword:
      return null;
    case SyntaxKind.PrefixUnaryExpression: {
      // Negative number literals: -1, -2.5
      const expr = node.asKindOrThrow(SyntaxKind.PrefixUnaryExpression);
      if (expr.getOperatorToken() !== SyntaxKind.MinusToken) return undefined;
      const inner = readJsonLikeNode(expr.getOperand());
      if (typeof inner !== "number") return undefined;
      return -inner;
    }
    case SyntaxKind.ArrayLiteralExpression: {
      const arr = node.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
      const out: unknown[] = [];
      for (const el of arr.getElements()) {
        const value = readJsonLikeNode(el);
        if (value === undefined) return undefined;
        out.push(value);
      }
      return out;
    }
    case SyntaxKind.ObjectLiteralExpression: {
      const obj = node.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
      const out: Record<string, unknown> = {};
      for (const prop of obj.getProperties()) {
        const propAssign = prop.asKind(SyntaxKind.PropertyAssignment);
        if (!propAssign) return undefined; // shorthand / spread / method
        const initializer = propAssign.getInitializer();
        if (!initializer) return undefined;
        const value = readJsonLikeNode(initializer);
        if (value === undefined) return undefined;
        out[propAssign.getName()] = value;
      }
      return out;
    }
    case SyntaxKind.AsExpression:
      return readJsonLikeNode(node.asKindOrThrow(SyntaxKind.AsExpression).getExpression());
    case SyntaxKind.SatisfiesExpression:
      return readJsonLikeNode(node.asKindOrThrow(SyntaxKind.SatisfiesExpression).getExpression());
    case SyntaxKind.ParenthesizedExpression:
      return readJsonLikeNode(
        node.asKindOrThrow(SyntaxKind.ParenthesizedExpression).getExpression(),
      );
    default:
      return undefined;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read a NameOrRef argument: either a string literal or an inline
 * object literal `{ name: "..." }`. Identifier references (e.g. a
 * captured const) cannot be resolved statically and return undefined.
 */
function readNameOrRef(node: Node): string | undefined {
  const literal = node.asKind(SyntaxKind.StringLiteral);
  if (literal) return literal.getLiteralValue();
  const obj = readJsonLikeNode(node);
  if (isPlainObject(obj) && typeof obj["name"] === "string") return obj["name"];
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

// =============================================================================
// Round 2 — object-literal-based static patterns
//
// These read a definition object via readJsonLikeNode. The reader is
// best-effort: function-typed properties (e.g. EntityDefinition with a
// computed `default`) make the extractor fail with a ParseError that
// the Designer/AI surface as "this entity has custom code, can't edit".
// Plain-data shapes round-trip cleanly.
// =============================================================================

export function extractEntity(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<EntityPattern> {
  const args = call.getArguments();
  const nameArg = args[0]?.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "entity",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal name",
    );
  }
  const defArg = args[1];
  if (!defArg) {
    return fail(
      "entity",
      sourceLocationFromNode(call, sourceFile),
      "expected a definition object as second argument",
    );
  }
  const definition = readJsonLikeNode(defArg);
  if (!isPlainObject(definition)) {
    return fail(
      "entity",
      sourceLocationFromNode(call, sourceFile),
      "definition could not be read as a plain object (contains functions or identifiers)",
    );
  }
  return ok({
    kind: "entity",
    source: sourceLocationFromNode(call, sourceFile),
    entityName: nameArg.getLiteralValue(),
    // The reader produced a JSON-like object whose runtime shape comes
    // from source code that already type-checks against EntityDefinition.
    // Downstream consumers (Designer, validator) may re-validate before use.
    definition: definition as EntityDefinition,
  });
}

export function extractRelation(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<RelationPattern> {
  const args = call.getArguments();
  const entityRefArg = args[0];
  if (!entityRefArg) {
    return fail(
      "relation",
      sourceLocationFromNode(call, sourceFile),
      "expected an entity reference as first argument",
    );
  }
  const entityName = readNameOrRef(entityRefArg);
  if (!entityName) {
    return fail(
      "relation",
      sourceLocationFromNode(call, sourceFile),
      'first argument must be a string literal or an inline { name: "..." } object',
    );
  }
  const nameArg = args[1]?.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "relation",
      sourceLocationFromNode(call, sourceFile),
      "second argument must be a string literal relation name",
    );
  }
  const defArg = args[2];
  if (!defArg) {
    return fail(
      "relation",
      sourceLocationFromNode(call, sourceFile),
      "expected a definition object as third argument",
    );
  }
  const definition = readJsonLikeNode(defArg);
  if (!isPlainObject(definition)) {
    return fail(
      "relation",
      sourceLocationFromNode(call, sourceFile),
      "definition could not be read as a plain object",
    );
  }
  return ok({
    kind: "relation",
    source: sourceLocationFromNode(call, sourceFile),
    entityName,
    relationName: nameArg.getLiteralValue(),
    definition: definition as RelationDefinition,
  });
}

export function extractNav(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<NavPattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "nav",
      sourceLocationFromNode(call, sourceFile),
      "expected a NavDefinition object as first argument",
    );
  }
  const definition = readJsonLikeNode(arg);
  if (!isPlainObject(definition)) {
    return fail(
      "nav",
      sourceLocationFromNode(call, sourceFile),
      "definition could not be read as a plain object",
    );
  }
  return ok({
    kind: "nav",
    source: sourceLocationFromNode(call, sourceFile),
    definition: definition as NavDefinition,
  });
}

export function extractWorkspace(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<WorkspacePattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "workspace",
      sourceLocationFromNode(call, sourceFile),
      "expected a WorkspaceDefinition object as first argument",
    );
  }
  const definition = readJsonLikeNode(arg);
  if (!isPlainObject(definition)) {
    return fail(
      "workspace",
      sourceLocationFromNode(call, sourceFile),
      "definition could not be read as a plain object",
    );
  }
  return ok({
    kind: "workspace",
    source: sourceLocationFromNode(call, sourceFile),
    definition: definition as WorkspaceDefinition,
  });
}
