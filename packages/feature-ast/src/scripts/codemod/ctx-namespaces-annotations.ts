import { Node, Project, type SourceFile, SyntaxKind, type Type } from "ts-morph";
import { ensureNamedImport, removeNamedImport } from "./codemod-support.ts";
import type { EditPlan } from "./ctx-namespaces-edits.ts";
import type { ContextKind } from "./ctx-namespaces-mapping.ts";

export interface NamedImportNeed {
  readonly specifier: string;
  readonly name: string;
  readonly isTypeOnly: boolean;
}

export class Counters {
  contextReceivers = 0;
  readonly imports: NamedImportNeed[] = [];
  readonly droppedImports = new Set<string>();
  // Hook parameters annotated AppContext whose annotation is rewritten in this run: their body is
  // already read as a handler context.
  readonly pinnedParameters = new Set<Node>();

  pinnedKindOf(expression: Node): ContextKind | undefined {
    if (!Node.isIdentifier(expression)) return undefined;
    const declarations = expression.getSymbol()?.getDeclarations() ?? [];
    return declarations.some((declaration) => this.pinnedParameters.has(declaration))
      ? "handler"
      : undefined;
  }
}

const PHASE_CONTEXT_BY_PROPERTY: ReadonlyMap<string, string> = new Map([
  ["beforeTransaction", "BeforeTransactionContext"],
  ["reserveBeforeTransaction", "ReservationContext"],
]);

const HOOK_FN_ALIASES: ReadonlySet<string> = new Set([
  "PreSaveHookFn",
  "PostSaveHookFn",
  "PostSaveBatchHookFn",
  "PreDeleteHookFn",
  "PostDeleteHookFn",
  "PostDeleteBatchHookFn",
  "PostQueryHookFn",
]);

function importOf(sourceFile: SourceFile, name: string): NamedImportNeed | undefined {
  for (const declaration of sourceFile.getImportDeclarations()) {
    const named = declaration.getNamedImports().find((entry) => entry.getName() === name);
    if (named !== undefined && named.getAliasNode() === undefined) {
      return {
        specifier: declaration.getModuleSpecifierValue(),
        name,
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

export function planPhaseAnnotation(plan: EditPlan, counters: Counters, node: Node): boolean {
  if (!Node.isPropertyAssignment(node) && !Node.isMethodDeclaration(node)) return false;
  const phaseContext = PHASE_CONTEXT_BY_PROPERTY.get(node.getName());
  const fn = phaseFunctionOf(node);
  if (phaseContext === undefined || fn === undefined) return false;
  if (
    !(Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) || Node.isMethodDeclaration(fn))
  ) {
    return false;
  }
  for (const parameter of fn.getParameters()) {
    const annotation = parameter.getTypeNode();
    if (
      !Node.isTypeReference(annotation) ||
      annotation.getTypeName().getText() !== "HandlerContext"
    ) {
      continue;
    }
    const imported = importOf(plan.sourceFile, "HandlerContext");
    if (imported === undefined) {
      plan.flagManual(
        annotation,
        "HandlerContext annotation of a phase hook is not a named import",
      );
      continue;
    }
    counters.imports.push({ ...imported, name: phaseContext });
    counters.droppedImports.add("HandlerContext");
    plan.replaceNode(annotation.getTypeName(), phaseContext);
    plan.recordRewrite(annotation, `HandlerContext -> ${phaseContext}`);
  }
  return true;
}

function isHandlerContextType(type: Type): boolean {
  const constituents = type.isIntersection() ? type.getIntersectionTypes() : [type];
  return constituents.some((entry) => entry.getAliasSymbol()?.getName() === "HandlerContext");
}

function expectsHandlerContext(parameter: Node): boolean {
  if (!Node.isParameterDeclaration(parameter)) return false;
  const fn = parameter.getParent();
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false;
  const contextual = fn.getContextualType();
  if (contextual === undefined) return false;
  const alias = contextual.getAliasSymbol()?.getName();
  if (alias !== undefined && HOOK_FN_ALIASES.has(alias)) return true;
  const signature = contextual.getNonNullableType().getCallSignatures()[0];
  const index = fn.getParameters().indexOf(parameter);
  const expected = signature?.getParameters()[index]?.getTypeAtLocation(fn);
  return expected !== undefined && isHandlerContextType(expected);
}

export function appContextReference(annotation: Node | undefined): Node | undefined {
  if (Node.isTypeReference(annotation)) {
    return annotation.getTypeName().getText() === "AppContext" ? annotation : undefined;
  }
  if (Node.isIntersectionTypeNode(annotation)) {
    return annotation.getTypeNodes().find((member) => appContextReference(member) !== undefined);
  }
  return undefined;
}

// A hook receives the HandlerContext now. The body is read as a handler context in the same run,
// so `context.log` becomes `context.obs.log` without a second pass.
export function planHookAnnotation(plan: EditPlan, counters: Counters, parameter: Node): boolean {
  if (!Node.isParameterDeclaration(parameter)) return false;
  const reference = appContextReference(parameter.getTypeNode());
  if (!Node.isTypeReference(reference) || !expectsHandlerContext(parameter)) return false;
  const imported = importOf(plan.sourceFile, "AppContext");
  if (imported === undefined) {
    plan.flagManual(reference, "AppContext annotation of a hook is not a named import");
    return false;
  }
  counters.imports.push({ ...imported, name: "HandlerContext" });
  counters.droppedImports.add("AppContext");
  counters.pinnedParameters.add(parameter);
  plan.replaceNode(reference.getTypeName(), "HandlerContext");
  plan.recordRewrite(reference, "AppContext -> HandlerContext (hook parameter)");
  return true;
}

function dropImportWhenUnused(sourceFile: SourceFile, name: string): void {
  const stillUsed = sourceFile
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some(
      (identifier) =>
        identifier.getText() === name &&
        identifier.getFirstAncestorByKind(SyntaxKind.ImportDeclaration) === undefined,
    );
  // skip: the name is still referenced, so its import stays
  if (stillUsed) return;
  for (const declaration of sourceFile.getImportDeclarations()) {
    const named = declaration.getNamedImports().find((entry) => entry.getName() === name);
    if (named !== undefined) removeNamedImport(sourceFile, declaration, named);
  }
}

export function withImports(output: string, filePath: string, counters: Counters): string {
  if (counters.imports.length === 0) return output;
  const scratch = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const sourceFile = scratch.createSourceFile(filePath, output);
  for (const need of counters.imports) {
    ensureNamedImport(sourceFile, need.specifier, need.name, need.isTypeOnly);
  }
  for (const name of counters.droppedImports) dropImportWhenUnused(sourceFile, name);
  return sourceFile.getFullText();
}
