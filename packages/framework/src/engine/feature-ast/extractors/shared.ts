import type { CallExpression, Node, ObjectLiteralExpression } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import { isPlainObject } from "../../../utils/is-plain-object";
import type { ParseError } from "../parse";

export type ExtractOutput<TPattern> =
  | { readonly kind: "pattern"; readonly pattern: TPattern }
  | { readonly kind: "error"; readonly error: ParseError };

export function ok<TPattern>(pattern: TPattern): ExtractOutput<TPattern> {
  return { kind: "pattern", pattern };
}

export function fail(
  methodName: string,
  source: ParseError["source"],
  reason: string,
): { readonly kind: "error"; readonly error: ParseError } {
  return { kind: "error", error: { methodName, source, reason } };
}

export function readStringLiteralArgs(call: CallExpression): readonly string[] | undefined {
  const out: string[] = [];
  for (const arg of call.getArguments()) {
    const literal = arg.asKind(SyntaxKind.StringLiteral);
    if (!literal) return undefined;
    out.push(literal.getLiteralValue());
  }
  return out;
}

export function readBooleanProperty(
  objectLiteral: Node,
  propertyName: string,
): boolean | undefined {
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
 * Marks a value the parser could not resolve into a literal (an Identifier
 * reference, a call expression, ...) while preserving its exact source text.
 * `renderValue` re-emits `__raw` verbatim instead of re-serializing the
 * value, so round-tripping a reference like `eventEntity` never expands it
 * into an inlined object literal.
 */
export type RawRefSentinel = { readonly __raw: string };

export function isRawRefSentinel(value: unknown): value is RawRefSentinel {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "__raw" in value &&
    typeof (value as { __raw: unknown }).__raw === "string"
  );
}

export function readDataLiteralNode(node: Node): unknown {
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
        if (!propAssign) return undefined;
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
    case SyntaxKind.Identifier:
    case SyntaxKind.CallExpression:
    case SyntaxKind.PropertyAccessExpression:
      // Unresolvable reference (const identifier, factory call, member access).
      // Keep the exact source text so renderValue can re-emit it verbatim —
      // resolving/inlining it would silently rewrite the source on the next
      // parse->render roundtrip (see readDataLiteralNode doc above).
      return { __raw: node.getText() } satisfies RawRefSentinel;
    default:
      return undefined;
  }
}

/**
 * A node's literal string value, or the raw-ref sentinel when it resolves to
 * an unresolvable identifier/factory-call/member-access (see
 * readDataLiteralNode). undefined for anything else (number, boolean, ...).
 */
export function readStringOrRaw(node: Node): string | RawRefSentinel | undefined {
  const value = readDataLiteralNode(node);
  if (typeof value === "string") return value;
  if (isRawRefSentinel(value)) return value;
  return undefined;
}

/**
 * Like readStringLiteralArgs, but an argument that resolves to a raw-ref
 * sentinel is kept as that sentinel instead of failing the whole call. Used
 * where a value stands in for a single name/key and inlining its resolved
 * string would corrupt the render roundtrip (e.g. `r.requires(someFeature.name)`
 * — see #1009).
 */
export function readStringOrRawArgs(
  call: CallExpression,
): readonly (string | RawRefSentinel)[] | undefined {
  const out: (string | RawRefSentinel)[] = [];
  for (const arg of call.getArguments()) {
    const value = readStringOrRaw(arg);
    if (value === undefined) return undefined;
    out.push(value);
  }
  return out;
}

export { isPlainObject } from "../../../utils/is-plain-object";

export function readPropertyKey(propAssign: import("ts-morph").PropertyAssignment): string {
  const nameNode = propAssign.getNameNode();
  const literal = nameNode.asKind(SyntaxKind.StringLiteral);
  if (literal) return literal.getLiteralValue();
  return propAssign.getName();
}

function unwrapLiteralInitializer(node: Node): string | undefined {
  const literal =
    node.asKind(SyntaxKind.StringLiteral) ?? node.asKind(SyntaxKind.NoSubstitutionTemplateLiteral);
  if (literal) return literal.getLiteralValue();
  const asExpr = node.asKind(SyntaxKind.AsExpression);
  if (asExpr) return unwrapLiteralInitializer(asExpr.getExpression());
  const satisfiesExpr = node.asKind(SyntaxKind.SatisfiesExpression);
  if (satisfiesExpr) return unwrapLiteralInitializer(satisfiesExpr.getExpression());
  const paren = node.asKind(SyntaxKind.ParenthesizedExpression);
  if (paren) return unwrapLiteralInitializer(paren.getExpression());
  return undefined;
}

/**
 * Resolves a bare Identifier to the string value of its declaration's
 * initializer (`export const EXT_TENANT_DATA = "tenant-data" as const`),
 * following imports via ts-morph's definition lookup — works across files
 * and packages against a real-filesystem Project (see #1008 precedent in
 * parse.ts). Only descends into VariableDeclaration initializers; a
 * function/class/type definition or an unresolvable import (external
 * package, ambient declaration) yields undefined, never a throw.
 */
function resolveIdentifierToStringLiteral(identifier: Node): string | undefined {
  const id = identifier.asKind(SyntaxKind.Identifier);
  if (!id) return undefined;
  let defs: readonly Node[];
  try {
    defs = id.getDefinitionNodes();
  } catch {
    return undefined;
  }
  for (const def of defs) {
    const init = def.asKind(SyntaxKind.VariableDeclaration)?.getInitializer();
    if (!init) continue;
    const value = unwrapLiteralInitializer(init);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Resolved name plus, when the source node was an identifier rather than
 * a string literal, the identifier's exact source text. Mirrors
 * `RawRefSentinel`'s round-trip contract: extractors that need to re-emit
 * the original reference (not its resolved value) keep `raw` alongside
 * `value`; extractors that only need the string keep using
 * `readNameLiteral`, which discards it.
 */
export type NameLiteralRef = { readonly value: string; readonly raw?: string };

/**
 * Like `readNameLiteral`, but for callers that must preserve an
 * identifier-authored name across a render → parse round-trip (see #2111).
 * `raw` is populated only when the node resolved via an identifier — a
 * string-literal node has nothing worth preserving beyond its value, and
 * setting `raw` for it too would make `JSON.stringify(value)` and
 * `node.getText()` diverge on quote style.
 */
export function readNameLiteralRef(node: Node): NameLiteralRef | undefined {
  const literal = node.asKind(SyntaxKind.StringLiteral);
  if (literal) return { value: literal.getLiteralValue() };
  const resolved = resolveIdentifierToStringLiteral(node);
  if (resolved === undefined) return undefined;
  return { value: resolved, raw: node.getText() };
}

/**
 * A node's string value when it's a string literal, or when it's a bare
 * Identifier that resolves to one via a `const X = "..."` declaration
 * (same-file or imported) — the pattern used throughout the framework's
 * own bundled-features for registrar-call names (`EXT_TENANT_DATA`,
 * `TENANT_SECRET_READ_EVENT`, ...) instead of repeating string literals.
 * undefined for anything unresolvable (factory call, member access,
 * external/ambient identifier) — callers keep their existing ParseError
 * fallback, no crash. Discards the original identifier text; use
 * `readNameLiteralRef` when the caller must preserve it for rendering.
 */
export function readNameLiteral(node: Node): string | undefined {
  return readNameLiteralRef(node)?.value;
}

export function readNameOrRef(node: Node): string | undefined {
  const literal = readNameLiteral(node);
  if (literal !== undefined) return literal;
  const obj = readDataLiteralNode(node);
  if (isPlainObject(obj) && typeof obj["name"] === "string") return obj["name"];
  return undefined;
}

/** Resolve an inline object literal or a same-file `const` that initializes to one. */
export function resolveSameFileObjectLiteral(node: Node): ObjectLiteralExpression | undefined {
  const direct = node.asKind(SyntaxKind.ObjectLiteralExpression);
  if (direct) return direct;
  const identifier = node.asKind(SyntaxKind.Identifier);
  if (!identifier) return undefined;
  const valueDecl = identifier.getSymbol()?.getValueDeclaration();
  const fromSymbol = valueDecl?.asKind(SyntaxKind.VariableDeclaration);
  const varDecl = fromSymbol ?? node.getSourceFile().getVariableDeclaration(identifier.getText());
  return varDecl?.getInitializer()?.asKind(SyntaxKind.ObjectLiteralExpression);
}

export function readObjectPropertyInitializer(
  obj: ObjectLiteralExpression,
  propertyName: string,
): import("ts-morph").Expression | undefined {
  const prop = obj.getProperty(propertyName);
  if (!prop) return undefined;
  const assign = prop.asKind(SyntaxKind.PropertyAssignment);
  if (assign) return assign.getInitializer();
  const shorthand = prop.asKind(SyntaxKind.ShorthandPropertyAssignment);
  if (shorthand) return shorthand.getNameNode();
  return undefined;
}

export function findFunctionLiteral(node: Node): Node | undefined {
  if (node.getKind() === SyntaxKind.ArrowFunction) return node;
  if (node.getKind() === SyntaxKind.FunctionExpression) return node;
  const paren = node.asKind(SyntaxKind.ParenthesizedExpression);
  if (paren) return findFunctionLiteral(paren.getExpression());
  return undefined;
}

export function readNameOrRefOrList(node: Node): string | readonly string[] | undefined {
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

export function readVarargsOrArrayProp(
  call: CallExpression,
  arrayPropName: "features" | "keys",
): readonly (string | RawRefSentinel)[] | undefined {
  const args = call.getArguments();
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
        const out: (string | RawRefSentinel)[] = [];
        for (const el of arr.getElements()) {
          const value = readStringOrRaw(el);
          if (value === undefined) return undefined;
          out.push(value);
        }
        return out;
      }
    }
  }
  return readStringOrRawArgs(call);
}
