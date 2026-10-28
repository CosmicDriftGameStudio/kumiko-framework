import {
  type ClassDeclaration,
  type EnumDeclaration,
  type FunctionDeclaration,
  type InterfaceDeclaration,
  Node,
  type ParameterDeclaration,
  type TypeAliasDeclaration,
  type TypeElementTypes,
  type TypeNode,
  type TypeParameterDeclaration,
  ts,
  type VariableDeclaration,
} from "ts-morph";
import { isInternalApi, isPublicClassMember, jsDocsOf } from "./agent-docs-api-nodes";
import { firstSentence } from "./agent-docs-shared";

const INDENT = "  ";
const MAX_INLINE_TYPE_CHARS = 240;
const MAX_INFERRED_TYPE_CHARS = 120;
const MAX_NESTED_LITERAL_DEPTH = 3;
const IMPORT_QUALIFIER_RE = /import\("[^"]*"\)\./g;
// Readonly modifiers decide nothing for code that passes options in, and they
// are a tenth of the output.
const READONLY_MODIFIER_RE = /\breadonly /g;

function collapse(text: string): string {
  return text
    .replace(IMPORT_QUALIFIER_RE, "")
    .replace(READONLY_MODIFIER_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

const commentFreePrinter = ts.createPrinter({ removeComments: true });

// Source text keeps line comments, which would swallow the rest of a collapsed
// one-line signature; the printer re-emits the node without them.
function nodeText(node: Node): string {
  const printed = commentFreePrinter.printNode(
    ts.EmitHint.Unspecified,
    node.compilerNode,
    node.getSourceFile().compilerNode,
  );
  return collapse(printed);
}

function capped(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function docSuffix(node: Node): string {
  const description = jsDocsOf(node).at(-1)?.getDescription().trim() ?? "";
  return description === "" ? "" : ` // ${firstSentence(description)}`;
}

function typeParametersText(params: readonly TypeParameterDeclaration[]): string {
  return params.length === 0 ? "" : `<${params.map((p) => nodeText(p)).join(", ")}>`;
}

// Destructuring patterns and their defaults are implementation detail; the
// parameter type already lists the properties.
function parameterName(param: ParameterDeclaration): string {
  const nameNode = param.getNameNode();
  if (Node.isObjectBindingPattern(nameNode)) return "props";
  if (Node.isArrayBindingPattern(nameNode)) return "args";
  return nameNode.getText();
}

function parameterText(param: ParameterDeclaration): string {
  const rest = param.isRestParameter() ? "..." : "";
  const optional = param.hasQuestionToken() || param.hasInitializer() ? "?" : "";
  const typeNode = param.getTypeNode();
  const typeText = typeNode === undefined ? "" : `: ${nodeText(typeNode)}`;
  return `${rest}${parameterName(param)}${optional}${typeText}`;
}

type SignatureLike = {
  getTypeParameters(): TypeParameterDeclaration[];
  getParameters(): ParameterDeclaration[];
  getReturnTypeNode(): TypeNode | undefined;
  getReturnType(): { getText(enclosing?: Node): string };
};

function signatureText(signature: SignatureLike & Node): string {
  const params = signature.getParameters().map(parameterText).join(", ");
  const declared = signature.getReturnTypeNode();
  const returnText =
    declared !== undefined
      ? nodeText(declared)
      : inferredText(signature.getReturnType(), signature);
  return `${typeParametersText(signature.getTypeParameters())}(${params}): ${returnText}`;
}

function typeText(typeNode: TypeNode | undefined, depth: number, indent: string): string {
  if (typeNode === undefined) return "unknown";
  if (Node.isTypeLiteral(typeNode) && depth < MAX_NESTED_LITERAL_DEPTH) {
    const members = typeNode.getMembers().filter((member) => !isInternalApi(member));
    if (members.length === 0) return "{}";
    const lines = members.flatMap((member) => memberLines(member, depth + 1, `${indent}${INDENT}`));
    return `{\n${lines.join("\n")}\n${indent}}`;
  }
  return capped(nodeText(typeNode), MAX_INLINE_TYPE_CHARS);
}

function memberName(member: TypeElementTypes): string {
  if (Node.isPropertySignature(member) || Node.isMethodSignature(member)) {
    const optional = member.hasQuestionToken() ? "?" : "";
    return `${nodeText(member.getNameNode())}${optional}`;
  }
  return "";
}

function memberLines(member: TypeElementTypes, depth: number, indent: string): string[] {
  const doc = docSuffix(member);
  if (Node.isPropertySignature(member)) {
    const text = typeText(member.getTypeNode(), depth, indent);
    return [`${indent}${memberName(member)}: ${text};${doc}`];
  }
  if (Node.isMethodSignature(member)) {
    return [`${indent}${memberName(member)}${signatureText(member)};${doc}`];
  }
  return [`${indent}${capped(nodeText(member).replace(/;$/, ""), MAX_INLINE_TYPE_CHARS)};${doc}`];
}

function typeMembersBlock(members: readonly TypeElementTypes[]): string[] {
  return members
    .filter((member) => !isInternalApi(member))
    .flatMap((member) => memberLines(member, 1, INDENT));
}

function renderInterface(node: InterfaceDeclaration): string[] {
  const heritage = node.getExtends().map((clause) => nodeText(clause));
  const extendsText = heritage.length === 0 ? "" : ` extends ${heritage.join(", ")}`;
  const head = `interface ${node.getName()}${typeParametersText(node.getTypeParameters())}${extendsText}`;
  const members = typeMembersBlock(node.getMembers());
  if (members.length === 0) return [`${head} {}${docSuffix(node)}`];
  return [`${head} {${docSuffix(node)}`, ...members, "}"];
}

function literalParts(typeNode: TypeNode): { named: string[]; literals: TypeNode[] } {
  const parts = Node.isIntersectionTypeNode(typeNode) ? typeNode.getTypeNodes() : [typeNode];
  return {
    named: parts.filter((part) => !Node.isTypeLiteral(part)).map((part) => nodeText(part)),
    literals: parts.filter((part) => Node.isTypeLiteral(part)),
  };
}

function renderTypeAlias(node: TypeAliasDeclaration): string[] {
  const head = `type ${node.getName()}${typeParametersText(node.getTypeParameters())} =`;
  const typeNode = node.getTypeNodeOrThrow();
  const doc = docSuffix(node);
  if (Node.isUnionTypeNode(typeNode) && typeNode.getTypeNodes().some(Node.isTypeLiteral)) {
    const variants = typeNode.getTypeNodes().map((variant) => {
      const literal = typeText(variant, 1, INDENT);
      return `${INDENT}| ${Node.isTypeLiteral(variant) ? literal : nodeText(variant)}`;
    });
    return [`${head}${doc}`, ...variants, ";"];
  }
  const { named, literals } = literalParts(typeNode);
  if (literals.length === 0) {
    return [`${head} ${capped(nodeText(typeNode), MAX_INLINE_TYPE_CHARS * 2)};${doc}`];
  }
  const members = literals.flatMap((literal) =>
    Node.isTypeLiteral(literal) ? typeMembersBlock(literal.getMembers()) : [],
  );
  const prefix = named.length === 0 ? "" : `${named.join(" & ")} & `;
  return [`${head} ${prefix}{${doc}`, ...members, "};"];
}

function renderEnum(node: EnumDeclaration): string[] {
  const members = node.getMembers().map((member) => nodeText(member));
  return [`enum ${node.getName()} { ${members.join(", ")} }${docSuffix(node)}`];
}

function renderClass(node: ClassDeclaration): string[] {
  const base = node.getExtends();
  const extendsText = base === undefined ? "" : ` extends ${nodeText(base)}`;
  const head = `class ${node.getName() ?? "default"}${typeParametersText(node.getTypeParameters())}${extendsText}`;
  const lines: string[] = [];
  for (const ctor of node.getConstructors()) {
    if (isPublicClassMember(ctor)) {
      lines.push(`${INDENT}constructor(${ctor.getParameters().map(parameterText).join(", ")});`);
    }
  }
  for (const member of node.getMembers()) {
    if (!isPublicClassMember(member)) continue;
    const isStatic = Node.isStaticable(member) && member.isStatic() ? "static " : "";
    if (Node.isPropertyDeclaration(member)) {
      const text = typeText(member.getTypeNode(), 1, INDENT);
      lines.push(`${INDENT}${isStatic}${member.getName()}: ${text};${docSuffix(member)}`);
    } else if (Node.isMethodDeclaration(member)) {
      lines.push(
        `${INDENT}${isStatic}${member.getName()}${signatureText(member)};${docSuffix(member)}`,
      );
    }
  }
  if (lines.length === 0) return [`${head} {}${docSuffix(node)}`];
  return [`${head} {${docSuffix(node)}`, ...lines, "}"];
}

function renderFunction(name: string, node: FunctionDeclaration): string[] {
  const overloads = node.getOverloads();
  const signatures = overloads.length > 0 ? overloads : [node];
  return signatures.map(
    (signature) => `function ${name}${signatureText(signature)};${docSuffix(signature)}`,
  );
}

function renderVariable(name: string, node: VariableDeclaration): string[] {
  const doc = docSuffix(node);
  const typeNode = node.getTypeNode();
  if (typeNode !== undefined) return [`const ${name}: ${typeText(typeNode, 1, "")};${doc}`];
  const initializer = node.getInitializer();
  if (
    initializer !== undefined &&
    (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))
  ) {
    return [`function ${name}${signatureText(initializer)};${doc}`];
  }
  const inferred = collapse(node.getType().getText(node));
  if (inferred.length <= MAX_INFERRED_TYPE_CHARS) return [`const ${name}: ${inferred};${doc}`];
  const keys = objectLiteralKeys(initializer);
  return [`const ${name}${keys === undefined ? "" : `: { ${keys.join("; ")} }`};${doc}`];
}

function objectLiteralKeys(initializer: Node | undefined): string[] | undefined {
  let expression = initializer;
  while (Node.isAsExpression(expression) || Node.isSatisfiesExpression(expression)) {
    expression = expression.getExpression();
  }
  if (!Node.isObjectLiteralExpression(expression)) return undefined;
  return expression
    .getProperties()
    .flatMap((property) =>
      Node.isPropertyAssignment(property) ||
      Node.isShorthandPropertyAssignment(property) ||
      Node.isMethodDeclaration(property)
        ? [property.getName()]
        : [],
    );
}

export function renderApiDeclaration(name: string, node: Node): string[] | undefined {
  if (Node.isFunctionDeclaration(node)) return renderFunction(name, node);
  if (Node.isVariableDeclaration(node)) return renderVariable(name, node);
  if (Node.isInterfaceDeclaration(node)) return renderInterface(node);
  if (Node.isTypeAliasDeclaration(node)) return renderTypeAlias(node);
  if (Node.isEnumDeclaration(node)) return renderEnum(node);
  if (Node.isClassDeclaration(node)) return renderClass(node);
  return undefined;
}

function inferredText(type: { getText(enclosing?: Node): string }, enclosing: Node): string {
  const text = collapse(type.getText(enclosing));
  return text.length <= MAX_INFERRED_TYPE_CHARS ? text : "…";
}
