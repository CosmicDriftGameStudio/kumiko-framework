import {
  type ElementAccessExpression,
  type IndexedAccessTypeNode,
  Node,
  type ObjectLiteralExpression,
  type PropertyAccessExpression,
  type SourceFile,
  SyntaxKind,
  type Type,
  type TypeReferenceNode,
} from "ts-morph";
import type { CodemodResult } from "./codemod-support.ts";
import {
  Counters,
  planHookAnnotation,
  planPhaseAnnotation,
  withImports,
} from "./ctx-namespaces-annotations.ts";
import {
  planAppContextArguments,
  planCastedMember,
  planRemovedMember,
} from "./ctx-namespaces-contracts.ts";
import {
  contextKindOfAlias,
  decideMove,
  isContextNamedReceiver,
  pickedContextKind,
  receiverOf,
  stringLiteralKeys,
} from "./ctx-namespaces-detect.ts";
import { EditPlan } from "./ctx-namespaces-edits.ts";
import { describePath, isMovedMemberName, moveOf } from "./ctx-namespaces-mapping.ts";
import { planRenamedMember } from "./ctx-namespaces-rename.ts";
import { planBindingPattern, planObjectLiteral } from "./ctx-namespaces-structural.ts";
import { planStructuralArguments } from "./ctx-namespaces-structural-params.ts";

export interface CtxNamespacesResult extends CodemodResult {
  readonly contextReceivers: number;
}

function planPropertyAccess(
  plan: EditPlan,
  counters: Counters,
  access: PropertyAccessExpression,
): boolean {
  const name = access.getName();
  planRemovedMember(plan, counters, access);
  planCastedMember(plan, counters, access);
  if (!isMovedMemberName(name)) return false;
  const expression = access.getExpression();
  const receiver = receiverOf(
    expression.getType(),
    name,
    pickedContextKind(expression, name) ?? counters.pinnedKindOf(expression),
  );
  if (receiver.kind === "context") counters.contextReceivers += 1;
  const decision = decideMove(receiver, name, isContextNamedReceiver(expression));
  if (decision.status === "manual") plan.flagManual(access, decision.reason);
  if (decision.status !== "move") return false;
  const replacement = describePath(decision.path);
  plan.replaceNode(access.getNameNode(), replacement);
  plan.recordRewrite(access, `${name} -> ${replacement}`);
  return true;
}

function planElementAccess(plan: EditPlan, access: ElementAccessExpression): boolean {
  const argument = access.getArgumentExpression();
  if (!Node.isStringLiteral(argument) || !isMovedMemberName(argument.getLiteralText()))
    return false;
  const name = argument.getLiteralText();
  const decision = decideMove(receiverOf(access.getExpression().getType(), name), name, false);
  if (decision.status === "move") {
    plan.flagManual(access, `element access ["${name}"] on a context`);
  }
  return true;
}

function literalContextType(literal: ObjectLiteralExpression): Type | undefined {
  let typeNode: Node | undefined;
  let current: Node = literal;
  for (let parent = current.getParent(); parent !== undefined; parent = current.getParent()) {
    if (Node.isAsExpression(parent) || Node.isSatisfiesExpression(parent)) {
      typeNode = parent.getTypeNode();
    } else if (!Node.isParenthesizedExpression(parent)) {
      break;
    }
    current = parent;
  }
  return typeNode === undefined ? literal.getContextualType() : typeNode.getType();
}

function hasMovedKey(literal: ObjectLiteralExpression): boolean {
  return literal.getProperties().some((property) => {
    if (Node.isSpreadAssignment(property)) return false;
    const name = property.getNameNode();
    return (
      (Node.isIdentifier(name) && isMovedMemberName(name.getText())) ||
      (Node.isStringLiteral(name) && isMovedMemberName(name.getLiteralText()))
    );
  });
}

function planLiteral(plan: EditPlan, literal: ObjectLiteralExpression): boolean {
  if (!hasMovedKey(literal)) return false;
  const type = literalContextType(literal);
  if (type !== undefined) planObjectLiteral(plan, literal, type);
  return true;
}

function patternType(pattern: Node): Type | undefined {
  const owner = pattern.getParent();
  if (Node.isVariableDeclaration(owner)) {
    return owner.getTypeNode()?.getType() ?? owner.getInitializer()?.getType();
  }
  if (Node.isParameterDeclaration(owner)) return owner.getTypeNode()?.getType() ?? owner.getType();
  return undefined;
}

function planIndexedAccess(plan: EditPlan, node: IndexedAccessTypeNode): boolean {
  const kind = contextKindOfAlias(node.getObjectTypeNode().getType());
  const keys = stringLiteralKeys(node.getIndexTypeNode());
  if (kind === undefined || keys === undefined) return false;
  const moves = keys.map((key) => ({ key, path: moveOf(kind, key) }));
  if (moves.every((move) => move.path === undefined)) return false;
  const [only] = moves;
  if (moves.length > 1 || only?.path === undefined) {
    plan.flagManual(node, "indexed access mixing moved and unmoved context members");
    return false;
  }
  const { namespace, leaf } = only.path;
  plan.replaceNode(node, `${node.getObjectTypeNode().getText()}["${namespace}"]["${leaf}"]`);
  plan.recordRewrite(node, `${only.key} -> ${describePath(only.path)} (indexed access)`);
  return true;
}

function planPickOmit(plan: EditPlan, node: TypeReferenceNode): boolean {
  const helper = node.getTypeName().getText();
  const [target, keysNode] = node.getTypeArguments();
  if ((helper !== "Pick" && helper !== "Omit") || target === undefined || keysNode === undefined) {
    return false;
  }
  const kind = contextKindOfAlias(target.getType());
  const keys = stringLiteralKeys(keysNode);
  if (kind === undefined || keys === undefined) return false;
  const mapped = keys.map((key) => moveOf(kind, key)?.namespace ?? key);
  if (mapped.every((key, index) => key === keys[index])) return false;
  if (helper === "Omit") {
    plan.flagManual(node, "Omit of a moved context member");
    return false;
  }
  const unique = [...new Set(mapped)];
  plan.replaceNode(keysNode, unique.map((key) => `"${key}"`).join(" | "));
  plan.recordRewrite(node, "Pick keys mapped to context namespaces");
  return true;
}

function visit(plan: EditPlan, counters: Counters, node: Node): void {
  planRenamedMember(plan, node);
  switch (node.getKind()) {
    case SyntaxKind.PropertyAccessExpression:
      planPropertyAccess(plan, counters, node.asKindOrThrow(SyntaxKind.PropertyAccessExpression));
      break;
    case SyntaxKind.ElementAccessExpression:
      planElementAccess(plan, node.asKindOrThrow(SyntaxKind.ElementAccessExpression));
      break;
    case SyntaxKind.ObjectLiteralExpression:
      planLiteral(plan, node.asKindOrThrow(SyntaxKind.ObjectLiteralExpression));
      break;
    case SyntaxKind.ObjectBindingPattern: {
      const type = patternType(node);
      if (type !== undefined) {
        planBindingPattern(plan, node.asKindOrThrow(SyntaxKind.ObjectBindingPattern), type);
      }
      break;
    }
    case SyntaxKind.IndexedAccessType:
      planIndexedAccess(plan, node.asKindOrThrow(SyntaxKind.IndexedAccessType));
      break;
    case SyntaxKind.TypeReference:
      planPickOmit(plan, node.asKindOrThrow(SyntaxKind.TypeReference));
      break;
    default:
      visitAnnotationSite(plan, counters, node);
  }
}

// Hook and phase annotations plus calls that hand a context to an AppContext parameter.
function visitAnnotationSite(plan: EditPlan, counters: Counters, node: Node): void {
  switch (node.getKind()) {
    case SyntaxKind.PropertyAssignment:
    case SyntaxKind.MethodDeclaration:
      planPhaseAnnotation(plan, counters, node);
      break;
    case SyntaxKind.Parameter:
      planHookAnnotation(plan, counters, node);
      break;
    case SyntaxKind.CallExpression:
    case SyntaxKind.NewExpression:
      if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
        planAppContextArguments(plan, counters, node);
        planStructuralArguments(plan, counters, node);
      }
      break;
    default:
      break;
  }
}

export function transformCtxNamespaces(sourceFile: SourceFile): CtxNamespacesResult {
  const plan = new EditPlan(sourceFile);
  const counters = new Counters();
  sourceFile.forEachDescendant((node) => visit(plan, counters, node));
  const output =
    plan.rewrites.length === 0
      ? plan.source
      : withImports(plan.render(), sourceFile.getFilePath(), counters);
  return {
    output,
    rewrites: plan.rewrites,
    manual: plan.manual,
    contextReceivers: counters.contextReceivers,
  };
}
