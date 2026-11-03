import {
  type CallExpression,
  type InterfaceDeclaration,
  type MethodSignature,
  Node,
  type ParameterDeclaration,
  type PropertySignature,
  SyntaxKind,
  type TypeLiteralNode,
} from "ts-morph";
import { appContextReference, type Counters } from "./ctx-namespaces-annotations.ts";
import { contextReceiver } from "./ctx-namespaces-contracts.ts";
import { isContextNamedReceiver, isKumikoTypesFile, receiverOf } from "./ctx-namespaces-detect.ts";
import type { EditPlan } from "./ctx-namespaces-edits.ts";
import {
  type ContextKind,
  describePath,
  isMovedMemberName,
  moveOf,
  type NamespacePath,
  samePath,
} from "./ctx-namespaces-mapping.ts";

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

// A member that moves for one receiving kind but not (or elsewhere) for another cannot be rewritten
// for both; it is reported instead.
function pathAcrossKinds(
  kinds: readonly ContextKind[],
  memberName: string,
): { readonly path: NamespacePath | undefined; readonly agrees: boolean } {
  const [first, ...rest] = kinds;
  const path = first === undefined ? undefined : moveOf(first, memberName);
  return { path, agrees: rest.every((kind) => samePath(moveOf(kind, memberName), path)) };
}

function movedSignaturesFor(owner: MemberOwner, kinds: readonly ContextKind[]): MovedSignature[] {
  return movedSignatures(owner).filter((member) => {
    const { path, agrees } = pathAcrossKinds(kinds, member.getName());
    return !agrees || path !== undefined;
  });
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
// structural parameter counts too. The kinds say which context shape the parameter really receives.
function receivingKinds(
  counters: Counters,
  parameter: ParameterDeclaration,
  seen: Set<Node>,
): Set<ContextKind> {
  const kinds = new Set<ContextKind>();
  if (seen.has(parameter)) return kinds;
  seen.add(parameter);
  const target = referenceTarget(parameter);
  if (target === undefined || !Node.isReferenceFindable(target)) return kinds;
  const fn = parameter.getParent();
  const index = Node.isParametered(fn) ? fn.getParameters().indexOf(parameter) : -1;
  if (index < 0) return kinds;
  for (const reference of target.findReferencesAsNodes()) {
    const argument = callOf(reference)?.getArguments()[index];
    if (argument === undefined) continue;
    const receiver = contextReceiver(counters, argument);
    if (receiver.kind === "context") {
      for (const kind of receiver.contexts) kinds.add(kind);
    } else {
      for (const kind of passedOnKinds(counters, argument, seen)) kinds.add(kind);
    }
  }
  return kinds;
}

function passedOnKinds(counters: Counters, argument: Node, seen: Set<Node>): Set<ContextKind> {
  const kinds = new Set<ContextKind>();
  if (!Node.isIdentifier(argument)) return kinds;
  for (const declaration of argument.getSymbol()?.getDeclarations() ?? []) {
    if (!Node.isParameterDeclaration(declaration)) continue;
    for (const kind of receivingKinds(counters, declaration, seen)) kinds.add(kind);
  }
  return kinds;
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
  kind: ContextKind,
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
    entryText(plan, member, moveOf(kind, member.getName())?.leaf ?? member.getName()),
  );
  const separator = /[;,]$/.exec(first.getText())?.[0] ?? "";
  const modifier = members.every(isReadonlySignature) ? "readonly " : "";
  plan.replaceNode(first, `${modifier}${namespace}: { ${entries.join("; ")} }${separator}`);
  for (const member of rest) {
    plan.add({ start: member.getFullStart(), end: member.getEnd(), text: "" });
  }
  for (const member of members) {
    const path = moveOf(kind, member.getName());
    if (path !== undefined) {
      plan.recordRewrite(member, `${member.getName()} -> ${describePath(path)} (structural type)`);
    }
  }
}

function planOwner(
  plan: EditPlan,
  counters: Counters,
  owner: MemberOwner,
  kinds: readonly ContextKind[],
): void {
  const [kind] = kinds;
  // skip: a receiving parameter always has at least one kind
  if (kind === undefined) return;
  const groups = new Map<string, MovedSignature[]>();
  for (const member of movedSignaturesFor(owner, kinds)) {
    if (counters.rewrittenMembers.has(member)) continue;
    counters.rewrittenMembers.add(member);
    if (!pathAcrossKinds(kinds, member.getName()).agrees) {
      plan.flagManual(
        member,
        `${member.getName()}: moves differently for ${kinds.join(" and ")} contexts, which both reach this type`,
      );
      continue;
    }
    const namespace = moveOf(kind, member.getName())?.namespace ?? "";
    groups.set(namespace, [...(groups.get(namespace) ?? []), member]);
  }
  for (const [namespace, members] of groups) {
    planNamespaceGroup(plan, owner, namespace, members, kind);
  }
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

export interface StructuralContextParameter {
  readonly annotation: Node;
  readonly collected: Collected;
  readonly foreign: string[];
  readonly kinds: readonly ContextKind[];
  readonly conflicts: boolean;
}

function structuralContextParameter(
  counters: Counters,
  parameter: Node,
): StructuralContextParameter | undefined {
  if (counters.structuralParameters.has(parameter)) {
    return counters.structuralParameters.get(parameter);
  }
  const found = findStructuralContextParameter(counters, parameter);
  counters.structuralParameters.set(parameter, found);
  return found;
}

function findStructuralContextParameter(
  counters: Counters,
  parameter: Node,
): StructuralContextParameter | undefined {
  if (!Node.isParameterDeclaration(parameter)) return undefined;
  const annotation = parameter.getTypeNode();
  // skip: AppContext is handled by the hook rewrite, a real context already carries namespaces
  if (annotation === undefined || appContextReference(annotation) !== undefined) return undefined;
  // skip: other names stay with the structural-params report, only ctx and context are read as contexts
  if (!isContextNamedReceiver(parameter.getNameNode())) return undefined;
  if (receiverOf(parameter.getType()).kind !== "none") return undefined;
  const collected: Collected = { owners: [], foreignDeclarations: [] };
  collect(annotation, new Set(), collected);
  const foreign = foreignMovedNames(collected.foreignDeclarations);
  const kinds = [...receivingKinds(counters, parameter, new Set())];
  const hasLocal = collected.owners.some((owner) => movedSignaturesFor(owner, kinds).length > 0);
  if ((!hasLocal && foreign.length === 0) || kinds.length === 0) return undefined;
  const conflicts = collected.owners.some((owner) =>
    movedSignatures(owner).some((member) => !pathAcrossKinds(kinds, member.getName()).agrees),
  );
  return { annotation, collected, foreign, kinds, conflicts };
}

function isRewritableAlone(found: StructuralContextParameter | undefined): boolean {
  return found !== undefined && found.foreign.length === 0 && !found.conflicts;
}

function typeDeclarationOf(owner: MemberOwner): Node | undefined {
  return Node.isInterfaceDeclaration(owner)
    ? owner
    : owner.getFirstAncestorByKind(SyntaxKind.TypeAliasDeclaration);
}

function isInsideTypeAnnotation(reference: Node, parameter: Node): boolean {
  const annotation = Node.isParameterDeclaration(parameter) ? parameter.getTypeNode() : undefined;
  return (
    annotation !== undefined &&
    reference.getStart() >= annotation.getStart() &&
    reference.getEnd() <= annotation.getEnd()
  );
}

// A shared alias or interface is rewritten for every user at once. A user the rewrite does not
// reach (another parameter name, a non-parameter reference, a mock typed by it) would keep the flat
// shape and stop type-checking, so the type is reported instead.
function isTypeSharedWithOthers(
  counters: Counters,
  parameter: Node,
  found: StructuralContextParameter,
): boolean {
  const cached = counters.typeSharedWithOthers.get(parameter);
  if (cached !== undefined) return cached;
  const shared = found.collected.owners.some((owner) => {
    const declaration = typeDeclarationOf(owner);
    if (declaration === undefined || !Node.isNamed(declaration)) return false;
    return declaration
      .getNameNode()
      .findReferencesAsNodes()
      .some((reference) => {
        const user = reference.getFirstAncestorByKind(SyntaxKind.Parameter);
        if (user === undefined || !isInsideTypeAnnotation(reference, user)) return true;
        return user !== parameter && !isRewritableAlone(structuralContextParameter(counters, user));
      });
  });
  counters.typeSharedWithOthers.set(parameter, shared);
  return shared;
}

// The structural-params report would repeat what the rewrite of this parameter already fixes.
export function isRewrittenStructuralParameter(counters: Counters, parameter: Node): boolean {
  const found = structuralContextParameter(counters, parameter);
  return (
    found !== undefined &&
    isRewritableAlone(found) &&
    !isTypeSharedWithOthers(counters, parameter, found)
  );
}

// A hand-written structural type (alias, interface, intersection or inline literal) that declares
// flat context members follows the context into its namespaces, and so does the parameter's body.
export function planStructuralContextParameter(
  plan: EditPlan,
  counters: Counters,
  parameter: Node,
): boolean {
  const found = structuralContextParameter(counters, parameter);
  if (found === undefined) return false;
  const { annotation, collected, foreign, kinds, conflicts } = found;
  if (foreign.length > 0) {
    plan.flagManual(
      annotation,
      `a structural context type declared in another file reads ${[...new Set(foreign)].join(", ")}, which moved into context namespaces`,
    );
    return false;
  }
  if (isTypeSharedWithOthers(counters, parameter, found)) {
    plan.flagManual(
      annotation,
      "a structural context type is also used where the rewrite does not reach it (other parameter names, mocks or type references); move its flat members by hand",
    );
    return false;
  }
  for (const owner of collected.owners) planOwner(plan, counters, owner, kinds);
  // A conflicting member stays flat and reported, so the body must not be rewritten either.
  if (conflicts) return false;
  const [kind] = kinds;
  if (kind !== undefined) counters.pinnedParameters.set(parameter, kind);
  return true;
}
