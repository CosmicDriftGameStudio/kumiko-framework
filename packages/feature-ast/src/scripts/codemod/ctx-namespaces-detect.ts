import { type Symbol as MorphSymbol, Node, SyntaxKind, type Type } from "ts-morph";
import {
  type ContextKind,
  isMovedMemberName,
  moveOf,
  type NamespacePath,
  samePath,
} from "./ctx-namespaces-mapping.ts";

const CONTEXT_ALIAS_KINDS: ReadonlyMap<string, ContextKind> = new Map([
  ["HandlerContext", "handler"],
  ["ReservationContext", "handler"],
  ["BeforeTransactionContext", "handler"],
  ["JobContext", "job"],
]);

// Present on the context aliases in the old and the new shape; AppContext declares db/registry
// too, but inside its own alias, so it never classifies as a handler context.
const KIND_PROBE_PROPERTIES: readonly string[] = ["registry", "db", "events", "dispatch", "obs"];

const RECEIVER_NAME = /^(ctx|context)$/;

export type Receiver =
  | { readonly kind: "none" }
  | { readonly kind: "unresolved" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "context"; readonly contexts: readonly ContextKind[] };

export type MoveDecision =
  | { readonly status: "untouched" }
  | { readonly status: "move"; readonly path: NamespacePath }
  | { readonly status: "manual"; readonly reason: string };

const UNTOUCHED: MoveDecision = { status: "untouched" };

function isKumikoTypesFile(path: string): boolean {
  return path.includes("kumiko-types") || path.includes("packages/types/src");
}

function aliasContextKind(node: Node): ContextKind | undefined {
  if (!isKumikoTypesFile(node.getSourceFile().getFilePath())) return undefined;
  const alias = Node.isTypeAliasDeclaration(node)
    ? node
    : node.getFirstAncestorByKind(SyntaxKind.TypeAliasDeclaration);
  return alias === undefined ? undefined : CONTEXT_ALIAS_KINDS.get(alias.getName());
}

function declaredContextKind(symbol: MorphSymbol | undefined): ContextKind | undefined {
  for (const declaration of symbol?.getDeclarations() ?? []) {
    const kind = aliasContextKind(declaration);
    if (kind !== undefined) return kind;
  }
  return undefined;
}

export function contextKindOfAlias(type: Type): ContextKind | undefined {
  const declaration = type.getAliasSymbol()?.getDeclarations()[0];
  return declaration === undefined ? undefined : aliasContextKind(declaration);
}

function classifyConstituent(
  type: Type,
  memberName: string | undefined,
): ContextKind | "other" | "unresolved" {
  if (type.isAny() || type.isUnknown()) return "unresolved";
  const apparent = type.getApparentType();
  const direct =
    memberName === undefined ? undefined : declaredContextKind(apparent.getProperty(memberName));
  if (direct !== undefined) return direct;
  for (const probe of KIND_PROBE_PROPERTIES) {
    const kind = declaredContextKind(apparent.getProperty(probe));
    if (kind !== undefined) return kind;
  }
  return "other";
}

export function receiverOf(type: Type, memberName?: string, pickedKind?: ContextKind): Receiver {
  const resolved = resolveReceiver(type, memberName);
  return pickedKind !== undefined && (resolved.kind === "none" || resolved.kind === "unresolved")
    ? { kind: "context", contexts: [pickedKind] }
    : resolved;
}

// A `Pick<HandlerContext, "appendEvent">` parameter loses the member once the types are the new
// ones, so the annotation itself is the only evidence left that the receiver is a context.
export function pickedContextKind(expression: Node, memberName: string): ContextKind | undefined {
  if (!Node.isIdentifier(expression)) return undefined;
  for (const declaration of expression.getSymbol()?.getDeclarations() ?? []) {
    const annotation =
      Node.isParameterDeclaration(declaration) || Node.isVariableDeclaration(declaration)
        ? declaration.getTypeNode()
        : undefined;
    if (!Node.isTypeReference(annotation) || annotation.getTypeName().getText() !== "Pick")
      continue;
    const [target, keysNode] = annotation.getTypeArguments();
    const keys = keysNode === undefined ? undefined : stringLiteralKeys(keysNode);
    if (target !== undefined && keys?.includes(memberName))
      return contextKindOfAlias(target.getType());
  }
  return undefined;
}

function resolveReceiver(type: Type, memberName: string | undefined): Receiver {
  const nonNullable = type.getNonNullableType();
  const constituents = nonNullable.isUnion() ? nonNullable.getUnionTypes() : [nonNullable];
  const contexts = new Set<ContextKind>();
  let others = 0;
  for (const constituent of constituents) {
    const classified = classifyConstituent(constituent, memberName);
    if (classified === "unresolved") return { kind: "unresolved" };
    if (classified === "other") others += 1;
    else contexts.add(classified);
  }
  if (contexts.size === 0) return { kind: "none" };
  if (others > 0) return { kind: "ambiguous" };
  return { kind: "context", contexts: [...contexts] };
}

export function isContextNamedReceiver(expression: Node): boolean {
  const text = expression.getText();
  return RECEIVER_NAME.test(text) || /\.(ctx|context)$/.test(text);
}

export function decideMove(
  receiver: Receiver,
  memberName: string,
  receiverIsContextNamed: boolean,
): MoveDecision {
  if (!isMovedMemberName(memberName)) return UNTOUCHED;
  switch (receiver.kind) {
    case "none":
      return UNTOUCHED;
    case "ambiguous":
      return {
        status: "manual",
        reason: `${memberName}: receiver mixes a context and another type`,
      };
    case "unresolved":
      return receiverIsContextNamed
        ? { status: "manual", reason: `${memberName}: receiver type does not resolve` }
        : UNTOUCHED;
    case "context":
      return decideForContexts(receiver.contexts, memberName);
  }
}

function decideForContexts(contexts: readonly ContextKind[], memberName: string): MoveDecision {
  const paths = contexts.map((kind) => moveOf(kind, memberName));
  const first = paths[0];
  if (!paths.every((path) => samePath(path, first))) {
    return {
      status: "manual",
      reason: `${memberName}: union receiver maps differently per member`,
    };
  }
  return first === undefined ? UNTOUCHED : { status: "move", path: first };
}

export function stringLiteralKeys(node: Node): string[] | undefined {
  const members = Node.isUnionTypeNode(node) ? node.getTypeNodes() : [node];
  const keys: string[] = [];
  for (const member of members) {
    const literal = Node.isLiteralTypeNode(member) ? member.getLiteral() : undefined;
    if (!Node.isStringLiteral(literal)) return undefined;
    keys.push(literal.getLiteralText());
  }
  return keys;
}

// An untyped spread may carry anything, so it counts as a conflict for every namespace.
export function spreadMayCarryNamespace(type: Type, namespace: string): boolean {
  const nonNullable = type.getNonNullableType();
  const constituents = nonNullable.isUnion() ? nonNullable.getUnionTypes() : [nonNullable];
  return constituents.some((constituent) => {
    if (constituent.isAny() || constituent.isUnknown()) return true;
    return constituent
      .getApparentType()
      .getProperties()
      .some((property) => {
        const name = property.getName();
        if (namespace === "db") return name === "db" || name === "dbOutsideTransaction";
        if (name === namespace) return true;
        return (
          declaredContextKind(property) !== undefined &&
          moveOf("handler", name)?.namespace === namespace
        );
      });
  });
}
