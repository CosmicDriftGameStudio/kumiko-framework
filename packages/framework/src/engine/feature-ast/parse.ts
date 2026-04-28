// parseFeatureFile — entry-point for AST pattern detection. Reads a
// `defineFeature.ts` file, walks the `setup(r => { ... })` callback,
// and emits one FeaturePattern per recognised `r.*` call.
//
// **Pipeline position:**
//
//   ┌──────────────────┐    parseFeatureFile      ┌─────────────────────┐
//   │ feature-file.ts  │  ──────────────────────► │ ParseResult         │
//   │ (defineFeature   │                          │  - featureName      │
//   │  with r.* calls) │                          │  - patterns: FP[]   │
//   └──────────────────┘                          │  - errors: PE[]     │
//                                                 └─────────────────────┘
//
// **What is NOT extracted:**
//   - Imports, helper functions, local consts between the `r.*` calls.
//     Those stay in the file buffer and survive every patch unchanged.
//   - Top-level code outside `defineFeature(...)`. Designer/AI treat
//     such files as "not a feature file".
//
// **Skeleton status (C1.3):** interface fixed, extractors are TODO.
// Per-pattern extractors fill in iteratively (C1.5) — each round adds
// one extractor + a focused test.

import type {
  ArrowFunction,
  CallExpression,
  Node,
  ParameterDeclaration,
  SourceFile,
} from "ts-morph";
import { Project, SyntaxKind } from "ts-morph";

import type { FeaturePattern, UnknownPattern } from "./patterns";
import type { SourceLocation } from "./source-location";

// =============================================================================
// Public API
// =============================================================================

export type ParseError = {
  // Which r.* call could not be parsed (only the method name —
  // a call without a method name isn't an r.* call and never lands
  // here).
  readonly methodName: string;
  // Where in the file. The Designer can highlight the spot
  // ("call not understood here").
  readonly source: SourceLocation;
  // Free-form description (e.g. "argument 0 is not an object literal,
  // cannot read EntityDefinition statically").
  readonly reason: string;
};

export type ParseResult = {
  // Extracted from `defineFeature("name", ...)`. Undefined when the
  // file has no `defineFeature` call (then `patterns` is empty too).
  readonly featureName: string | undefined;
  // Recognised r.* calls in source order.
  readonly patterns: readonly FeaturePattern[];
  // Calls whose arguments we could not statically read. The method
  // name is known; only the payload was unreachable. Designer renders
  // them as "cannot edit", AI patcher leaves them alone. Distinct from
  // UnknownPattern (where the method name itself is unknown).
  readonly errors: readonly ParseError[];
};

/**
 * Parse the given feature file and return all recognised r.* calls
 * as a FeaturePattern list.
 *
 * Does NOT throw on TypeScript errors — the visitor works on the syntax
 * tree, not on the type checker. Files with type errors can still be
 * parsed structurally (Designer keeps showing them, AI can suggest fixes).
 *
 * Throws on filesystem / parse errors that ts-morph cannot recover from.
 */
export function parseFeatureFile(filePath: string): ParseResult {
  const project = new Project({
    // Skip tsconfig file discovery: we only ever load this single file.
    // Without these flags ts-morph would resolve the whole tsconfig
    // tree, which is expensive on large repos and unnecessary for
    // structural analysis.
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sourceFile = project.addSourceFileAtPath(filePath);
  return parseSourceFile(sourceFile);
}

/**
 * Same as parseFeatureFile, but for SourceFiles already loaded by the
 * caller. Useful for tests + the Designer (which keeps its own Project
 * instance and avoids re-IO per parse).
 */
export function parseSourceFile(sourceFile: SourceFile): ParseResult {
  const setupCall = findDefineFeatureCall(sourceFile);
  if (!setupCall) {
    return { featureName: undefined, patterns: [], errors: [] };
  }

  const featureName = extractFeatureName(setupCall);
  const setupCallback = extractSetupCallback(setupCall);
  if (!setupCallback) {
    return { featureName, patterns: [], errors: [] };
  }

  const registrarParamName = extractRegistrarParamName(setupCallback);
  if (!registrarParamName) {
    return { featureName, patterns: [], errors: [] };
  }

  const patterns: FeaturePattern[] = [];
  const errors: ParseError[] = [];

  walkSetupCallback(setupCallback, registrarParamName, sourceFile, patterns, errors);

  return { featureName, patterns, errors };
}

// =============================================================================
// Internal — locate defineFeature + setup callback
// =============================================================================

/**
 * Find the `defineFeature(name, setup)` call in the source file.
 * Convention: each feature file invokes `defineFeature` exactly once
 * at top level. If multiple calls exist (unusual outside of test
 * helpers) we take the first.
 */
function findDefineFeatureCall(sourceFile: SourceFile): CallExpression | undefined {
  for (const stmt of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = stmt.getExpression();
    if (expr.getText() === "defineFeature") {
      return stmt;
    }
  }
  return undefined;
}

/**
 * Read the feature name from the first argument of `defineFeature(...)`.
 * Returns undefined when the argument is not a string literal (e.g.
 * dynamic name from a const). Designer can still load the file but the
 * AI generator will never produce such a setup.
 */
function extractFeatureName(call: CallExpression): string | undefined {
  const arg = call.getArguments()[0];
  if (!arg) return undefined;
  const literal = arg.asKind(SyntaxKind.StringLiteral);
  if (!literal) return undefined;
  return literal.getLiteralValue();
}

/**
 * Read the `setup` callback (second argument) from `defineFeature(...)`.
 * We only support the arrow-function form here — function expressions
 * have not turned up in any sample so far. If a future feature needs
 * them, this is the single hook to extend.
 */
function extractSetupCallback(call: CallExpression): ArrowFunction | undefined {
  const arg = call.getArguments()[1];
  if (!arg) return undefined;
  return arg.asKind(SyntaxKind.ArrowFunction);
}

/**
 * Read the parameter name of the setup callback's first parameter.
 * Idiomatic feature files call it `r`, but `(registrar) => { ... }` or
 * `(reg) => { ... }` are equally legal — the visitor must follow the
 * author's choice or it would silently miss every call.
 *
 * Returns undefined when the callback takes no parameter at all (a
 * feature that does nothing — empty patterns list, no error).
 */
function extractRegistrarParamName(setup: ArrowFunction): string | undefined {
  const param: ParameterDeclaration | undefined = setup.getParameters()[0];
  if (!param) return undefined;
  return param.getName();
}

// =============================================================================
// Internal — walk + dispatch
// =============================================================================

/**
 * Walk the body of the setup callback and route every `<param>.<method>(...)`
 * call to the matching extractor. Helper functions / local variables /
 * imports are ignored.
 *
 * We rely on `getDescendantsOfKind` rather than walking only direct
 * children: the `r.*` API is always called on the registrar variable,
 * which the closure rules keep scoped to the setup callback. Nested
 * calls inside a writeHandler closure would not see `r` and therefore
 * cannot pose as feature-level patterns — collisions are
 * structurally impossible.
 */
function walkSetupCallback(
  setup: ArrowFunction,
  registrarParamName: string,
  sourceFile: SourceFile,
  patterns: FeaturePattern[],
  errors: ParseError[],
): void {
  const body = setup.getBody();
  for (const call of body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const methodName = extractRegistrarMethodName(call, registrarParamName);
    if (!methodName) continue; // Not a registrar call — ignore.
    const result = dispatchExtractor(methodName, call, sourceFile);
    if (result) patterns.push(result);
    // (errors path: filled in once concrete extractors land in C1.5)
    void errors;
  }
}

/**
 * Returns the method name when the call has the form
 * `<registrarParamName>.<method>(...)`, otherwise undefined.
 *
 * Reads the property-access expression on the call's left-hand side
 * and matches the receiver against the captured parameter name. Any
 * other shape (free function call, method call on something else)
 * returns undefined and is skipped by the walker.
 */
function extractRegistrarMethodName(
  call: CallExpression,
  registrarParamName: string,
): string | undefined {
  const expr = call.getExpression();
  const propAccess = expr.asKind(SyntaxKind.PropertyAccessExpression);
  if (!propAccess) return undefined;
  const receiver = propAccess.getExpression();
  if (receiver.getText() !== registrarParamName) return undefined;
  return propAccess.getName();
}

// =============================================================================
// Internal — pattern extractors (skeleton, implementation in C1.5)
// =============================================================================

/**
 * Route an `<r>.<method>(...)` call to its concrete extractor. New
 * r.* APIs → new case + new extractor + new pattern type in patterns.ts.
 * The discriminated union forces consumers (Designer, AI patcher) to
 * commit to the new kind via compile errors.
 *
 * Skeleton: every recognised method currently returns an UnknownPattern
 * with the right method name. C1.5 replaces the cases with concrete
 * extractors one at a time.
 */
function dispatchExtractor(
  methodName: string,
  call: CallExpression,
  sourceFile: SourceFile,
): FeaturePattern | undefined {
  switch (methodName) {
    // Static patterns — implementation order: simplest first
    case "entity":
    case "relation":
    case "nav":
    case "workspace":
    case "config":
    case "translations":
    case "requires":
    case "optionalRequires":
    case "systemScope":
    case "toggleable":
    case "metric":
    case "secret":
    case "claimKey":
    case "referenceData":
    case "readsConfig":
    case "useExtension":
    // Mixed patterns
    case "screen":
    case "writeHandler":
    case "queryHandler":
    case "hook":
    case "entityHook":
    case "job":
    case "notification":
    case "httpRoute":
    case "projection":
    case "multiStreamProjection":
    case "defineEvent":
    case "eventMigration":
    // Opaque patterns
    case "authClaims":
    case "extendsRegistrar":
      // TODO C1.5: replace with concrete extractor per case.
      return makeUnknownPattern(methodName, call, sourceFile);
    default:
      return makeUnknownPattern(methodName, call, sourceFile);
  }
}

function makeUnknownPattern(
  methodName: string,
  call: CallExpression,
  sourceFile: SourceFile,
): UnknownPattern {
  return {
    kind: "unknown",
    methodName,
    source: sourceLocationFromNode(call, sourceFile),
  };
}

// =============================================================================
// Internal — SourceLocation from ts-morph node
// =============================================================================

/**
 * Produce a SourceLocation from a ts-morph Node. ts-morph reports
 * 0-based positions; we convert to 1-based to match LSP / Monaco /
 * CodeMirror conventions.
 */
export function sourceLocationFromNode(node: Node, sourceFile: SourceFile): SourceLocation {
  const start = sourceFile.getLineAndColumnAtPos(node.getStart());
  const end = sourceFile.getLineAndColumnAtPos(node.getEnd());
  return {
    file: sourceFile.getFilePath(),
    start: { line: start.line, column: start.column },
    end: { line: end.line, column: end.column },
    raw: node.getText(),
  };
}
