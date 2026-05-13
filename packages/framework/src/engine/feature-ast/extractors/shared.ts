import type { CallExpression, Node } from "ts-morph";
import { SyntaxKind } from "ts-morph";
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
    default:
      return undefined;
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPropertyKey(propAssign: import("ts-morph").PropertyAssignment): string {
  const nameNode = propAssign.getNameNode();
  const literal = nameNode.asKind(SyntaxKind.StringLiteral);
  if (literal) return literal.getLiteralValue();
  return propAssign.getName();
}

export function readNameOrRef(node: Node): string | undefined {
  const literal = node.asKind(SyntaxKind.StringLiteral);
  if (literal) return literal.getLiteralValue();
  const obj = readDataLiteralNode(node);
  if (isPlainObject(obj) && typeof obj["name"] === "string") return obj["name"];
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
): readonly string[] | undefined {
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
  return readStringLiteralArgs(call);
}
