import {
  type ArrowFunction,
  type ClassDeclaration,
  type EnumDeclaration,
  type FunctionDeclaration,
  type FunctionExpression,
  type InterfaceDeclaration,
  type JSDoc,
  Node,
  SyntaxKind,
  type TypeAliasDeclaration,
  type VariableDeclaration,
} from "ts-morph";

export type ApiTypeDeclaration =
  | InterfaceDeclaration
  | TypeAliasDeclaration
  | EnumDeclaration
  | ClassDeclaration;

export function isApiTypeDeclaration(node: Node): node is ApiTypeDeclaration {
  return (
    Node.isInterfaceDeclaration(node) ||
    Node.isTypeAliasDeclaration(node) ||
    Node.isEnumDeclaration(node) ||
    Node.isClassDeclaration(node)
  );
}

export function jsDocsOf(node: Node): readonly JSDoc[] {
  if (Node.isVariableDeclaration(node)) return node.getVariableStatement()?.getJsDocs() ?? [];
  return Node.isJSDocable(node) ? node.getJsDocs() : [];
}

export function isInternalApi(node: Node): boolean {
  return jsDocsOf(node).some((doc) => doc.getTags().some((tag) => tag.getTagName() === "internal"));
}

export function isPublicClassMember(member: Node): boolean {
  if (isInternalApi(member)) return false;
  if (!Node.isModifierable(member)) return true;
  if (
    member.hasModifier(SyntaxKind.PrivateKeyword) ||
    member.hasModifier(SyntaxKind.ProtectedKeyword)
  )
    return false;
  return (
    !(Node.isPropertyDeclaration(member) || Node.isMethodDeclaration(member)) ||
    !member.getName().startsWith("#")
  );
}

function presentNodes(node: Node | undefined): Node[] {
  return node === undefined ? [] : [node];
}

function isFunctionLike(node: Node | undefined): node is ArrowFunction | FunctionExpression {
  return Node.isArrowFunction(node) || Node.isFunctionExpression(node);
}

function variableTypeRoots(node: VariableDeclaration): Node[] {
  const typeNode = node.getTypeNode();
  if (typeNode !== undefined) return [typeNode];
  const initializer = node.getInitializer();
  if (!isFunctionLike(initializer)) return [];
  return [...initializer.getParameters(), ...presentNodes(initializer.getReturnTypeNode())];
}

function functionTypeRoots(node: FunctionDeclaration): Node[] {
  const overloads = node.getOverloads();
  return (overloads.length > 0 ? overloads : [node]).flatMap((signature) => [
    ...signature.getParameters(),
    ...presentNodes(signature.getReturnTypeNode()),
    ...signature.getTypeParameters(),
  ]);
}

function classTypeRoots(node: ClassDeclaration): Node[] {
  const roots: Node[] = presentNodes(node.getExtends());
  for (const member of node.getMembers()) {
    if (!isPublicClassMember(member)) continue;
    if (Node.isPropertyDeclaration(member)) roots.push(...presentNodes(member.getTypeNode()));
    if (Node.isMethodDeclaration(member) || Node.isConstructorDeclaration(member)) {
      roots.push(...member.getParameters(), ...presentNodes(member.getReturnTypeNode()));
    }
  }
  return roots;
}

function typeRoots(node: Node): Node[] {
  if (Node.isVariableDeclaration(node)) return variableTypeRoots(node);
  if (Node.isFunctionDeclaration(node)) return functionTypeRoots(node);
  if (Node.isClassDeclaration(node)) return classTypeRoots(node);
  return isApiTypeDeclaration(node) ? [node] : [];
}

// Type references reachable from the rendered text: parameter, return, property
// and heritage types. Bodies and initializers are not walked.
export function referencedTypeNodes(node: Node): readonly Node[] {
  const roots = typeRoots(node);
  return roots.flatMap((root) => [
    ...(Node.isTypeReference(root) || Node.isExpressionWithTypeArguments(root) ? [root] : []),
    ...root.getDescendantsOfKind(SyntaxKind.TypeReference),
    ...root.getDescendantsOfKind(SyntaxKind.ExpressionWithTypeArguments),
    ...root.getDescendantsOfKind(SyntaxKind.TypeQuery),
  ]);
}
