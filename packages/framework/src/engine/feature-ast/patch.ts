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

import { type CallExpression, Node, type SourceFile, SyntaxKind } from "ts-morph";
import type { FeaturePattern, FeaturePatternKind } from "./patterns";
import { renderPattern } from "./render";

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
  | { readonly kind: "hook"; readonly hookType: string; readonly target: string }
  | { readonly kind: "entityHook"; readonly hookType: string; readonly entityName: string }
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
  | {
      readonly kind: "eventMigration";
      readonly eventName: string;
      readonly fromVersion: number;
      readonly toVersion: number;
    }
  | { readonly kind: "extendsRegistrar"; readonly extensionName: string }
  // Singleton patterns — only one per feature, kind alone identifies them.
  | { readonly kind: "requires" }
  | { readonly kind: "optionalRequires" }
  | { readonly kind: "readsConfig" }
  | { readonly kind: "systemScope" }
  | { readonly kind: "toggleable" }
  | { readonly kind: "config" }
  | { readonly kind: "translations" }
  | { readonly kind: "authClaims" };

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
export function applyChanges(
  sourceFile: SourceFile,
  changes: readonly PatternChange[],
): void {
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
 * Append a new r.*-call at the end of the setup callback's body. The
 * pattern is rendered (canonical Object-Form) and inserted as the last
 * statement, separated from the previous one by a blank line — biome-
 * stable formatting that matches the renderFeatureFile output.
 */
export function addPattern(sourceFile: SourceFile, pattern: FeaturePattern): void {
  const setup = findSetupCallback(sourceFile);
  if (!setup) {
    throw new Error("addPattern: no defineFeature(name, (r) => { ... }) call found");
  }
  const body = setup.body;
  const indent = "  "; // Inside `defineFeature((r) => {…})`, statements live at one-level indent.
  const rendered = indentBlock(renderPattern(pattern), indent);

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
  const rendered = indentBlock(renderPattern(pattern), originalIndent).trimStart();

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
 * Return the CallExpression in the setup callback whose call shape
 * matches the given id. Reads the call arguments structurally — same
 * paths the parser walks, no re-parsing through extractors.ts (would
 * be redundant work).
 */
function findCallForId(sourceFile: SourceFile, id: PatternId): CallExpression | undefined {
  const setup = findSetupCallback(sourceFile);
  if (!setup) return undefined;
  const registrarParam = setup.call
    .getArguments()[1]
    ?.asKind(SyntaxKind.ArrowFunction)
    ?.getParameters()[0]
    ?.getName();
  if (!registrarParam) return undefined;

  for (const call of setup.body.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const propAccess = call.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
    if (!propAccess) continue;
    if (propAccess.getExpression().getText() !== registrarParam) continue;
    if (propAccess.getName() !== id.kind) continue;
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
    case "config":
    case "translations":
    case "authClaims":
      return true;

    case "entity":
      return matchFirstArgString(call, id.entityName) || matchObjectProperty(call, "name", id.entityName);
    case "relation":
      // Positional: r.relation(entity, name, def) | Object: { entity, name, ... }
      if (matchFirstArgString(call, id.entityName)) {
        const second = call.getArguments()[1]?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
        return second === id.relationName;
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
      return matchFirstArgString(call, id.handlerName) || matchObjectProperty(call, "name", id.handlerName);
    case "hook":
      // Positional: r.hook(type, target, fn) | Object: { type, target }
      if (matchFirstArgString(call, id.hookType)) {
        const target = call.getArguments()[1]?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
        return target === id.target;
      }
      return (
        matchObjectProperty(call, "type", id.hookType) &&
        matchObjectProperty(call, "target", id.target)
      );
    case "entityHook":
      if (matchFirstArgString(call, id.hookType)) {
        const ent = call.getArguments()[1]?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
        return ent === id.entityName;
      }
      return (
        matchObjectProperty(call, "type", id.hookType) &&
        matchObjectProperty(call, "entity", id.entityName)
      );
    case "metric":
    case "secret":
    case "claimKey":
      return matchFirstArgString(call, id.shortName) || matchObjectProperty(call, "name", id.shortName);
    case "referenceData":
      return matchFirstArgString(call, id.entityName) || matchObjectProperty(call, "entity", id.entityName);
    case "useExtension":
      // Positional: r.useExtension(name, entity) | Object: { name, entity }
      if (matchFirstArgString(call, id.extensionName)) {
        const ent = call.getArguments()[1]?.asKind(SyntaxKind.StringLiteral)?.getLiteralValue();
        return ent === id.entityName;
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
        matchObjectProperty(call, "method", id.method) &&
        matchObjectProperty(call, "path", id.path)
      );
    case "projection":
    case "multiStreamProjection":
      return matchObjectProperty(call, "name", id.name);
    case "defineEvent":
      return matchFirstArgString(call, id.eventName) || matchObjectProperty(call, "name", id.eventName);
    case "eventMigration": {
      // Positional: r.eventMigration(name, from, to, fn)
      if (matchFirstArgString(call, id.eventName)) {
        const from = numericArg(call, 1);
        const to = numericArg(call, 2);
        return from === id.fromVersion && to === id.toVersion;
      }
      // Object: { event, fromVersion, toVersion }
      return (
        matchObjectProperty(call, "event", id.eventName) &&
        matchObjectNumericProperty(call, "fromVersion", id.fromVersion) &&
        matchObjectNumericProperty(call, "toVersion", id.toVersion)
      );
    }
    case "extendsRegistrar":
      return matchFirstArgString(call, id.extensionName);
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

function matchFirstArgString(call: CallExpression, expected: string): boolean {
  const first = call.getArguments()[0];
  const lit = first?.asKind(SyntaxKind.StringLiteral);
  return lit?.getLiteralValue() === expected;
}

function matchObjectProperty(call: CallExpression, propName: string, expected: string): boolean {
  const obj = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj) return false;
  const init = obj
    .getProperty(propName)
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  return init?.getLiteralValue() === expected;
}

function matchObjectNumericProperty(
  call: CallExpression,
  propName: string,
  expected: number,
): boolean {
  const obj = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj) return false;
  const init = obj
    .getProperty(propName)
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.NumericLiteral);
  return init !== undefined && Number(init.getText()) === expected;
}

function numericArg(call: CallExpression, idx: number): number | undefined {
  const lit = call.getArguments()[idx]?.asKind(SyntaxKind.NumericLiteral);
  if (!lit) return undefined;
  return Number(lit.getText());
}

// =============================================================================
// Format helpers — indent / line boundaries / blank-line collapse
// =============================================================================

function indentBlock(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => (line.length === 0 ? line : prefix + line))
    .join("\n");
}

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
  let i = startPos - 1; // \n at end of previous line
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

function describeId(id: PatternId): string {
  const k = id.kind as FeaturePatternKind;
  // Stringify the discriminator + identifying fields. Used only for
  // error messages, so cheap JSON is fine.
  const { kind: _, ...rest } = id as Record<string, unknown> & { kind: string };
  return `${k}(${Object.entries(rest)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ")})`;
}
