import { Node, type ParameterDeclaration, SyntaxKind } from "ts-morph";

export type ReceiverResolution = "registrar" | "other" | "unresolved";

const REGISTRAR_TYPE_MARKER = "FeatureRegistrar";
const FEATURE_FACTORY_NAME = "defineFeature";
export const REGISTRAR_RECEIVER_NAMES: ReadonlySet<string> = new Set(["r", "registrar"]);

function isFeatureFactoryCallee(callee: Node): boolean {
  if (Node.isIdentifier(callee)) return callee.getText() === FEATURE_FACTORY_NAME;
  if (Node.isPropertyAccessExpression(callee)) return callee.getName() === FEATURE_FACTORY_NAME;
  return false;
}

function isFeatureCallbackParameter(param: ParameterDeclaration): boolean {
  const fn = param.getParent();
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false;
  if (fn.getParameters()[0] !== param) return false;
  const call = fn.getParentIfKind(SyntaxKind.CallExpression);
  return (
    call !== undefined &&
    call.getArguments()[1] === fn &&
    isFeatureFactoryCallee(call.getExpression())
  );
}

function resolveParameter(param: ParameterDeclaration): ReceiverResolution {
  if (isFeatureCallbackParameter(param)) return "registrar";
  const typeNode = param.getTypeNode();
  if (typeNode === undefined) return "unresolved";
  return typeNode.getText().includes(REGISTRAR_TYPE_MARKER) ? "registrar" : "other";
}

function declaredVariableIn(scope: Node, name: string): ReceiverResolution | undefined {
  if (!Node.isBlock(scope) && !Node.isSourceFile(scope) && !Node.isModuleBlock(scope)) {
    return undefined;
  }
  for (const statement of scope.getStatements()) {
    if (!Node.isVariableStatement(statement)) continue;
    for (const declaration of statement.getDeclarations()) {
      if (declaration.getNameNode().getText() !== name) continue;
      const typeText = declaration.getTypeNode()?.getText();
      if (typeText === undefined) return "unresolved";
      return typeText.includes(REGISTRAR_TYPE_MARKER) ? "registrar" : "other";
    }
  }
  return undefined;
}

// Scope walk instead of a type checker: the nearest binding of the receiver's name decides.
export function resolveReceiver(receiver: Node): ReceiverResolution {
  if (!Node.isIdentifier(receiver)) return "other";
  const name = receiver.getText();
  for (
    let scope: Node | undefined = receiver.getParent();
    scope !== undefined;
    scope = scope.getParent()
  ) {
    if (Node.isParametered(scope)) {
      const param = scope.getParameters().find((p) => p.getNameNode().getText() === name);
      if (param !== undefined) return resolveParameter(param);
    }
    const variable = declaredVariableIn(scope, name);
    if (variable !== undefined) return variable;
  }
  return "unresolved";
}

export function isUnresolvedRegistrarLookalike(receiver: Node): boolean {
  return (
    Node.isIdentifier(receiver) &&
    REGISTRAR_RECEIVER_NAMES.has(receiver.getText()) &&
    resolveReceiver(receiver) === "unresolved"
  );
}
