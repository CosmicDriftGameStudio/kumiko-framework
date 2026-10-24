import {
  type CallExpression,
  type InterfaceDeclaration,
  type MethodSignature,
  Node,
  type ParameterDeclaration,
  type PropertySignature,
  type TypeLiteralNode,
} from "ts-morph";
import { appContextReference, type Counters } from "./ctx-namespaces-annotations.ts";
import { contextReceiver } from "./ctx-namespaces-contracts.ts";
import { isContextNamedReceiver, isKumikoTypesFile, receiverOf } from "./ctx-namespaces-detect.ts";
import type { EditPlan } from "./ctx-namespaces-edits.ts";
import { describePath, isMovedMemberName, moveOf } from "./ctx-namespaces-mapping.ts";

type MemberOwner = TypeLiteralNode | InterfaceDeclaration;
type MovedSignature = PropertySignature | MethodSignature;

interface Collected {
  readonly owners: MemberOwner[];
  readonly foreignDeclarations: Node[];
}

function isProjectSource(node: Node): boolean {
  const file = node.getSourceFile();
  return (
    !file.isInNodeModules() &&
    !file.isFromExternalLibrary() &&
    !file.isDeclarationFile() &&
    !isKumikoTypesFile(file.getFilePath())
  );
}

function referencedDeclarations(typeName: Node): Node[] {
  const symbol = typeName.getSymbol();
  const target = symbol?.isAlias() ? symbol.getAliasedSymbol() : symbol;
  return target?.getDeclarations() ?? [];
}

function collect(typeNode: Node | undefined, seen: Set<Node>, into: Collected): void {
  // skip: no annotation, or a type already collected (guards against alias cycles)
  if (typeNode === undefined || seen.has(typeNode)) return;
  seen.add(typeNode);
  if (Node.isTypeLiteral(typeNode)) {
    into.owners.push(typeNode);
  } else if (Node.isIntersectionTypeNode(typeNode)) {
    for (const member of typeNode.getTypeNodes()) collect(member, seen, into);
  } else if (Node.isParenthesizedTypeNode(typeNode)) {
    collect(typeNode.getTypeNode(), seen, into);
  } else if (Node.isTypeReference(typeNode)) {
    for (const declaration of referencedDeclarations(typeNode.getTypeName())) {
      if (declaration.getSourceFile() !== typeNode.getSourceFile()) {
        if (isProjectSource(declaration)) into.foreignDeclarations.push(declaration);
      } else if (Node.isInterfaceDeclaration(declaration)) {
        into.owners.push(declaration);
      } else if (Node.isTypeAliasDeclaration(declaration)) {
        collect(declaration.getTypeNode(), seen, into);
      }
    }
  }
}

function isSignature(member: Node): member is MovedSignature {
  return Node.isPropertySignature(member) || Node.isMethodSignature(member);
}

function movedSignatures(owner: MemberOwner): MovedSignature[] {
  return owner
    .getMembers()
    .filter(
      (member): member is MovedSignature =>
        isSignature(member) && isMovedMemberName(member.getName()),
    );
}

function referenceTarget(parameter: ParameterDeclaration): Node | undefined {
  const fn = parameter.getParent();
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) return fn.getNameNode();
  const declaration = fn.getParent();
  return Node.isVariableDeclaration(declaration) ? declaration.getNameNode() : undefined;
}

function callOf(reference: Node): CallExpression | undefined {
  const parent = reference.getParent();
  const callee = Node.isPropertyAccessExpression(parent) ? parent : reference;
  const call = callee.getParent();
  return Node.isCallExpression(call) && call.getExpression() === callee ? call : undefined;
}

// Only a parameter a Kumiko context is passed to is a context; a ctx-named parameter of a foreign
// structural type (an MSP apply context) must stay as it is. A context handed on through another
// structural parameter counts too.
function receivesContext(
  counters: Counters,
  parameter: ParameterDeclaration,
  seen: Set<Node>,
): boolean {
  if (seen.has(parameter)) return false;
  seen.add(parameter);
  const target = referenceTarget(parameter);
  if (target === undefined || !Node.isReferenceFindable(target)) return false;
  const fn = parameter.getParent();
  const index = Node.isParametered(fn) ? fn.getParameters().indexOf(parameter) : -1;
  if (index < 0) return false;
  return target.findReferencesAsNodes().some((reference) => {
    const argument = callOf(reference)?.getArguments()[index];
    return (
      argument !== undefined &&
      (contextReceiver(counters, argument).kind === "context" ||
        passesOnContext(counters, argument, seen))
    );
  });
}

function passesOnContext(counters: Counters, argument: Node, seen: Set<Node>): boolean {
  if (!Node.isIdentifier(argument)) return false;
  return (argument.getSymbol()?.getDeclarations() ?? []).some(
    (declaration) =>
      Node.isParameterDeclaration(declaration) && receivesContext(counters, declaration, seen),
  );
}

function entryText(plan: EditPlan, member: MovedSignature, leaf: string): string {
  const name = member.getNameNode();
  const text =
    plan.source.slice(member.getStart(), name.getStart()) +
    leaf +
    plan.source.slice(name.getEnd(), member.getEnd());
  return text.replace(/[;,]$/, "");
}

function isReadonlySignature(member: MovedSignature): boolean {
  return Node.isPropertySignature(member) && member.isReadonly();
}

function declaresMember(owner: MemberOwner, name: string): boolean {
  return owner.getMembers().some((member) => isSignature(member) && member.getName() === name);
}

function planNamespaceGroup(
  plan: EditPlan,
  owner: MemberOwner,
  namespace: string,
  members: readonly MovedSignature[],
): void {
  const [first, ...rest] = members;
  // skip: a group is never empty, this narrows the destructured head
  if (first === undefined) return;
  if (declaresMember(owner, namespace)) {
    plan.flagManual(first, `${first.getName()}: the type already declares ${namespace}`);
    // skip: reported as manual, the namespace member is not merged by guesswork
    return;
  }
  const entries = members.map((member) =>
    entryText(plan, member, moveOf("handler", member.getName())?.leaf ?? member.getName()),
  );
  const separator = /[;,]$/.exec(first.getText())?.[0] ?? "";
  const modifier = members.every(isReadonlySignature) ? "readonly " : "";
  plan.replaceNode(first, `${modifier}${namespace}: { ${entries.join("; ")} }${separator}`);
  for (const member of rest) {
    plan.add({ start: member.getFullStart(), end: member.getEnd(), text: "" });
  }
  for (const member of members) {
    const path = moveOf("handler", member.getName());
    if (path !== undefined) {
      plan.recordRewrite(member, `${member.getName()} -> ${describePath(path)} (structural type)`);
    }
  }
}

function planOwner(plan: EditPlan, counters: Counters, owner: MemberOwner): void {
  const groups = new Map<string, MovedSignature[]>();
  for (const member of movedSignatures(owner)) {
    if (counters.rewrittenMembers.has(member)) continue;
    counters.rewrittenMembers.add(member);
    const namespace = moveOf("handler", member.getName())?.namespace ?? "";
    groups.set(namespace, [...(groups.get(namespace) ?? []), member]);
  }
  for (const [namespace, members] of groups) planNamespaceGroup(plan, owner, namespace, members);
}

function foreignMovedNames(declarations: readonly Node[]): string[] {
  return declarations.flatMap((declaration) =>
    Node.isTypeAliasDeclaration(declaration) || Node.isInterfaceDeclaration(declaration)
      ? declaration
          .getType()
          .getProperties()
          .map((property) => property.getName())
          .filter(isMovedMemberName)
      : [],
  );
}

// A hand-written structural type (alias, interface, intersection or inline literal) that declares
// flat context members follows the context into its namespaces, and so does the parameter's body.
export function planStructuralContextParameter(
  plan: EditPlan,
  counters: Counters,
  parameter: Node,
): boolean {
  if (!Node.isParameterDeclaration(parameter)) return false;
  const annotation = parameter.getTypeNode();
  // skip: AppContext is handled by the hook rewrite, a real context already carries namespaces
  if (annotation === undefined || appContextReference(annotation) !== undefined) return false;
  // skip: other names stay with the structural-params report, only ctx and context are read as contexts
  if (!isContextNamedReceiver(parameter.getNameNode())) return false;
  if (receiverOf(parameter.getType()).kind !== "none") return false;
  const collected: Collected = { owners: [], foreignDeclarations: [] };
  collect(annotation, new Set(), collected);
  const foreign = foreignMovedNames(collected.foreignDeclarations);
  const hasLocal = collected.owners.some((owner) => movedSignatures(owner).length > 0);
  if ((!hasLocal && foreign.length === 0) || !receivesContext(counters, parameter, new Set())) {
    return false;
  }
  if (foreign.length > 0) {
    plan.flagManual(
      annotation,
      `a structural context type declared in another file reads ${[...new Set(foreign)].join(", ")}, which moved into context namespaces`,
    );
    return false;
  }
  for (const owner of collected.owners) planOwner(plan, counters, owner);
  counters.pinnedParameters.add(parameter);
  return true;
}
