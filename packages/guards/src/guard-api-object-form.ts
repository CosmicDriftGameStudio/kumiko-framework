#!/usr/bin/env bun
/**
 * Guard: the registrar methods `r.writeHandler`, `r.queryHandler`, `r.entity`,
 * `r.requires` and `r.hook` only take the object form; `registerEntityCrud(r, …)`
 * is replaced by `r.crud(…)`.
 *
 * The positional-shape and receiver rules mirror the object-form codemod in
 * kumiko-framework (scripts/codemod/object-form.ts). This package does not
 * depend on the framework, so the two copies are held together by the parity
 * test in __tests__/guard-api-object-form.test.ts.
 *
 * Usage:
 *   bun guards/guard-api-object-form.ts
 */
import {
  type CallExpression,
  Node,
  type ParameterDeclaration,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
import {
  type AstGuard,
  type GuardViolation,
  relativeToCwd,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";

const SCAN: ScanSpec = {
  scope: "source+tests",
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/*/src/**", "samples/**"],
};

const REGISTRAR_METHODS = ["writeHandler", "queryHandler", "entity", "requires", "hook"] as const;
type RegistrarMethod = (typeof REGISTRAR_METHODS)[number];

const CRUD_FUNCTION_NAME = "registerEntityCrud";
const REGISTRAR_TYPE_MARKER = "FeatureRegistrar";
const FEATURE_FACTORY_NAME = "defineFeature";
const REGISTRAR_RECEIVER_NAMES: ReadonlySet<string> = new Set(["r", "registrar"]);
const EXCLUDED_PATH = /(\/__tests__\/fixtures\/|\.d\.ts$)/;
// Cheap text superset of what positionalCallMethod can match; skips the AST walk for most files.
const REGISTRAR_METHOD_ACCESS = new RegExp(`\\.\\s*(?:${REGISTRAR_METHODS.join("|")})\\b`);
const UPGRADE_HINT = "run `bun kumiko-upgrade --apply` (codemod object-form)";

type ReceiverResolution = "registrar" | "other" | "unresolved";

function isRegistrarMethod(name: string): name is RegistrarMethod {
  return REGISTRAR_METHODS.some((method) => method === name);
}

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

// Nearest binding of the receiver's name decides; no type checker involved.
function resolveReceiver(receiver: Node): ReceiverResolution {
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

function isRegistrarOrLookalike(receiver: Node): boolean {
  const resolution = resolveReceiver(receiver);
  if (resolution === "registrar") return true;
  return (
    resolution === "unresolved" &&
    Node.isIdentifier(receiver) &&
    REGISTRAR_RECEIVER_NAMES.has(receiver.getText())
  );
}

function isPositionalShape(method: RegistrarMethod, args: readonly Node[]): boolean {
  if (method === "requires") return args.some((arg) => !Node.isObjectLiteralExpression(arg));
  if (args.some((arg) => Node.isSpreadElement(arg))) return true;
  return args.length >= (method === "hook" ? 3 : 2);
}

function crudLocalNames(sf: SourceFile): Set<string> {
  const names = new Set<string>([CRUD_FUNCTION_NAME]);
  for (const specifier of sf.getDescendantsOfKind(SyntaxKind.ImportSpecifier)) {
    if (specifier.getName() !== CRUD_FUNCTION_NAME) continue;
    names.add(specifier.getAliasNode()?.getText() ?? CRUD_FUNCTION_NAME);
  }
  return names;
}

function positionalCallMethod(call: CallExpression): RegistrarMethod | undefined {
  const callee = call.getExpression();
  if (!Node.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.getName();
  if (!isRegistrarMethod(method)) return undefined;
  if (!isPositionalShape(method, call.getArguments())) return undefined;
  return isRegistrarOrLookalike(callee.getExpression()) ? method : undefined;
}

export type ObjectFormFinding = { file: string; line: number; message: string };

function positionalCallFindings(sf: SourceFile, file: string): ObjectFormFinding[] {
  if (!REGISTRAR_METHOD_ACCESS.test(sf.getFullText())) return [];
  const out: ObjectFormFinding[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const method = positionalCallMethod(call);
    if (method === undefined) continue;
    out.push({
      file,
      line: call.getStartLineNumber(),
      message: `positional r.${method}(…) removed in 0.366 — ${UPGRADE_HINT}`,
    });
  }
  return out;
}

function crudFindings(sf: SourceFile, file: string): ObjectFormFinding[] {
  // Every crud local name is CRUD_FUNCTION_NAME itself or an import alias of it.
  if (!sf.getFullText().includes(CRUD_FUNCTION_NAME)) return [];
  const crudNames = crudLocalNames(sf);
  const out: ObjectFormFinding[] = [];
  for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (!crudNames.has(id.getText())) continue;
    const parent = id.getParent();
    const isCall = Node.isCallExpression(parent) && parent.getExpression() === id;
    const isImportOrExport =
      Node.isImportSpecifier(parent) ||
      Node.isExportSpecifier(parent) ||
      id.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) !== undefined;
    if (!isCall && !isImportOrExport) continue;
    if (Node.isImportSpecifier(parent) && parent.getAliasNode() === id) continue;
    out.push({
      file,
      line: id.getStartLineNumber(),
      message: `registerEntityCrud removed in 0.366 — use r.crud(…); ${UPGRADE_HINT}`,
    });
  }
  return out;
}

export function findPositionalRegistrarCalls(files: readonly SourceFile[]): ObjectFormFinding[] {
  const out: ObjectFormFinding[] = [];
  for (const sf of files) {
    if (EXCLUDED_PATH.test(sf.getFilePath())) continue;
    const file = relativeToCwd(sf.getFilePath());
    out.push(...positionalCallFindings(sf, file), ...crudFindings(sf, file));
  }
  return out;
}

export const guard: AstGuard = {
  name: "API-Object-Form Guard",
  scan: SCAN,
  hint: "Run `bun kumiko-upgrade --apply` (codemod object-form) or rewrite the call to the object form by hand; registerEntityCrud(r, …) becomes r.crud(…).",
  run(files) {
    const violations: GuardViolation[] = findPositionalRegistrarCalls(files);
    return { violations };
  },
};

if (import.meta.main) {
  runStandalone(guard);
}
