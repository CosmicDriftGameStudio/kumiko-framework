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
import type { LifecycleHookType } from "../constants";
import type {
  ConfigKeyDefinition,
  ConfigKeyType,
  JobDefinition,
  RunIn,
  TranslationKeys,
} from "../types/config";
import type { MetricOptions, SecretOptions } from "../types/feature";
import type { EntityDefinition } from "../types/fields";
import type { AccessRule, ClaimKeyType, RateLimitOption } from "../types/handlers";
import type { HookPhase } from "../types/hooks";
import type { HttpRouteMethod } from "../types/http-route";
import type { NavDefinition } from "../types/nav";
import type { MspErrorMode } from "../types/projection";
import type { RelationDefinition } from "../types/relations";
import type { ScreenDefinition } from "../types/screen";
import type { WorkspaceDefinition } from "../types/workspace";
import type { ParseError } from "./parse";
import type {
  AuthClaimsPattern,
  ClaimKeyPattern,
  ConfigPattern,
  DefineEventPattern,
  EntityHookPattern,
  EntityPattern,
  EventMigrationPattern,
  ExtendsRegistrarPattern,
  HookPattern,
  HttpRoutePattern,
  JobPattern,
  MetricPattern,
  MultiStreamProjectionPattern,
  NavPattern,
  NotificationPattern,
  OpaquePropMap,
  OptionalRequiresPattern,
  ProjectionPattern,
  QueryHandlerPattern,
  ReadsConfigPattern,
  ReferenceDataPattern,
  RelationPattern,
  RequiresPattern,
  ScreenPattern,
  SecretPattern,
  SystemScopePattern,
  ToggleablePattern,
  TranslationsPattern,
  UseExtensionPattern,
  WorkspacePattern,
  WriteHandlerPattern,
} from "./patterns";
import { SCREEN_OPAQUE_MARKER } from "./patterns";
import type { SourceLocation } from "./source-location";
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

// Narrow return type lets fail() flow through both ExtractOutput<T> (where
// the error variant is always valid) and through helpers like
// readNamedOptions that expose the error-half directly to their callers.
function fail(
  methodName: string,
  source: ParseError["source"],
  reason: string,
): { readonly kind: "error"; readonly error: ParseError } {
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
function readDataLiteralNode(node: Node): unknown {
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
      const inner = readDataLiteralNode(expr.getOperand());
      if (typeof inner !== "number") return undefined;
      return -inner;
    }
    case SyntaxKind.ArrayLiteralExpression: {
      const arr = node.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
      const out: unknown[] = [];
      for (const el of arr.getElements()) {
        const value = readDataLiteralNode(el);
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
        const value = readDataLiteralNode(initializer);
        if (value === undefined) return undefined;
        out[readPropertyKey(propAssign)] = value;
      }
      return out;
    }
    case SyntaxKind.AsExpression:
      return readDataLiteralNode(node.asKindOrThrow(SyntaxKind.AsExpression).getExpression());
    case SyntaxKind.SatisfiesExpression:
      return readDataLiteralNode(
        node.asKindOrThrow(SyntaxKind.SatisfiesExpression).getExpression(),
      );
    case SyntaxKind.ParenthesizedExpression:
      return readDataLiteralNode(
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
 * Read a PropertyAssignment's key as the unquoted string. ts-morph's
 * getName() returns the source text including quote chars for keys like
 * `"task.created"`; we strip them so consumers see the same literal
 * value whether the author used identifier or string-key form.
 */
function readPropertyKey(propAssign: import("ts-morph").PropertyAssignment): string {
  const nameNode = propAssign.getNameNode();
  const literal = nameNode.asKind(SyntaxKind.StringLiteral);
  if (literal) return literal.getLiteralValue();
  return propAssign.getName();
}

/**
 * Read a NameOrRef argument: either a string literal or an inline
 * object literal `{ name: "..." }`. Identifier references (e.g. a
 * captured const) cannot be resolved statically and return undefined.
 */
function readNameOrRef(node: Node): string | undefined {
  const literal = node.asKind(SyntaxKind.StringLiteral);
  if (literal) return literal.getLiteralValue();
  const obj = readDataLiteralNode(node);
  if (isPlainObject(obj) && typeof obj["name"] === "string") return obj["name"];
  return undefined;
}

/**
 * Match a node that looks like a function literal — arrow function,
 * function expression, or one of those wrapped in parentheses. Returns
 * undefined for identifiers / call expressions / other shapes (a hook
 * registered by passing a const reference, for example, won't be
 * resolved statically).
 */
function findFunctionLiteral(node: Node): Node | undefined {
  if (node.getKind() === SyntaxKind.ArrowFunction) return node;
  if (node.getKind() === SyntaxKind.FunctionExpression) return node;
  const paren = node.asKind(SyntaxKind.ParenthesizedExpression);
  if (paren) return findFunctionLiteral(paren.getExpression());
  return undefined;
}

/**
 * Read a NameOrRef argument or an array of them. Returns either the
 * single string or the list. undefined when neither shape matches.
 */
function readNameOrRefOrList(node: Node): string | readonly string[] | undefined {
  const single = readNameOrRef(node);
  if (single) return single;
  const arr = node.asKind(SyntaxKind.ArrayLiteralExpression);
  if (!arr) return undefined;
  const out: string[] = [];
  for (const el of arr.getElements()) {
    const name = readNameOrRef(el);
    if (!name) return undefined;
    out.push(name);
  }
  return out;
}

// =============================================================================
// Round 1 — simplest static patterns
// =============================================================================

// Reads either varargs string literals, or a single { features: string[] } /
// { keys: string[] } object — covers both the legacy positional form and
// the canonical Object-Form. `arrayPropName` controls which property name
// the object form uses (`features` for requires, `keys` for readsConfig).
function readVarargsOrArrayProp(
  call: CallExpression,
  arrayPropName: "features" | "keys",
): readonly string[] | undefined {
  const args = call.getArguments();
  // Object-Form: single object-literal arg with the named array property.
  if (args.length === 1) {
    const obj = args[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
    if (obj) {
      const propInit = obj
        .getProperty(arrayPropName)
        ?.asKind(SyntaxKind.PropertyAssignment)
        ?.getInitializer();
      if (propInit) {
        const arr = propInit.asKind(SyntaxKind.ArrayLiteralExpression);
        if (!arr) return undefined;
        const out: string[] = [];
        for (const el of arr.getElements()) {
          const lit = el.asKind(SyntaxKind.StringLiteral);
          if (!lit) return undefined;
          out.push(lit.getLiteralValue());
        }
        return out;
      }
    }
  }
  // Legacy positional form: every arg must be a string literal.
  return readStringLiteralArgs(call);
}

export function extractRequires(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<RequiresPattern> {
  const names = readVarargsOrArrayProp(call, "features");
  if (!names) {
    return fail(
      "requires",
      sourceLocationFromNode(call, sourceFile),
      "expected positional string literals or { features: string[] }",
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
  const names = readVarargsOrArrayProp(call, "features");
  if (!names) {
    return fail(
      "optionalRequires",
      sourceLocationFromNode(call, sourceFile),
      "expected positional string literals or { features: string[] }",
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
  const keys = readVarargsOrArrayProp(call, "keys");
  if (!keys) {
    return fail(
      "readsConfig",
      sourceLocationFromNode(call, sourceFile),
      "expected positional string literals or { keys: string[] }",
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
// These read a definition object via readDataLiteralNode. The reader is
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
  const first = args[0];
  if (!first) {
    return fail(
      "entity",
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  // Object-Form: r.entity({ name, fields, ...rest })
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const nameInit = obj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameInit) {
      return fail(
        "entity",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const definition = readDataLiteralNode(obj);
    if (!isPlainObject(definition)) {
      return fail(
        "entity",
        sourceLocationFromNode(call, sourceFile),
        "definition could not be read as a plain object (contains functions or identifiers)",
      );
    }
    // Strip the `name` property — it lives on EntityPattern.entityName.
    const { name: _name, ...defWithoutName } = definition;
    return ok({
      kind: "entity",
      source: sourceLocationFromNode(call, sourceFile),
      entityName: nameInit.getLiteralValue(),
      definition: defWithoutName as EntityDefinition,
    });
  }

  // Legacy positional form: r.entity("name", { fields, ... })
  const nameArg = first.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "entity",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal name (or use the object form)",
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
  const definition = readDataLiteralNode(defArg);
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
  const first = args[0];
  if (!first) {
    return fail(
      "relation",
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  // Object-Form: r.relation({ entity, name, kind, to, ...rest })
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const entityInit = obj
      .getProperty("entity")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!entityInit) {
      return fail(
        "relation",
        sourceLocationFromNode(call, sourceFile),
        "object form requires an `entity` property",
      );
    }
    const entityName = readNameOrRef(entityInit);
    if (!entityName) {
      return fail(
        "relation",
        sourceLocationFromNode(call, sourceFile),
        '`entity` must be a string literal or `{ name: "..." }` ref',
      );
    }
    const nameInit = obj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameInit) {
      return fail(
        "relation",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const definition = readDataLiteralNode(obj);
    if (!isPlainObject(definition)) {
      return fail(
        "relation",
        sourceLocationFromNode(call, sourceFile),
        "definition could not be read as a plain object",
      );
    }
    // Strip the carrier-properties — `entity` and `name` live separately
    // on the pattern, the rest stays in `definition`.
    const { entity: _e, name: _n, ...defWithoutCarriers } = definition;
    return ok({
      kind: "relation",
      source: sourceLocationFromNode(call, sourceFile),
      entityName,
      relationName: nameInit.getLiteralValue(),
      definition: defWithoutCarriers as RelationDefinition,
    });
  }

  // Legacy positional: r.relation(entity, name, def)
  const entityName = readNameOrRef(first);
  if (!entityName) {
    return fail(
      "relation",
      sourceLocationFromNode(call, sourceFile),
      'first argument must be a string literal or an inline { name: "..." } object (or use the object form)',
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
  const definition = readDataLiteralNode(defArg);
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
  const definition = readDataLiteralNode(arg);
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
  const definition = readDataLiteralNode(arg);
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

// =============================================================================
// Round 3 — complex static patterns
//
// Two-argument extractors (metric, secret, claimKey) take a string-literal
// short name plus an options object. The options-object extractors
// (config, translations) wrap a `keys` map. referenceData/useExtension
// take an entity reference plus payload.
// =============================================================================

export function extractConfig(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ConfigPattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "config",
      sourceLocationFromNode(call, sourceFile),
      "expected `{ keys: { ... } }` as first argument",
    );
  }
  const obj = readDataLiteralNode(arg);
  if (!isPlainObject(obj)) {
    return fail(
      "config",
      sourceLocationFromNode(call, sourceFile),
      "argument could not be read as a plain object",
    );
  }
  const keys = obj["keys"];
  if (!isPlainObject(keys)) {
    return fail(
      "config",
      sourceLocationFromNode(call, sourceFile),
      "missing or non-object `keys` property",
    );
  }
  return ok({
    kind: "config",
    source: sourceLocationFromNode(call, sourceFile),
    keys: keys as Readonly<Record<string, ConfigKeyDefinition<ConfigKeyType>>>,
  });
}

export function extractTranslations(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<TranslationsPattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "translations",
      sourceLocationFromNode(call, sourceFile),
      "expected `{ keys: { ... } }` as first argument",
    );
  }
  const obj = readDataLiteralNode(arg);
  if (!isPlainObject(obj)) {
    return fail(
      "translations",
      sourceLocationFromNode(call, sourceFile),
      "argument could not be read as a plain object",
    );
  }
  const keys = obj["keys"];
  if (!isPlainObject(keys)) {
    return fail(
      "translations",
      sourceLocationFromNode(call, sourceFile),
      "missing or non-object `keys` property",
    );
  }
  return ok({
    kind: "translations",
    source: sourceLocationFromNode(call, sourceFile),
    keys: keys as TranslationKeys,
  });
}

// Shared shape for extractors that take a name + options bag — accepts
// both positional `(name, { ...options })` and single object-form
// `({ name, ...options })`. Returns the parsed name + the options bag
// (options bag minus the `name` property in object-form), or routes
// the failure through `fail()` so error-reason strings don't show up
// as object-literal `reason:` properties (the error-reasons-guard
// expects snake_case for those, and our parser-error reasons are
// human-prose).
type NamedOptionsResult =
  | { readonly kind: "ok"; readonly name: string; readonly options: Record<string, unknown> }
  | { readonly kind: "error"; readonly error: ParseError };

function readNamedOptions(
  call: CallExpression,
  sourceFile: SourceFile,
  methodName: string,
): NamedOptionsResult {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  // Object-Form: r.method({ name: "...", ...options })
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const nameInit = obj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameInit) {
      return fail(
        methodName,
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const data = readDataLiteralNode(obj);
    if (!isPlainObject(data)) {
      return fail(
        methodName,
        sourceLocationFromNode(call, sourceFile),
        "argument could not be read as a plain object",
      );
    }
    const { name: _name, ...optionsWithoutName } = data;
    return { kind: "ok", name: nameInit.getLiteralValue(), options: optionsWithoutName };
  }

  // Legacy positional: r.method("name", { ...options })
  const nameLiteral = first.asKind(SyntaxKind.StringLiteral);
  if (!nameLiteral) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal name (or use the object form)",
    );
  }
  const optionsArg = args[1];
  if (!optionsArg) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "expected an options object as second argument",
    );
  }
  const options = readDataLiteralNode(optionsArg);
  if (!isPlainObject(options)) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "options could not be read as a plain object",
    );
  }
  return { kind: "ok", name: nameLiteral.getLiteralValue(), options };
}

export function extractMetric(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<MetricPattern> {
  const parsed = readNamedOptions(call, sourceFile, "metric");
  if (parsed.kind === "error") return parsed;
  return ok({
    kind: "metric",
    source: sourceLocationFromNode(call, sourceFile),
    shortName: parsed.name,
    options: parsed.options as MetricOptions,
  });
}

export function extractSecret(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<SecretPattern> {
  const parsed = readNamedOptions(call, sourceFile, "secret");
  if (parsed.kind === "error") return parsed;
  return ok({
    kind: "secret",
    source: sourceLocationFromNode(call, sourceFile),
    shortName: parsed.name,
    options: parsed.options as SecretOptions,
  });
}

export function extractClaimKey(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ClaimKeyPattern> {
  const parsed = readNamedOptions(call, sourceFile, "claimKey");
  if (parsed.kind === "error") return parsed;
  const claimType = parsed.options["type"];
  if (!isClaimKeyType(claimType)) {
    return fail(
      "claimKey",
      sourceLocationFromNode(call, sourceFile),
      'type must be one of "string" | "number" | "boolean" | "string[]" | "object"',
    );
  }
  return ok({
    kind: "claimKey",
    source: sourceLocationFromNode(call, sourceFile),
    shortName: parsed.name,
    claimType,
  });
}

function isClaimKeyType(value: unknown): value is ClaimKeyType {
  return (
    value === "string" ||
    value === "number" ||
    value === "boolean" ||
    value === "string[]" ||
    value === "object"
  );
}

export function extractReferenceData(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ReferenceDataPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "referenceData",
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  // Object-Form: r.referenceData({ entity, data, upsertKey? })
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const entityInit = obj
      .getProperty("entity")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!entityInit) {
      return fail(
        "referenceData",
        sourceLocationFromNode(call, sourceFile),
        "object form requires an `entity` property",
      );
    }
    const entityName = readNameOrRef(entityInit);
    if (!entityName) {
      return fail(
        "referenceData",
        sourceLocationFromNode(call, sourceFile),
        '`entity` must be a string literal or `{ name: "..." }` ref',
      );
    }
    const dataInit = obj
      .getProperty("data")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!dataInit) {
      return fail(
        "referenceData",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `data` property",
      );
    }
    const data = readDataLiteralNode(dataInit);
    if (!Array.isArray(data) || !data.every(isPlainObject)) {
      return fail(
        "referenceData",
        sourceLocationFromNode(call, sourceFile),
        "data must be an array of plain objects",
      );
    }
    let upsertKey: string | undefined;
    const upsertKeyInit = obj
      .getProperty("upsertKey")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (upsertKeyInit) {
      upsertKey = upsertKeyInit.getLiteralValue();
    }
    return ok({
      kind: "referenceData",
      source: sourceLocationFromNode(call, sourceFile),
      entityName,
      data: data as readonly Record<string, unknown>[],
      ...(upsertKey !== undefined && { upsertKey }),
    });
  }

  // Legacy positional: r.referenceData(entity, data, options?)
  const entityName = readNameOrRef(first);
  if (!entityName) {
    return fail(
      "referenceData",
      sourceLocationFromNode(call, sourceFile),
      'first argument must be a string literal or an inline { name: "..." } object (or use the object form)',
    );
  }
  const dataArg = args[1];
  if (!dataArg) {
    return fail(
      "referenceData",
      sourceLocationFromNode(call, sourceFile),
      "expected a data array as second argument",
    );
  }
  const data = readDataLiteralNode(dataArg);
  if (!Array.isArray(data) || !data.every(isPlainObject)) {
    return fail(
      "referenceData",
      sourceLocationFromNode(call, sourceFile),
      "data must be an array of plain objects",
    );
  }
  let upsertKey: string | undefined;
  const optionsArg = args[2];
  if (optionsArg) {
    const options = readDataLiteralNode(optionsArg);
    if (!isPlainObject(options)) {
      return fail(
        "referenceData",
        sourceLocationFromNode(call, sourceFile),
        "options could not be read as a plain object",
      );
    }
    if (options["upsertKey"] !== undefined) {
      if (typeof options["upsertKey"] !== "string") {
        return fail(
          "referenceData",
          sourceLocationFromNode(call, sourceFile),
          "upsertKey must be a string when provided",
        );
      }
      upsertKey = options["upsertKey"];
    }
  }
  return ok({
    kind: "referenceData",
    source: sourceLocationFromNode(call, sourceFile),
    entityName,
    data: data as readonly Record<string, unknown>[],
    ...(upsertKey !== undefined && { upsertKey }),
  });
}

export function extractUseExtension(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<UseExtensionPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "useExtension",
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  // Object-Form: r.useExtension({ name, entity, options? })
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const nameInit = obj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameInit) {
      return fail(
        "useExtension",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const entityInit = obj
      .getProperty("entity")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!entityInit) {
      return fail(
        "useExtension",
        sourceLocationFromNode(call, sourceFile),
        "object form requires an `entity` property",
      );
    }
    const entityName = readNameOrRef(entityInit);
    if (!entityName) {
      return fail(
        "useExtension",
        sourceLocationFromNode(call, sourceFile),
        '`entity` must be a string literal or `{ name: "..." }` ref',
      );
    }
    let options: Readonly<Record<string, unknown>> | undefined;
    const optionsInit = obj
      .getProperty("options")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (optionsInit) {
      const parsed = readDataLiteralNode(optionsInit);
      if (!isPlainObject(parsed)) {
        return fail(
          "useExtension",
          sourceLocationFromNode(call, sourceFile),
          "options could not be read as a plain object",
        );
      }
      options = parsed;
    }
    return ok({
      kind: "useExtension",
      source: sourceLocationFromNode(call, sourceFile),
      extensionName: nameInit.getLiteralValue(),
      entityName,
      ...(options !== undefined && { options }),
    });
  }

  // Legacy positional: r.useExtension(name, entity, options?)
  const nameArg = first.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "useExtension",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal extension name (or use the object form)",
    );
  }
  const entityRefArg = args[1];
  if (!entityRefArg) {
    return fail(
      "useExtension",
      sourceLocationFromNode(call, sourceFile),
      "expected an entity reference as second argument",
    );
  }
  const entityName = readNameOrRef(entityRefArg);
  if (!entityName) {
    return fail(
      "useExtension",
      sourceLocationFromNode(call, sourceFile),
      'second argument must be a string literal or an inline { name: "..." } object',
    );
  }
  const optionsArg = args[2];
  let options: Readonly<Record<string, unknown>> | undefined;
  if (optionsArg) {
    const parsed = readDataLiteralNode(optionsArg);
    if (!isPlainObject(parsed)) {
      return fail(
        "useExtension",
        sourceLocationFromNode(call, sourceFile),
        "options could not be read as a plain object",
      );
    }
    options = parsed;
  }
  return ok({
    kind: "useExtension",
    source: sourceLocationFromNode(call, sourceFile),
    extensionName: nameArg.getLiteralValue(),
    entityName,
    ...(options !== undefined && { options }),
  });
}

// =============================================================================
// Round 4 — mixed patterns (header data + opaque body source)
//
// Each extractor reads the static parts (name, type, target) declaratively
// and captures any closure / Zod-schema as a SourceLocation pointing at
// the raw source span. Designer renders the body as a read-only block;
// the AI patcher overwrites the span verbatim.
//
// Closure detection: findFunctionLiteral matches an inline arrow function
// or function expression. A captured-const reference (e.g. r.hook(...,
// myHandler)) is rejected with a ParseError — those need to be inlined.
// =============================================================================

function isHookType(value: string): value is LifecycleHookType | "validation" {
  return (
    value === "preSave" ||
    value === "postSave" ||
    value === "preDelete" ||
    value === "postDelete" ||
    value === "preQuery" ||
    value === "validation"
  );
}

function isHttpRouteMethod(value: string): value is HttpRouteMethod {
  return (
    value === "GET" ||
    value === "POST" ||
    value === "PUT" ||
    value === "PATCH" ||
    value === "DELETE" ||
    value === "HEAD" ||
    value === "OPTIONS"
  );
}

function readOptionalPhase(node: Node | undefined): HookPhase | undefined {
  if (!node) return undefined;
  const obj = readDataLiteralNode(node);
  if (!isPlainObject(obj)) return undefined;
  const phase = obj["phase"];
  if (phase === "inTransaction" || phase === "afterCommit") return phase as HookPhase;
  return undefined;
}

function readOptionalAccessRule(value: unknown): AccessRule | undefined {
  if (!isPlainObject(value)) return undefined;
  if (Array.isArray(value["roles"]) && value["roles"].every((r) => typeof r === "string")) {
    return { roles: value["roles"] as readonly string[] };
  }
  if (value["openToAll"] === true) {
    return { openToAll: true };
  }
  return undefined;
}

function readOptionalRateLimit(value: unknown): RateLimitOption | undefined {
  if (!isPlainObject(value)) return undefined;
  if (typeof value["per"] !== "string") return undefined;
  if (typeof value["limit"] !== "number") return undefined;
  if (typeof value["windowSeconds"] !== "number") return undefined;
  return value as unknown as RateLimitOption;
}

export function extractHook(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<HookPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail("hook", sourceLocationFromNode(call, sourceFile), "expected at least one argument");
  }

  // Object-Form: r.hook({ type, target, handler, phase? })
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const typeInit = obj
      .getProperty("type")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!typeInit) {
      return fail(
        "hook",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `type` property",
      );
    }
    const hookType = typeInit.getLiteralValue();
    if (!isHookType(hookType)) {
      return fail(
        "hook",
        sourceLocationFromNode(call, sourceFile),
        `hook type "${hookType}" is not one of the lifecycle types or "validation"`,
      );
    }
    const targetInit = obj
      .getProperty("target")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!targetInit) {
      return fail(
        "hook",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `target` property",
      );
    }
    const target = readNameOrRefOrList(targetInit);
    if (!target) {
      return fail(
        "hook",
        sourceLocationFromNode(call, sourceFile),
        "target must be a string literal, an inline { name } object, or an array",
      );
    }
    const handlerInit = obj
      .getProperty("handler")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!handlerInit) {
      return fail(
        "hook",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `handler` property",
      );
    }
    const fn = findFunctionLiteral(handlerInit);
    if (!fn) {
      return fail(
        "hook",
        sourceLocationFromNode(call, sourceFile),
        "handler must be an inline arrow function or function expression",
      );
    }
    const phase = readOptionalPhase(obj);
    return ok({
      kind: "hook",
      source: sourceLocationFromNode(call, sourceFile),
      hookType,
      target,
      fnBody: sourceLocationFromNode(fn, sourceFile),
      ...(phase !== undefined && { phase }),
    });
  }

  // Legacy positional: r.hook(type, target, fn, options?)
  const typeArg = first.asKind(SyntaxKind.StringLiteral);
  if (!typeArg) {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal hook type (or use the object form)",
    );
  }
  const hookType = typeArg.getLiteralValue();
  if (!isHookType(hookType)) {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      `hook type "${hookType}" is not one of the lifecycle types or "validation"`,
    );
  }
  const targetArg = args[1];
  if (!targetArg) {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      "expected a target (NameOrRef or array) as second argument",
    );
  }
  const target = readNameOrRefOrList(targetArg);
  if (!target) {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      "target must be a string literal, an inline { name } object, or an array",
    );
  }
  const fnArg = args[2];
  if (!fnArg) {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      "expected a hook function as third argument",
    );
  }
  const fn = findFunctionLiteral(fnArg);
  if (!fn) {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      "third argument must be an inline arrow function or function expression",
    );
  }
  const phase = readOptionalPhase(args[3]);
  return ok({
    kind: "hook",
    source: sourceLocationFromNode(call, sourceFile),
    hookType,
    target,
    fnBody: sourceLocationFromNode(fn, sourceFile),
    ...(phase !== undefined && { phase }),
  });
}

function isEntityHookType(value: string): value is "postSave" | "preDelete" | "postDelete" {
  return value === "postSave" || value === "preDelete" || value === "postDelete";
}

export function extractEntityHook(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<EntityHookPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  // Object-Form: r.entityHook({ type, entity, handler, phase? })
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const typeInit = obj
      .getProperty("type")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!typeInit) {
      return fail(
        "entityHook",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `type` property",
      );
    }
    const hookType = typeInit.getLiteralValue();
    if (!isEntityHookType(hookType)) {
      return fail(
        "entityHook",
        sourceLocationFromNode(call, sourceFile),
        `entity hook type must be postSave, preDelete, or postDelete (got "${hookType}")`,
      );
    }
    const entityInit = obj
      .getProperty("entity")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!entityInit) {
      return fail(
        "entityHook",
        sourceLocationFromNode(call, sourceFile),
        "object form requires an `entity` property",
      );
    }
    const entityName = readNameOrRef(entityInit);
    if (!entityName) {
      return fail(
        "entityHook",
        sourceLocationFromNode(call, sourceFile),
        "`entity` must be a string literal or inline { name } object",
      );
    }
    const handlerInit = obj
      .getProperty("handler")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!handlerInit) {
      return fail(
        "entityHook",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `handler` property",
      );
    }
    const fn = findFunctionLiteral(handlerInit);
    if (!fn) {
      return fail(
        "entityHook",
        sourceLocationFromNode(call, sourceFile),
        "handler must be an inline arrow function or function expression",
      );
    }
    const phase = readOptionalPhase(obj);
    return ok({
      kind: "entityHook",
      source: sourceLocationFromNode(call, sourceFile),
      hookType,
      entityName,
      fnBody: sourceLocationFromNode(fn, sourceFile),
      ...(phase !== undefined && { phase }),
    });
  }

  // Legacy positional: r.entityHook(type, entity, fn, options?)
  const typeArg = first.asKind(SyntaxKind.StringLiteral);
  if (!typeArg) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal hook type (or use the object form)",
    );
  }
  const hookType = typeArg.getLiteralValue();
  if (!isEntityHookType(hookType)) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      `entity hook type must be postSave, preDelete, or postDelete (got "${hookType}")`,
    );
  }
  const entityArg = args[1];
  if (!entityArg) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      "expected an entity reference as second argument",
    );
  }
  const entityName = readNameOrRef(entityArg);
  if (!entityName) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      "second argument must be a string literal or inline { name } object",
    );
  }
  const fnArg = args[2];
  if (!fnArg) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      "expected a hook function as third argument",
    );
  }
  const fn = findFunctionLiteral(fnArg);
  if (!fn) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      "third argument must be an inline arrow function or function expression",
    );
  }
  const phase = readOptionalPhase(args[3]);
  return ok({
    kind: "entityHook",
    source: sourceLocationFromNode(call, sourceFile),
    hookType,
    entityName,
    fnBody: sourceLocationFromNode(fn, sourceFile),
    ...(phase !== undefined && { phase }),
  });
}

export function extractAuthClaims(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<AuthClaimsPattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "authClaims",
      sourceLocationFromNode(call, sourceFile),
      "expected a function as first argument",
    );
  }
  const fn = findFunctionLiteral(arg);
  if (!fn) {
    return fail(
      "authClaims",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be an inline arrow function or function expression",
    );
  }
  return ok({
    kind: "authClaims",
    source: sourceLocationFromNode(call, sourceFile),
    fnBody: sourceLocationFromNode(fn, sourceFile),
  });
}

// Common fields produced by parseHandlerCall — both write- and query-
// handler patterns share them. The wrapper functions below add the
// kind-discriminator and the write-only skipTransitionGuard so the
// shared helper stays unbiased.
type ParsedHandlerCall = {
  readonly source: SourceLocation;
  readonly handlerName: string;
  readonly schemaSource: SourceLocation;
  readonly handlerBody: SourceLocation;
  readonly access?: AccessRule;
  readonly rateLimit?: RateLimitOption;
  readonly skipTransitionGuard?: boolean;
};

// Shared parser for r.writeHandler / r.queryHandler. Accepts both
// inline form r.<method>(name, schema, handler, options?) and the
// single-arg object form r.<method>({ name, schema, handler, ... })
// (the defineWriteHandler / defineQueryHandler shape).
function parseHandlerCall(
  call: CallExpression,
  sourceFile: SourceFile,
  methodName: "writeHandler" | "queryHandler",
): ExtractOutput<ParsedHandlerCall> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  // Object form: a single { name, schema, handler, ... } literal.
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const nameLiteral = obj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameLiteral) {
      return fail(
        methodName,
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const schemaInit = obj
      .getProperty("schema")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!schemaInit) {
      return fail(
        methodName,
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `schema` property",
      );
    }
    const handlerInit = obj
      .getProperty("handler")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!handlerInit) {
      return fail(
        methodName,
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `handler` property",
      );
    }
    const fn = findFunctionLiteral(handlerInit);
    if (!fn) {
      return fail(
        methodName,
        sourceLocationFromNode(call, sourceFile),
        "handler must be an inline arrow function or function expression",
      );
    }
    const accessInit = obj
      .getProperty("access")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    const access = accessInit ? readOptionalAccessRule(readDataLiteralNode(accessInit)) : undefined;
    const rateLimitInit = obj
      .getProperty("rateLimit")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    const rateLimit = rateLimitInit
      ? readOptionalRateLimit(readDataLiteralNode(rateLimitInit))
      : undefined;
    const skip = readBooleanProperty(obj, "skipTransitionGuard");
    return ok({
      source: sourceLocationFromNode(call, sourceFile),
      handlerName: nameLiteral.getLiteralValue(),
      schemaSource: sourceLocationFromNode(schemaInit, sourceFile),
      handlerBody: sourceLocationFromNode(fn, sourceFile),
      ...(access !== undefined && { access }),
      ...(rateLimit !== undefined && { rateLimit }),
      ...(skip === true && { skipTransitionGuard: true }),
    });
  }

  // Inline form: (name, schema, handler, options?).
  const nameLiteral = first.asKind(SyntaxKind.StringLiteral);
  if (!nameLiteral) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal handler name (or use the object form)",
    );
  }
  const schemaArg = args[1];
  if (!schemaArg) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "expected a Zod schema as second argument",
    );
  }
  const handlerArg = args[2];
  if (!handlerArg) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "expected a handler function as third argument",
    );
  }
  const fn = findFunctionLiteral(handlerArg);
  if (!fn) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "third argument must be an inline arrow function or function expression",
    );
  }
  const optionsArg = args[3];
  let access: AccessRule | undefined;
  let rateLimit: RateLimitOption | undefined;
  if (optionsArg) {
    const options = readDataLiteralNode(optionsArg);
    if (isPlainObject(options)) {
      access = readOptionalAccessRule(options["access"]);
      rateLimit = readOptionalRateLimit(options["rateLimit"]);
    }
  }
  return ok({
    source: sourceLocationFromNode(call, sourceFile),
    handlerName: nameLiteral.getLiteralValue(),
    schemaSource: sourceLocationFromNode(schemaArg, sourceFile),
    handlerBody: sourceLocationFromNode(fn, sourceFile),
    ...(access !== undefined && { access }),
    ...(rateLimit !== undefined && { rateLimit }),
  });
}

export function extractWriteHandler(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<WriteHandlerPattern> {
  const parsed = parseHandlerCall(call, sourceFile, "writeHandler");
  if (parsed.kind === "error") return parsed;
  return ok({
    kind: "writeHandler",
    source: parsed.pattern.source,
    handlerName: parsed.pattern.handlerName,
    schemaSource: parsed.pattern.schemaSource,
    handlerBody: parsed.pattern.handlerBody,
    ...(parsed.pattern.access !== undefined && { access: parsed.pattern.access }),
    ...(parsed.pattern.rateLimit !== undefined && { rateLimit: parsed.pattern.rateLimit }),
    ...(parsed.pattern.skipTransitionGuard === true && { skipTransitionGuard: true }),
  });
}

export function extractQueryHandler(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<QueryHandlerPattern> {
  const parsed = parseHandlerCall(call, sourceFile, "queryHandler");
  if (parsed.kind === "error") return parsed;
  // QueryHandler has no skipTransitionGuard — the field is silently
  // ignored if the parser reads one (won't happen in practice because
  // queryHandlers don't carry that option).
  return ok({
    kind: "queryHandler",
    source: parsed.pattern.source,
    handlerName: parsed.pattern.handlerName,
    schemaSource: parsed.pattern.schemaSource,
    handlerBody: parsed.pattern.handlerBody,
    ...(parsed.pattern.access !== undefined && { access: parsed.pattern.access }),
    ...(parsed.pattern.rateLimit !== undefined && { rateLimit: parsed.pattern.rateLimit }),
  });
}

export function extractJob(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<JobPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail("job", sourceLocationFromNode(call, sourceFile), "expected at least one argument");
  }

  // Object-Form: r.job({ name, ...options, handler })
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const nameInit = obj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameInit) {
      return fail(
        "job",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const handlerInit = obj
      .getProperty("handler")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!handlerInit) {
      return fail(
        "job",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `handler` property",
      );
    }
    const fn = findFunctionLiteral(handlerInit);
    if (!fn) {
      return fail(
        "job",
        sourceLocationFromNode(call, sourceFile),
        "handler must be an inline arrow function or function expression",
      );
    }
    // Read every property except `name` and `handler` as the options
    // bag — `handler` is a closure (not JSON-readable) and `name` lives
    // separately on the pattern. Walk properties one-by-one so handler
    // doesn't crash readDataLiteralNode.
    const optionsBag: Record<string, unknown> = {};
    for (const prop of obj.getProperties()) {
      const propAssign = prop.asKind(SyntaxKind.PropertyAssignment);
      if (!propAssign) continue;
      const key = readPropertyKey(propAssign);
      if (key === "name" || key === "handler") continue;
      const init = propAssign.getInitializer();
      if (!init) continue;
      const value = readDataLiteralNode(init);
      if (value === undefined) {
        return fail(
          "job",
          sourceLocationFromNode(call, sourceFile),
          `option "${key}" could not be read as a plain value`,
        );
      }
      optionsBag[key] = value;
    }
    return ok({
      kind: "job",
      source: sourceLocationFromNode(call, sourceFile),
      jobName: nameInit.getLiteralValue(),
      options: optionsBag as Omit<JobDefinition, "name" | "handler">,
      handlerBody: sourceLocationFromNode(fn, sourceFile),
    });
  }

  // Legacy positional: r.job(name, options, handler)
  const nameArg = first.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "job",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal job name (or use the object form)",
    );
  }
  const optionsArg = args[1];
  if (!optionsArg) {
    return fail(
      "job",
      sourceLocationFromNode(call, sourceFile),
      "expected an options object as second argument",
    );
  }
  const options = readDataLiteralNode(optionsArg);
  if (!isPlainObject(options)) {
    return fail(
      "job",
      sourceLocationFromNode(call, sourceFile),
      "options could not be read as a plain object",
    );
  }
  const handlerArg = args[2];
  if (!handlerArg) {
    return fail(
      "job",
      sourceLocationFromNode(call, sourceFile),
      "expected a handler function as third argument",
    );
  }
  const fn = findFunctionLiteral(handlerArg);
  if (!fn) {
    return fail(
      "job",
      sourceLocationFromNode(call, sourceFile),
      "third argument must be an inline arrow function or function expression",
    );
  }
  return ok({
    kind: "job",
    source: sourceLocationFromNode(call, sourceFile),
    jobName: nameArg.getLiteralValue(),
    options: options as Omit<JobDefinition, "name" | "handler">,
    handlerBody: sourceLocationFromNode(fn, sourceFile),
  });
}

export function extractHttpRoute(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<HttpRoutePattern> {
  const arg = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!arg) {
    return fail(
      "httpRoute",
      sourceLocationFromNode(call, sourceFile),
      "argument must be an inline HttpRouteDefinition object",
    );
  }
  const methodLiteral = arg
    .getProperty("method")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  if (!methodLiteral) {
    return fail(
      "httpRoute",
      sourceLocationFromNode(call, sourceFile),
      "method must be a string literal",
    );
  }
  const methodValue = methodLiteral.getLiteralValue();
  if (!isHttpRouteMethod(methodValue)) {
    return fail(
      "httpRoute",
      sourceLocationFromNode(call, sourceFile),
      `method must be one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS (got "${methodValue}")`,
    );
  }
  const pathLiteral = arg
    .getProperty("path")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  if (!pathLiteral) {
    return fail(
      "httpRoute",
      sourceLocationFromNode(call, sourceFile),
      "path must be a string literal",
    );
  }
  const handlerInit = arg
    .getProperty("handler")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  if (!handlerInit) {
    return fail(
      "httpRoute",
      sourceLocationFromNode(call, sourceFile),
      "missing `handler` property",
    );
  }
  const fn = findFunctionLiteral(handlerInit);
  if (!fn) {
    return fail(
      "httpRoute",
      sourceLocationFromNode(call, sourceFile),
      "handler must be an inline arrow function or function expression",
    );
  }
  const anonymous = readBooleanProperty(arg, "anonymous");
  return ok({
    kind: "httpRoute",
    source: sourceLocationFromNode(call, sourceFile),
    method: methodValue,
    path: pathLiteral.getLiteralValue(),
    handlerBody: sourceLocationFromNode(fn, sourceFile),
    ...(anonymous === true && { anonymous: true }),
  });
}

export function extractDefineEvent(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<DefineEventPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "defineEvent",
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  // Object-Form: r.defineEvent({ name, schema, version? })
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const nameInit = obj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameInit) {
      return fail(
        "defineEvent",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const schemaInit = obj
      .getProperty("schema")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!schemaInit) {
      return fail(
        "defineEvent",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `schema` property",
      );
    }
    let version: number | undefined;
    const versionInit = obj
      .getProperty("version")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (versionInit) {
      const v = readDataLiteralNode(versionInit);
      if (typeof v === "number") version = v;
    }
    return ok({
      kind: "defineEvent",
      source: sourceLocationFromNode(call, sourceFile),
      eventName: nameInit.getLiteralValue(),
      schemaSource: sourceLocationFromNode(schemaInit, sourceFile),
      ...(version !== undefined && { version }),
    });
  }

  // Legacy positional: r.defineEvent(name, schema, options?)
  const nameArg = first.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "defineEvent",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal event name (or use the object form)",
    );
  }
  const schemaArg = args[1];
  if (!schemaArg) {
    return fail(
      "defineEvent",
      sourceLocationFromNode(call, sourceFile),
      "expected a Zod schema as second argument",
    );
  }
  let version: number | undefined;
  const optionsArg = args[2];
  if (optionsArg) {
    const options = readDataLiteralNode(optionsArg);
    if (isPlainObject(options) && typeof options["version"] === "number") {
      version = options["version"];
    }
  }
  return ok({
    kind: "defineEvent",
    source: sourceLocationFromNode(call, sourceFile),
    eventName: nameArg.getLiteralValue(),
    schemaSource: sourceLocationFromNode(schemaArg, sourceFile),
    ...(version !== undefined && { version }),
  });
}

export function extractEventMigration(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<EventMigrationPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "eventMigration",
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  // Object-Form: r.eventMigration({ event, fromVersion, toVersion, transform })
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const eventInit = obj
      .getProperty("event")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!eventInit) {
      return fail(
        "eventMigration",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `event` property",
      );
    }
    const fromInit = obj
      .getProperty("fromVersion")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    const fromVersion = fromInit ? readDataLiteralNode(fromInit) : undefined;
    if (typeof fromVersion !== "number") {
      return fail(
        "eventMigration",
        sourceLocationFromNode(call, sourceFile),
        "fromVersion must be a numeric literal",
      );
    }
    const toInit = obj
      .getProperty("toVersion")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    const toVersion = toInit ? readDataLiteralNode(toInit) : undefined;
    if (typeof toVersion !== "number") {
      return fail(
        "eventMigration",
        sourceLocationFromNode(call, sourceFile),
        "toVersion must be a numeric literal",
      );
    }
    const transformInit = obj
      .getProperty("transform")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!transformInit) {
      return fail(
        "eventMigration",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `transform` property",
      );
    }
    const fn = findFunctionLiteral(transformInit);
    if (!fn) {
      return fail(
        "eventMigration",
        sourceLocationFromNode(call, sourceFile),
        "transform must be an inline arrow function or function expression",
      );
    }
    return ok({
      kind: "eventMigration",
      source: sourceLocationFromNode(call, sourceFile),
      eventName: eventInit.getLiteralValue(),
      fromVersion,
      toVersion,
      transformBody: sourceLocationFromNode(fn, sourceFile),
    });
  }

  // Legacy positional: r.eventMigration(name, from, to, transform)
  const nameArg = first.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "eventMigration",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal event name (or use the object form)",
    );
  }
  const fromArg = args[1];
  const fromVersion = fromArg ? readDataLiteralNode(fromArg) : undefined;
  if (typeof fromVersion !== "number") {
    return fail(
      "eventMigration",
      sourceLocationFromNode(call, sourceFile),
      "fromVersion must be a numeric literal",
    );
  }
  const toArg = args[2];
  const toVersion = toArg ? readDataLiteralNode(toArg) : undefined;
  if (typeof toVersion !== "number") {
    return fail(
      "eventMigration",
      sourceLocationFromNode(call, sourceFile),
      "toVersion must be a numeric literal",
    );
  }
  const transformArg = args[3];
  if (!transformArg) {
    return fail(
      "eventMigration",
      sourceLocationFromNode(call, sourceFile),
      "expected a transform function as fourth argument",
    );
  }
  const fn = findFunctionLiteral(transformArg);
  if (!fn) {
    return fail(
      "eventMigration",
      sourceLocationFromNode(call, sourceFile),
      "transform must be an inline arrow function or function expression",
    );
  }
  return ok({
    kind: "eventMigration",
    source: sourceLocationFromNode(call, sourceFile),
    eventName: nameArg.getLiteralValue(),
    fromVersion,
    toVersion,
    transformBody: sourceLocationFromNode(fn, sourceFile),
  });
}

export function extractNotification(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<NotificationPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "notification",
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  // Two argument shapes accepted:
  //   (a) Legacy positional: r.notification("name", { trigger, recipient, data, templates? })
  //   (b) Canonical Object-Form: r.notification({ name, trigger, recipient, data, templates? })
  // The body code below is shape-agnostic — `nameLiteral` carries the
  // notification's name, `defObj` is the object literal that holds the
  // trigger/recipient/data/templates.
  let nameLiteral: ReturnType<typeof first.asKind<SyntaxKind.StringLiteral>>;
  let defObj: ReturnType<typeof first.asKind<SyntaxKind.ObjectLiteralExpression>>;

  const firstObj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (firstObj && args.length === 1) {
    // Object-Form
    nameLiteral = firstObj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameLiteral) {
      return fail(
        "notification",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    defObj = firstObj;
  } else {
    // Legacy positional
    nameLiteral = first.asKind(SyntaxKind.StringLiteral);
    if (!nameLiteral) {
      return fail(
        "notification",
        sourceLocationFromNode(call, sourceFile),
        "first argument must be a string literal notification name (or use the object form)",
      );
    }
    defObj = args[1]?.asKind(SyntaxKind.ObjectLiteralExpression);
    if (!defObj) {
      return fail(
        "notification",
        sourceLocationFromNode(call, sourceFile),
        "second argument must be an inline definition object",
      );
    }
  }
  const nameArg = nameLiteral;
  const triggerObj = defObj
    .getProperty("trigger")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!triggerObj) {
    return fail(
      "notification",
      sourceLocationFromNode(call, sourceFile),
      "missing or non-object `trigger` property",
    );
  }
  const onInit = triggerObj
    .getProperty("on")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  const onName = onInit ? readNameOrRef(onInit) : undefined;
  if (!onName) {
    return fail(
      "notification",
      sourceLocationFromNode(call, sourceFile),
      "trigger.on must be a string literal or inline { name } object",
    );
  }
  const recipientInit = defObj
    .getProperty("recipient")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  const recipientFn = recipientInit ? findFunctionLiteral(recipientInit) : undefined;
  if (!recipientFn) {
    return fail(
      "notification",
      sourceLocationFromNode(call, sourceFile),
      "recipient must be an inline arrow function or function expression",
    );
  }
  const dataInit = defObj
    .getProperty("data")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  const dataFn = dataInit ? findFunctionLiteral(dataInit) : undefined;
  if (!dataFn) {
    return fail(
      "notification",
      sourceLocationFromNode(call, sourceFile),
      "data must be an inline arrow function or function expression",
    );
  }
  let templates: Record<string, SourceLocation> | undefined;
  const templatesObj = defObj
    .getProperty("templates")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (templatesObj) {
    templates = {};
    for (const prop of templatesObj.getProperties()) {
      const propAssign = prop.asKind(SyntaxKind.PropertyAssignment);
      if (!propAssign) continue;
      const init = propAssign.getInitializer();
      if (!init) continue;
      const tfn = findFunctionLiteral(init);
      if (!tfn) continue;
      templates[readPropertyKey(propAssign)] = sourceLocationFromNode(tfn, sourceFile);
    }
  }
  return ok({
    kind: "notification",
    source: sourceLocationFromNode(call, sourceFile),
    notificationName: nameArg.getLiteralValue(),
    trigger: { on: onName },
    recipientBody: sourceLocationFromNode(recipientFn, sourceFile),
    dataBody: sourceLocationFromNode(dataFn, sourceFile),
    ...(templates !== undefined && { templates }),
  });
}

// Read an `apply: { eventType: fn }` map from a projection-definition object.
function readApplyBodies(
  defObj: ReturnType<Node["asKind"]>,
  sourceFile: SourceFile,
): Record<string, SourceLocation> | undefined {
  if (!defObj) return undefined;
  const obj = defObj.asKind?.(SyntaxKind.ObjectLiteralExpression);
  if (!obj) return undefined;
  const applyObj = obj
    .getProperty("apply")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!applyObj) return undefined;
  const out: Record<string, SourceLocation> = {};
  for (const prop of applyObj.getProperties()) {
    const propAssign = prop.asKind(SyntaxKind.PropertyAssignment);
    if (!propAssign) return undefined;
    const init = propAssign.getInitializer();
    if (!init) return undefined;
    const fn = findFunctionLiteral(init);
    if (!fn) return undefined;
    out[readPropertyKey(propAssign)] = sourceLocationFromNode(fn, sourceFile);
  }
  return out;
}

export function extractProjection(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ProjectionPattern> {
  const arg = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!arg) {
    return fail(
      "projection",
      sourceLocationFromNode(call, sourceFile),
      "argument must be an inline ProjectionDefinition object",
    );
  }
  const nameLit = arg
    .getProperty("name")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  if (!nameLit) {
    return fail(
      "projection",
      sourceLocationFromNode(call, sourceFile),
      "name must be a string literal",
    );
  }
  const sourceInit = arg
    .getProperty("source")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  if (!sourceInit) {
    return fail(
      "projection",
      sourceLocationFromNode(call, sourceFile),
      "missing `source` property",
    );
  }
  const sourceEntity = readNameOrRefOrList(sourceInit);
  if (!sourceEntity) {
    return fail(
      "projection",
      sourceLocationFromNode(call, sourceFile),
      "source must be a string literal or array of string literals",
    );
  }
  const applyBodies = readApplyBodies(arg, sourceFile);
  if (!applyBodies) {
    return fail(
      "projection",
      sourceLocationFromNode(call, sourceFile),
      "apply must be an inline object map of event-type → function",
    );
  }
  return ok({
    kind: "projection",
    source: sourceLocationFromNode(call, sourceFile),
    name: nameLit.getLiteralValue(),
    sourceEntity,
    applyBodies,
  });
}

export function extractMultiStreamProjection(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<MultiStreamProjectionPattern> {
  const arg = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!arg) {
    return fail(
      "multiStreamProjection",
      sourceLocationFromNode(call, sourceFile),
      "argument must be an inline MultiStreamProjectionDefinition object",
    );
  }
  const nameLit = arg
    .getProperty("name")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  if (!nameLit) {
    return fail(
      "multiStreamProjection",
      sourceLocationFromNode(call, sourceFile),
      "name must be a string literal",
    );
  }
  const applyBodies = readApplyBodies(arg, sourceFile);
  if (!applyBodies) {
    return fail(
      "multiStreamProjection",
      sourceLocationFromNode(call, sourceFile),
      "apply must be an inline object map of event-type → function",
    );
  }
  const errorModeInit = arg
    .getProperty("errorMode")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  const errorMode = errorModeInit ? readDataLiteralNode(errorModeInit) : undefined;
  const runInLit = arg
    .getProperty("runIn")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  const runIn = runInLit ? (runInLit.getLiteralValue() as RunIn) : undefined;
  const deliveryLit = arg
    .getProperty("delivery")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  const delivery = deliveryLit
    ? (deliveryLit.getLiteralValue() as "shared" | "per-instance")
    : undefined;
  return ok({
    kind: "multiStreamProjection",
    source: sourceLocationFromNode(call, sourceFile),
    name: nameLit.getLiteralValue(),
    applyBodies,
    ...(isPlainObject(errorMode) && { errorMode: errorMode as MspErrorMode }),
    ...(runIn !== undefined && { runIn }),
    ...(delivery !== undefined && { delivery }),
  });
}

// Walk the screen definition and collect every closure-typed property
// as a JSON-path → SourceLocation entry. The Designer renders forms for
// the rest of the definition; the AI patcher knows it can replace the
// span at the listed paths without touching surrounding fields.
function collectScreenOpaqueProps(
  node: Node,
  path: string,
  sourceFile: SourceFile,
  out: Record<string, SourceLocation>,
): void {
  const fn = findFunctionLiteral(node);
  if (fn) {
    out[path] = sourceLocationFromNode(fn, sourceFile);
  } else if (node.isKind(SyntaxKind.ObjectLiteralExpression)) {
    for (const prop of node.getProperties()) {
      const propAssign = prop.asKind(SyntaxKind.PropertyAssignment);
      if (!propAssign) continue;
      const init = propAssign.getInitializer();
      if (!init) continue;
      const key = readPropertyKey(propAssign);
      const childPath = path ? `${path}.${key}` : key;
      collectScreenOpaqueProps(init, childPath, sourceFile, out);
    }
  } else if (node.isKind(SyntaxKind.ArrayLiteralExpression)) {
    node.getElements().forEach((el, idx) => {
      collectScreenOpaqueProps(el, `${path}.${idx}`, sourceFile, out);
    });
  }
}

// Walk a screen-definition object and produce a JSON view, replacing any
// closure-typed property with SCREEN_OPAQUE_MARKER. Identifiers and
// other non-readable nodes also become the marker so the static tree
// stays serialisable while pointing the Designer at opaqueProps for the
// real source span.
function readScreenStatic(node: Node): unknown {
  if (findFunctionLiteral(node)) return SCREEN_OPAQUE_MARKER;
  const obj = node.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj) {
    const out: Record<string, unknown> = {};
    for (const prop of obj.getProperties()) {
      const propAssign = prop.asKind(SyntaxKind.PropertyAssignment);
      if (!propAssign) continue;
      const init = propAssign.getInitializer();
      if (!init) continue;
      out[readPropertyKey(propAssign)] = readScreenStatic(init);
    }
    return out;
  }
  const arr = node.asKind(SyntaxKind.ArrayLiteralExpression);
  if (arr) {
    return arr.getElements().map(readScreenStatic);
  }
  const value = readDataLiteralNode(node);
  if (value === undefined) return SCREEN_OPAQUE_MARKER;
  return value;
}

export function extractScreen(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ScreenPattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "screen",
      sourceLocationFromNode(call, sourceFile),
      "expected a ScreenDefinition object as first argument",
    );
  }
  const obj = arg.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj) {
    return fail(
      "screen",
      sourceLocationFromNode(call, sourceFile),
      "argument must be an inline object literal",
    );
  }
  const opaqueProps: Record<string, SourceLocation> = {};
  collectScreenOpaqueProps(obj, "", sourceFile, opaqueProps);
  const definition = readScreenStatic(obj);
  if (!isPlainObject(definition)) {
    return fail(
      "screen",
      sourceLocationFromNode(call, sourceFile),
      "definition could not be read structurally",
    );
  }
  return ok({
    kind: "screen",
    source: sourceLocationFromNode(call, sourceFile),
    definition: definition as ScreenDefinition,
    opaqueProps: opaqueProps as OpaquePropMap,
  });
}

// =============================================================================
// Round 5 — opaque patterns (no static header beyond a name)
// =============================================================================

export function extractExtendsRegistrar(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ExtendsRegistrarPattern> {
  const args = call.getArguments();
  const nameArg = args[0]?.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "extendsRegistrar",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal extension name",
    );
  }
  const defArg = args[1];
  if (!defArg) {
    return fail(
      "extendsRegistrar",
      sourceLocationFromNode(call, sourceFile),
      "expected a definition argument",
    );
  }
  return ok({
    kind: "extendsRegistrar",
    source: sourceLocationFromNode(call, sourceFile),
    extensionName: nameArg.getLiteralValue(),
    defBody: sourceLocationFromNode(defArg, sourceFile),
  });
}
