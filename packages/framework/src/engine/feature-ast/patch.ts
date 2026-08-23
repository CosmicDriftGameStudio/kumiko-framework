// Patch operations: apply add/replace/remove changes to a feature-file's
// SourceFile in-place, working at the r.*-call granularity. Custom code
// (helpers, comments, imports, anything between calls) survives every
// patch unchanged — the patcher only touches the spans it owns.
//
// **Identity model — Natural-Key:** patterns are addressed by the
// human-readable name they carry: entity-name, handler-name, nav-id,
// hook-target+type, etc. Reorders and re-renderings don't break IDs;
// renames are explicit (remove old → add new). For the few singleton
// patterns (toggleable, requires, systemScope) the kind itself is the
// key — a feature has at most one of each.
//
// **Position semantics:**
//   - addPattern → appended at the end of the setup callback
//   - replacePattern → in place, same indentation as the original call
//   - removePattern → call + leading blank-line whitespace gone
//
// **Renderer-driven output.** Every pattern lands in canonical Object-
// Form (single-arg literal, see render.ts). Existing patterns in legacy
// positional form get converted on replace; new patterns start
// canonical. Schema-Version-Header is the renderer's responsibility.
//
// **Comment-Preservation — known limitation.** Inline comments INSIDE a
// pattern (e.g. `// reason: legacy field` on an entity field property)
// are LOST on replace, because the renderer regenerates the call from
// the parsed FeaturePattern, which doesn't carry comment-trivia.
// Comments BETWEEN patterns (helper-functions, top-of-feature notes,
// imports) survive every patch — only comments authored on lines the
// patcher rewrites are dropped. Tracked as a future-work item: see
// roadmap C-Notes for the canonical-comment-attach Pattern that would
// preserve prefixed `// kumiko-comment:` markers across roundtrips.

import type { ObjectLiteralExpression } from "ts-morph";
import { type CallExpression, type Node, type SourceFile, SyntaxKind } from "ts-morph";
import { readNameLiteral, readNameOrRef } from "./extractors/shared";
import type { FeaturePattern, FeaturePatternKind } from "./patterns";
import { indent, PATTERN_INDENT, renderPattern } from "./render";

// =============================================================================
// PatternId — natural-key per pattern kind
// =============================================================================

/**
 * Identifier used by replace/remove. Discriminated union: each pattern
 * kind names the property the patcher must match against. Adding a new
 * pattern kind requires a new entry here so the type system forces the
 * call-site to think about identity (or fall through to "first call of
 * this kind" via the singleton helpers below).
 */
export type PatternId =
  | { readonly kind: "entity"; readonly entityName: string }
  | { readonly kind: "relation"; readonly entityName: string; readonly relationName: string }
  | { readonly kind: "nav"; readonly id: string }
  | { readonly kind: "workspace"; readonly id: string }
  | { readonly kind: "screen"; readonly id: string }
  | { readonly kind: "writeHandler"; readonly handlerName: string }
  | { readonly kind: "queryHandler"; readonly handlerName: string }
  | { readonly kind: "streamHandler"; readonly handlerName: string }
  | {
      readonly kind: "hook";
      readonly hookType: string;
      readonly target: string | { readonly allOf: string };
    }
  | { readonly kind: "metric"; readonly shortName: string }
  | { readonly kind: "secret"; readonly shortName: string }
  | { readonly kind: "claimKey"; readonly shortName: string }
  | { readonly kind: "referenceData"; readonly entityName: string }
  | { readonly kind: "useExtension"; readonly extensionName: string; readonly entityName: string }
  | { readonly kind: "job"; readonly jobName: string }
  | { readonly kind: "notification"; readonly notificationName: string }
  | { readonly kind: "httpRoute"; readonly method: string; readonly path: string }
  | { readonly kind: "projection"; readonly name: string }
  | { readonly kind: "multiStreamProjection"; readonly name: string }
  | { readonly kind: "defineEvent"; readonly eventName: string }
  | { readonly kind: "extendsRegistrar"; readonly extensionName: string }
  | { readonly kind: "ai.generate"; readonly stepKey: string }
  | { readonly kind: "ai.extract"; readonly stepKey: string }
  | { readonly kind: "ai.classify"; readonly stepKey: string }
  // Singleton patterns — only one per feature, kind alone identifies them.
  | { readonly kind: "requires" }
  | { readonly kind: "optionalRequires" }
  | { readonly kind: "readsConfig" }
  | { readonly kind: "systemScope" }
  | { readonly kind: "toggleable" }
  | { readonly kind: "describe" }
  | { readonly kind: "uiHints" }
  | { readonly kind: "config" }
  | { readonly kind: "translations" }
  | { readonly kind: "authClaims" }
  | { readonly kind: "treeActions" };

// =============================================================================
// Change ops — generic apply API
// =============================================================================

export type PatternChange =
  | { readonly op: "add"; readonly pattern: FeaturePattern }
  | { readonly op: "replace"; readonly id: PatternId; readonly pattern: FeaturePattern }
  | { readonly op: "remove"; readonly id: PatternId };

/**
 * Apply a sequence of changes to the source file in-place. The list is
 * processed in order; replace/remove failures (id not found) throw so
 * callers can react explicitly — silent no-ops would mask design bugs
 * in the Designer/AI generator. Adds always succeed.
 *
 * The function does NOT save the file — `sourceFile.saveSync()` (or the
 * caller's persistence layer) is expected to follow.
 */
export function applyChanges(sourceFile: SourceFile, changes: readonly PatternChange[]): void {
  for (const change of changes) {
    switch (change.op) {
      case "add":
        addPattern(sourceFile, change.pattern);
        break;
      case "replace":
        replacePattern(sourceFile, change.id, change.pattern);
        break;
      case "remove":
        removePattern(sourceFile, change.id);
        break;
      default: {
        const _exhaustive: never = change;
        throw new Error(`applyChanges: unknown op ${String(_exhaustive)}`);
      }
    }
  }
}

// =============================================================================
// Add
// =============================================================================

/**
 * Low-level escape hatch: append a hand-built FeaturePattern at the end
 * of the setup callback's body. **Prefer the typed `add{Kind}` methods
 * on `createFeaturePatcher(sf)`** — they take natural args, build the
 * FeaturePattern internally, and avoid SourceLocation boilerplate.
 *
 * Use this directly when:
 *   - Migrating a parsed pattern from another file (already-built
 *     FeaturePattern object on hand)
 *   - The pattern kind isn't yet covered by a typed `add{Kind}`
 *
 * The pattern is rendered (canonical Object-Form) and inserted as the
 * last statement, separated from the previous one by a blank line —
 * biome-stable formatting that matches the renderFeatureFile output.
 */
export function addPattern(sourceFile: SourceFile, pattern: FeaturePattern): void {
  const setup = findSetupCallback(sourceFile);
  if (!setup) {
    throw new Error("addPattern: no defineFeature(name, (r) => { ... }) call found");
  }
  const body = setup.body;
  const rendered = indent(renderPattern(pattern), PATTERN_INDENT);

  // Find the closing brace of the body to insert just before it. The body
  // is a Block; its last child is the close-brace, so the safe insertion
  // point is the position of the close-brace (insertText pushes it down).
  const closeBracePos = body.getEnd() - 1; // `}`
  const lastStatement = lastNonTriviaChild(body);
  // If the body has at least one statement, prefix with a blank line so
  // every pattern is visually separated. For an empty setup callback,
  // skip the leading newline so the first statement isn't preceded by a
  // gratuitous blank line.
  const needsLeadingBlank = lastStatement !== undefined;
  const text = needsLeadingBlank ? `\n${rendered}\n` : `${rendered}\n`;
  sourceFile.insertText(closeBracePos, text);
}

// =============================================================================
// Replace
// =============================================================================

/**
 * Find the call matching `id` and replace the entire CallExpression text
 * with the rendered version of `pattern`. The replacement is reindented
 * to match the original call's column so existing helpers/comments
 * around it stay aligned. Throws when no call matches — callers must
 * handle that case explicitly.
 */
export function replacePattern(
  sourceFile: SourceFile,
  id: PatternId,
  pattern: FeaturePattern,
): void {
  const call = findCallForId(sourceFile, id);
  if (!call) {
    throw new Error(`replacePattern: no call found for ${describeId(id)}`);
  }

  // Whole call-statement spans from the CallExpression's start through
  // its enclosing ExpressionStatement (which carries the trailing `;`).
  const enclosingStatement = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
  const startNode = enclosingStatement ?? call;

  const startPos = startNode.getStart();
  const endPos = startNode.getEnd();

  // Detect column of the original call's first non-whitespace character;
  // the rendered pattern starts at column 0 and gets indented to match.
  const startLineCol = sourceFile.getLineAndColumnAtPos(startPos);
  const originalIndent = " ".repeat(Math.max(0, startLineCol.column - 1));
  const rendered = indent(renderPattern(pattern), originalIndent).trimStart();

  sourceFile.replaceText([startPos, endPos], rendered);
}

// =============================================================================
// Remove
// =============================================================================

/**
 * Find the call matching `id` and remove it together with its trailing
 * newline. Comments belonging to the pattern are unaffected only when
 * they live BEFORE the call as line-leading trivia — those leading
 * comments are kept (they may belong to surrounding code, the patcher
 * can't disambiguate without semantic markers). Inline comments on the
 * same line as the call are removed with the call.
 */
export function removePattern(sourceFile: SourceFile, id: PatternId): void {
  const call = findCallForId(sourceFile, id);
  if (!call) {
    throw new Error(`removePattern: no call found for ${describeId(id)}`);
  }
  const enclosingStatement = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement);
  const target = enclosingStatement ?? call;

  // Erase from the start of the line containing the statement (so leading
  // indentation goes with it) through the trailing newline, including the
  // *leading* blank line that addPattern emits — keeps blank-line counts
  // stable under add → remove cycles. We don't touch leading comments.
  const startPos = lineStart(sourceFile, target.getStart());
  const endPos = lineEnd(sourceFile, target.getEnd());

  // Collapse a preceding blank line if there is one (avoids a double
  // blank line between the now-adjacent statements).
  const collapseStart = collapsePrecedingBlankLine(sourceFile, startPos);
  sourceFile.replaceText([collapseStart, endPos + 1], "");
}

// =============================================================================
// Lookup
// =============================================================================

function findSetupCallback(
  sourceFile: SourceFile,
): { call: CallExpression; body: Node } | undefined {
  for (const stmt of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (stmt.getExpression().getText() !== "defineFeature") continue;
    const setupArg = stmt.getArguments()[1];
    if (!setupArg) continue;
    const arrow = setupArg.asKind(SyntaxKind.ArrowFunction);
    if (!arrow) continue;
    return { call: stmt, body: arrow.getBody() };
  }
  return undefined;
}

/**
 * Singleton kinds: a feature has at most one of each. The Boot-Validator
 * rejects features that declare two `r.requires(...)` etc. — the patcher
 * asserts the same invariant so a corrupt source file produces an
 * explicit error here, not a silent first-match win.
 *
 * Exported so the pattern-library tests + downstream consumers
 * (Designer, AI-Builder) share one source-of-truth — duplicating this
 * set would let the library's `singleton: true` flags drift silently
 * from the patcher's enforcement.
 */
export const SINGLETON_KINDS: ReadonlySet<PatternId["kind"]> = new Set([
  "requires",
  "optionalRequires",
  "readsConfig",
  "systemScope",
  "toggleable",
  "describe",
  "uiHints",
  "config",
  "translations",
  "authClaims",
  // Tree-Actions slot — at-most-one per feature, mirrors the registrar's
  // only-once-guard in define-feature.ts.
  "treeActions",
]);

/**
 * Return the CallExpression in the setup callback whose call shape
 * matches the given id. Reads the call arguments structurally — same
 * paths the parser walks, no re-parsing through extractors.ts (would
 * be redundant work).
 *
 * For singleton kinds (requires, toggleable, etc.) the patcher
 * additionally asserts that the file contains AT MOST one matching
 * call. Two calls of the same singleton kind would let the first-match
 * silently win; we'd rather throw so Designer/AI surfacing the corrupt
 * feature can fix it explicitly.
 */
function findCallForId(sourceFile: SourceFile, id: PatternId): CallExpression | undefined {
  if (id.kind === "ai.generate" || id.kind === "ai.extract" || id.kind === "ai.classify") {
    return findAiStepCall(sourceFile, id);
  }
  const setup = findSetupCallback(sourceFile);
  if (!setup) return undefined;
  const registrarParam = setup.call
    .getArguments()[1]
    ?.asKind(SyntaxKind.ArrowFunction)
    ?.getParameters()[0]
    ?.getName();
  if (!registrarParam) return undefined;

  const matches: CallExpression[] = [];
  for (const call of setup.body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const propAccess = call.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
    if (!propAccess) continue;
    if (propAccess.getExpression().getText() !== registrarParam) continue;
    if (propAccess.getName() !== id.kind) continue;
    if (callMatchesId(call, id)) matches.push(call);
  }

  if (SINGLETON_KINDS.has(id.kind) && matches.length > 1) {
    throw new Error(
      `findCallForId: ${id.kind} is a singleton but ${matches.length} calls were found — feature file is corrupt`,
    );
  }
  return matches[0];
}

const AI_STEP_FACTORY: Readonly<Record<"ai.generate" | "ai.extract" | "ai.classify", string>> = {
  "ai.generate": "aiGenerateStep",
  "ai.extract": "aiExtractStep",
  "ai.classify": "aiClassifyStep",
};

function resolveSameFileObjectLiteral(
  node: import("ts-morph").Node,
): ObjectLiteralExpression | undefined {
  const direct = node.asKind(SyntaxKind.ObjectLiteralExpression);
  if (direct) return direct;
  const identifier = node.asKind(SyntaxKind.Identifier);
  if (!identifier) return undefined;
  const varDecl = node.getSourceFile().getVariableDeclaration(identifier.getText());
  return varDecl?.getInitializer()?.asKind(SyntaxKind.ObjectLiteralExpression);
}

function readAiStepKey(call: CallExpression): string | undefined {
  const arg = call.getArguments()[0];
  if (!arg) return undefined;
  const obj = resolveSameFileObjectLiteral(arg);
  if (!obj) return undefined;
  const init = obj.getProperty("stepKey")?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
  if (!init) return undefined;
  return readNameLiteral(init);
}

function findAiStepCall(sourceFile: SourceFile, id: PatternId): CallExpression | undefined {
  if (id.kind !== "ai.generate" && id.kind !== "ai.extract" && id.kind !== "ai.classify") {
    return undefined;
  }
  const factory = AI_STEP_FACTORY[id.kind];
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getText() !== factory) continue;
    if (callMatchesId(call, id)) return call;
  }
  return undefined;
}

function callMatchesId(call: CallExpression, id: PatternId): boolean {
  switch (id.kind) {
    // Singletons: kind alone identifies the call.
    case "requires":
    case "optionalRequires":
    case "readsConfig":
    case "systemScope":
    case "toggleable":
    case "describe":
    case "uiHints":
    case "config":
    case "translations":
    case "authClaims":
    case "treeActions":
      return true;

    case "entity":
      return (
        matchFirstArgString(call, id.entityName) || matchObjectProperty(call, "name", id.entityName)
      );
    case "relation":
      // Positional: r.relation(entity, name, def) | Object: { entity, name, ... }
      if (matchFirstArgString(call, id.entityName)) {
        return matchArgString(call, 1, id.relationName);
      }
      return (
        matchObjectProperty(call, "entity", id.entityName) &&
        matchObjectProperty(call, "name", id.relationName)
      );
    case "nav":
    case "workspace":
    case "screen":
      return matchObjectProperty(call, "id", id.id);
    case "writeHandler":
    case "queryHandler":
    case "streamHandler":
      return (
        matchFirstArgString(call, id.handlerName) ||
        matchObjectProperty(call, "name", id.handlerName)
      );
    case "hook":
      // Positional: r.hook(type, target, fn) | Object: { type, target }
      if (typeof id.target === "object") {
        // Entity-wide { allOf } target — only ever appears as the object
        // literal { allOf: entity } (positional or nested in the object
        // form), never as a bare string, so check both call shapes.
        if (matchFirstArgString(call, id.hookType)) {
          return matchAllOfArg(call.getArguments()[1], id.target.allOf);
        }
        return (
          matchObjectProperty(call, "type", id.hookType) &&
          matchObjectAllOfProperty(call, "target", id.target.allOf)
        );
      }
      if (matchFirstArgString(call, id.hookType)) {
        return matchArgNameOrRef(call, 1, id.target);
      }
      return (
        matchObjectProperty(call, "type", id.hookType) &&
        matchObjectProperty(call, "target", id.target)
      );
    case "metric":
    case "secret":
    case "claimKey":
      return (
        matchFirstArgString(call, id.shortName) || matchObjectProperty(call, "name", id.shortName)
      );
    case "referenceData":
      return (
        matchFirstArgString(call, id.entityName) ||
        matchObjectProperty(call, "entity", id.entityName)
      );
    case "useExtension":
      // Positional: r.useExtension(name, entity) | Object: { name, entity }
      if (matchFirstArgString(call, id.extensionName)) {
        return matchArgNameOrRef(call, 1, id.entityName);
      }
      return (
        matchObjectProperty(call, "name", id.extensionName) &&
        matchObjectProperty(call, "entity", id.entityName)
      );
    case "job":
      return matchFirstArgString(call, id.jobName) || matchObjectProperty(call, "name", id.jobName);
    case "notification":
      return (
        matchFirstArgString(call, id.notificationName) ||
        matchObjectProperty(call, "name", id.notificationName)
      );
    case "httpRoute":
      // Object form only; positional doesn't apply.
      return (
        matchObjectProperty(call, "method", id.method) && matchObjectProperty(call, "path", id.path)
      );
    case "projection":
    case "multiStreamProjection":
      return matchObjectProperty(call, "name", id.name);
    case "defineEvent":
      return (
        matchFirstArgString(call, id.eventName) || matchObjectProperty(call, "name", id.eventName)
      );
    case "extendsRegistrar":
      return matchFirstArgString(call, id.extensionName);
    case "ai.generate":
    case "ai.extract":
    case "ai.classify":
      return readAiStepKey(call) === id.stepKey;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

// Resolves an argument the same way the extractors do (readNameLiteral):
// a string literal directly, or a bare identifier following its
// declaration (same-file or imported) to a string-literal initializer —
// the dominant naming style in the framework's own bundled-features
// (`r.entity(ENTITY, ...)`, `r.useExtension(EXT_X, ...)`, see #1746).
//
// Narrow on purpose: every kind's arg-0 (and relation's arg-1) is parsed
// via readNameLiteral, never readNameOrRef (see round2.ts/round3.ts) —
// widening this shared helper to readNameOrRef would let an object-form
// call's first argument (an ObjectLiteralExpression) match here too,
// short-circuiting the object-form branch in callMatchesId. Positions
// where the parser itself accepts an inline `{ name: "..." }` ref use
// `matchArgNameOrRef` below instead.
function matchArgString(call: CallExpression, index: number, expected: string): boolean {
  const arg = call.getArguments()[index];
  if (!arg) return false;
  return readNameLiteral(arg) === expected;
}

function matchFirstArgString(call: CallExpression, expected: string): boolean {
  return matchArgString(call, 0, expected);
}

// Like matchArgString, but via readNameOrRef — for the specific positional
// slots where the parser accepts an inline `{ name: "..." }` object ref in
// addition to a literal/identifier (useExtension's entity arg, hook's
// target arg; see round3.ts:445 / hooks.ts:75). Not a drop-in replacement
// for matchArgString: applying it to an arg-0 position would match an
// object-form call's first (and only) argument, see the comment above.
function matchArgNameOrRef(call: CallExpression, index: number, expected: string): boolean {
  const arg = call.getArguments()[index];
  if (!arg) return false;
  return readNameOrRef(arg) === expected;
}

// Object-form property values are resolved via readNameOrRef, not the
// narrower readNameLiteral — some properties (useExtension's `entity`,
// hook's `target`/`allOf`) accept an inline `{ name: "..." }` ref in the
// parser (see extractors/round3.ts, extractors/hooks.ts), not just a
// literal or identifier. readNameOrRef is a superset of readNameLiteral,
// so this is safe for every other property too.
function matchObjectProperty(call: CallExpression, propName: string, expected: string): boolean {
  const obj = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj) return false;
  const init = obj.getProperty(propName)?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
  if (!init) return false;
  return readNameOrRef(init) === expected;
}

// Matches an r.hook `{ allOf: entity }` target — as the arg node directly
// (positional call form) or as a nested object property (object call form).
function matchAllOfArg(node: Node | undefined, expectedEntity: string): boolean {
  const obj = node?.asKind(SyntaxKind.ObjectLiteralExpression);
  const init = obj?.getProperty("allOf")?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
  if (!init) return false;
  return readNameOrRef(init) === expectedEntity;
}

function matchObjectAllOfProperty(
  call: CallExpression,
  propName: string,
  expectedEntity: string,
): boolean {
  const obj = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  const propInit = obj
    ?.getProperty(propName)
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  return matchAllOfArg(propInit, expectedEntity);
}

// =============================================================================
// Format helpers — line boundaries / blank-line collapse
// (indent / PATTERN_INDENT live in render.ts and are imported above.)
// =============================================================================

function lastNonTriviaChild(body: Node): Node | undefined {
  // Block nodes have child[0] = `{`, last = `}`. Find the last
  // SyntaxList element that's an actual statement — that signals
  // whether the body is empty for blank-line decisions.
  if (!body.isKind(SyntaxKind.Block)) return undefined;
  const statements = body.getStatements();
  return statements[statements.length - 1];
}

function lineStart(sourceFile: SourceFile, pos: number): number {
  const text = sourceFile.getFullText();
  let i = pos;
  while (i > 0 && text[i - 1] !== "\n") i--;
  return i;
}

function lineEnd(sourceFile: SourceFile, pos: number): number {
  const text = sourceFile.getFullText();
  let i = pos;
  while (i < text.length && text[i] !== "\n") i++;
  return i;
}

function collapsePrecedingBlankLine(sourceFile: SourceFile, startPos: number): number {
  // If the line preceding `startPos` is empty (only whitespace), include
  // it in the deletion range so add → remove leaves a clean file.
  const text = sourceFile.getFullText();
  if (startPos < 2) return startPos;
  const i = startPos - 1; // \n at end of previous line
  if (text[i] !== "\n") return startPos;
  let j = i - 1;
  while (j >= 0 && text[j] !== "\n" && (text[j] === " " || text[j] === "\t")) j--;
  if (j < 0 || text[j] === "\n") {
    // Found an empty (whitespace-only) preceding line — include its
    // newline in the deletion span.
    return j + 1;
  }
  return startPos;
}

// Used only in error messages — stringifies kind + identifying fields
// in a `kind(field=value, ...)` shape for at-a-glance debugging.
function describeId(id: PatternId): string {
  const fields = Object.entries(id as Readonly<Record<string, unknown>>)
    .filter(([key]) => key !== "kind")
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
  return `${id.kind as FeaturePatternKind}(${fields})`;
}
