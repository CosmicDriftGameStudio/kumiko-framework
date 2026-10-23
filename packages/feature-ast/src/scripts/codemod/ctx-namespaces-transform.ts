import {
  type ElementAccessExpression,
  type IndexedAccessTypeNode,
  Node,
  type ObjectLiteralExpression,
  Project,
  type PropertyAccessExpression,
  type SourceFile,
  SyntaxKind,
  type Type,
  type TypeReferenceNode,
} from "ts-morph";
import { type CodemodResult, ensureNamedImport, removeNamedImport } from "./codemod-support.ts";
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

export interface CtxNamespacesResult extends CodemodResult {
  readonly contextReceivers: number;
}

interface NamedImportNeed {
  readonly specifier: string;
  readonly name: string;
  readonly isTypeOnly: boolean;
}

const PHASE_CONTEXT_BY_PROPERTY: ReadonlyMap<string, string> = new Map([
  ["beforeTransaction", "BeforeTransactionContext"],
  ["reserveBeforeTransaction", "ReservationContext"],
]);

class Counters {
  contextReceivers = 0;
  readonly imports: NamedImportNeed[] = [];
}

function planPropertyAccess(
  plan: EditPlan,
  counters: Counters,
  access: PropertyAccessExpression,
): void {
  const name = access.getName();
  if (!isMovedMemberName(name)) return;
  const expression = access.getExpression();
  const receiver = receiverOf(expression.getType(), name, pickedContextKind(expression, name));
  if (receiver.kind === "context") counters.contextReceivers += 1;
  const decision = decideMove(receiver, name, isContextNamedReceiver(expression));
  if (decision.status === "manual") plan.flagManual(access, decision.reason);
  if (decision.status !== "move") return;
  const replacement = describePath(decision.path);
  plan.replaceNode(access.getNameNode(), replacement);
  plan.recordRewrite(access, `${name} -> ${replacement}`);
}

function planElementAccess(plan: EditPlan, access: ElementAccessExpression): void {
  const argument = access.getArgumentExpression();
  if (!Node.isStringLiteral(argument) || !isMovedMemberName(argument.getLiteralText())) return;
  const name = argument.getLiteralText();
  const decision = decideMove(receiverOf(access.getExpression().getType(), name), name, false);
  if (decision.status === "move") {
    plan.flagManual(access, `element access ["${name}"] on a context`);
  }
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

function planLiteral(plan: EditPlan, literal: ObjectLiteralExpression): void {
  if (!hasMovedKey(literal)) return;
  const type = literalContextType(literal);
  if (type !== undefined) planObjectLiteral(plan, literal, type);
}

function patternType(pattern: Node): Type | undefined {
  const owner = pattern.getParent();
  if (Node.isVariableDeclaration(owner)) {
    return owner.getTypeNode()?.getType() ?? owner.getInitializer()?.getType();
  }
  if (Node.isParameterDeclaration(owner)) return owner.getTypeNode()?.getType() ?? owner.getType();
  return undefined;
}

function planIndexedAccess(plan: EditPlan, node: IndexedAccessTypeNode): void {
  const kind = contextKindOfAlias(node.getObjectTypeNode().getType());
  const keys = stringLiteralKeys(node.getIndexTypeNode());
  if (kind === undefined || keys === undefined) return;
  const moves = keys.map((key) => ({ key, path: moveOf(kind, key) }));
  if (moves.every((move) => move.path === undefined)) return;
  const [only] = moves;
  if (moves.length > 1 || only?.path === undefined) {
    plan.flagManual(node, "indexed access mixing moved and unmoved context members");
    return;
  }
  const { namespace, leaf } = only.path;
  plan.replaceNode(node, `${node.getObjectTypeNode().getText()}["${namespace}"]["${leaf}"]`);
  plan.recordRewrite(node, `${only.key} -> ${describePath(only.path)} (indexed access)`);
}

function planPickOmit(plan: EditPlan, node: TypeReferenceNode): void {
  const helper = node.getTypeName().getText();
  const [target, keysNode] = node.getTypeArguments();
  if ((helper !== "Pick" && helper !== "Omit") || target === undefined || keysNode === undefined) {
    return;
  }
  const kind = contextKindOfAlias(target.getType());
  const keys = stringLiteralKeys(keysNode);
  if (kind === undefined || keys === undefined) return;
  const mapped = keys.map((key) => moveOf(kind, key)?.namespace ?? key);
  if (mapped.every((key, index) => key === keys[index])) return;
  if (helper === "Omit") {
    plan.flagManual(node, "Omit of a moved context member");
    return;
  }
  const unique = [...new Set(mapped)];
  plan.replaceNode(keysNode, unique.map((key) => `"${key}"`).join(" | "));
  plan.recordRewrite(node, "Pick keys mapped to context namespaces");
}

function importOfHandlerContext(sourceFile: SourceFile): NamedImportNeed | undefined {
  for (const declaration of sourceFile.getImportDeclarations()) {
    const named = declaration
      .getNamedImports()
      .find((entry) => entry.getName() === "HandlerContext");
    if (named !== undefined && named.getAliasNode() === undefined) {
      return {
        specifier: declaration.getModuleSpecifierValue(),
        name: "HandlerContext",
        isTypeOnly: declaration.isTypeOnly() || named.isTypeOnly(),
      };
    }
  }
  return undefined;
}

function phaseFunctionOf(node: Node): Node | undefined {
  if (Node.isMethodDeclaration(node)) return node;
  if (!Node.isPropertyAssignment(node)) return undefined;
  const initializer = node.getInitializer();
  return Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)
    ? initializer
    : undefined;
}

function planPhaseAnnotation(plan: EditPlan, counters: Counters, node: Node): void {
  if (!Node.isPropertyAssignment(node) && !Node.isMethodDeclaration(node)) return;
  const phaseContext = PHASE_CONTEXT_BY_PROPERTY.get(node.getName());
  const fn = phaseFunctionOf(node);
  if (phaseContext === undefined || fn === undefined) return;
  if (
    !(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isMethodDeclaration(fn))
  ) {
    return;
  }
  for (const parameter of fn.getParameters()) {
    const annotation = parameter.getTypeNode();
    if (
      !Node.isTypeReference(annotation) ||
      annotation.getTypeName().getText() !== "HandlerContext"
    ) {
      continue;
    }
    const imported = importOfHandlerContext(plan.sourceFile);
    if (imported === undefined) {
      plan.flagManual(
        annotation,
        "HandlerContext annotation of a phase hook is not a named import",
      );
      continue;
    }
    counters.imports.push({ ...imported, name: phaseContext });
    plan.replaceNode(annotation.getTypeName(), phaseContext);
    plan.recordRewrite(annotation, `HandlerContext -> ${phaseContext}`);
  }
}

function dropUnusedHandlerContextImport(sourceFile: SourceFile): void {
  const stillUsed = sourceFile
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some(
      (identifier) =>
        identifier.getText() === "HandlerContext" &&
        identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) === undefined,
    );
  if (stillUsed) return;
  for (const declaration of sourceFile.getImportDeclarations()) {
    const named = declaration
      .getNamedImports()
      .find((entry) => entry.getName() === "HandlerContext");
    if (named !== undefined) removeNamedImport(sourceFile, declaration, named);
  }
}

function withImports(output: string, filePath: string, needs: readonly NamedImportNeed[]): string {
  if (needs.length === 0) return output;
  const scratch = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const sourceFile = scratch.createSourceFile(filePath, output);
  for (const need of needs) {
    ensureNamedImport(sourceFile, need.specifier, need.name, need.isTypeOnly);
  }
  dropUnusedHandlerContextImport(sourceFile);
  return sourceFile.getFullText();
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
    case SyntaxKind.PropertyAssignment:
    case SyntaxKind.MethodDeclaration:
      planPhaseAnnotation(plan, counters, node);
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
      : withImports(plan.render(), sourceFile.getFilePath(), counters.imports);
  return {
    output,
    rewrites: plan.rewrites,
    manual: plan.manual,
    contextReceivers: counters.contextReceivers,
  };
}
