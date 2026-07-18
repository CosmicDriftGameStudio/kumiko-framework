import type { CallExpression, Node, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { RunIn } from "../../types/config";
import type { MspErrorMode } from "../../types/projection";
import type { ScreenDefinition } from "../../types/screen";
import type {
  MultiStreamProjectionPattern,
  OpaquePropMap,
  ProjectionPattern,
  ScreenPattern,
} from "../patterns";
import { SCREEN_OPAQUE_MARKER } from "../patterns";
import type { SourceLocation } from "../source-location";
import { sourceLocationFromNode } from "../source-location";
import {
  type ExtractOutput,
  fail,
  findFunctionLiteral,
  isPlainObject,
  isRawRefSentinel,
  ok,
  readDataLiteralNode,
  readNameOrRefOrList,
  readPropertyKey,
} from "./shared";

export function readApplyBodies(
  defObj: ReturnType<Node["asKind"]>,
  sourceFile: SourceFile,
): Record<string, SourceLocation> | undefined {
  if (!defObj) return undefined;
  const obj = defObj.asKind?.(SyntaxKind.ObjectLiteralExpression);
  if (!obj) return undefined;
  const applyObj = obj
    .getProperty("apply")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!applyObj) return undefined;
  const out: Record<string, SourceLocation> = {};
  for (const prop of applyObj.getProperties()) {
    const propAssign = prop.asKind(SyntaxKind.PropertyAssignment);
    if (!propAssign) return undefined;
    const init = propAssign.getInitializer();
    if (!init) return undefined;
    const fn = findFunctionLiteral(init);
    if (!fn) return undefined;
    out[readPropertyKey(propAssign)] = sourceLocationFromNode(fn, sourceFile);
  }
  return out;
}

export function extractProjection(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ProjectionPattern> {
  const arg = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!arg) {
    return fail(
      "projection",
      sourceLocationFromNode(call, sourceFile),
      "argument must be an inline ProjectionDefinition object",
    );
  }
  const nameLit = arg
    .getProperty("name")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  if (!nameLit) {
    return fail(
      "projection",
      sourceLocationFromNode(call, sourceFile),
      "name must be a string literal",
    );
  }
  const sourceInit = arg
    .getProperty("source")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  if (!sourceInit) {
    return fail(
      "projection",
      sourceLocationFromNode(call, sourceFile),
      "missing `source` property",
    );
  }
  const sourceEntity = readNameOrRefOrList(sourceInit);
  if (!sourceEntity) {
    return fail(
      "projection",
      sourceLocationFromNode(call, sourceFile),
      "source must be a string literal or array of string literals",
    );
  }
  const applyBodies = readApplyBodies(arg, sourceFile);
  if (!applyBodies) {
    return fail(
      "projection",
      sourceLocationFromNode(call, sourceFile),
      "apply must be an inline object map of event-type → function",
    );
  }
  return ok({
    kind: "projection",
    source: sourceLocationFromNode(call, sourceFile),
    name: nameLit.getLiteralValue(),
    sourceEntity,
    applyBodies,
  });
}

export function extractMultiStreamProjection(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<MultiStreamProjectionPattern> {
  const arg = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!arg) {
    return fail(
      "multiStreamProjection",
      sourceLocationFromNode(call, sourceFile),
      "argument must be an inline MultiStreamProjectionDefinition object",
    );
  }
  const nameLit = arg
    .getProperty("name")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  if (!nameLit) {
    return fail(
      "multiStreamProjection",
      sourceLocationFromNode(call, sourceFile),
      "name must be a string literal",
    );
  }
  const applyBodies = readApplyBodies(arg, sourceFile);
  if (!applyBodies) {
    return fail(
      "multiStreamProjection",
      sourceLocationFromNode(call, sourceFile),
      "apply must be an inline object map of event-type → function",
    );
  }
  const errorModeInit = arg
    .getProperty("errorMode")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  const errorMode = errorModeInit ? readDataLiteralNode(errorModeInit) : undefined;
  const runInLit = arg
    .getProperty("runIn")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  const runIn = runInLit ? (runInLit.getLiteralValue() as RunIn) : undefined;
  const deliveryLit = arg
    .getProperty("delivery")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  const delivery = deliveryLit
    ? (deliveryLit.getLiteralValue() as "shared" | "per-instance")
    : undefined;
  return ok({
    kind: "multiStreamProjection",
    source: sourceLocationFromNode(call, sourceFile),
    name: nameLit.getLiteralValue(),
    applyBodies,
    ...(isPlainObject(errorMode) && { errorMode: errorMode as MspErrorMode }),
    ...(runIn !== undefined && { runIn }),
    ...(delivery !== undefined && { delivery }),
  });
}

export function collectScreenOpaqueProps(
  node: Node,
  path: string,
  sourceFile: SourceFile,
  out: Record<string, SourceLocation>,
): void {
  const fn = findFunctionLiteral(node);
  if (fn) {
    out[path] = sourceLocationFromNode(fn, sourceFile);
  } else if (node.isKind(SyntaxKind.ObjectLiteralExpression)) {
    for (const prop of node.getProperties()) {
      const propAssign = prop.asKind(SyntaxKind.PropertyAssignment);
      if (!propAssign) continue;
      const init = propAssign.getInitializer();
      if (!init) continue;
      const key = readPropertyKey(propAssign);
      const childPath = path ? `${path}.${key}` : key;
      collectScreenOpaqueProps(init, childPath, sourceFile, out);
    }
  } else if (node.isKind(SyntaxKind.ArrayLiteralExpression)) {
    node.getElements().forEach((el, idx) => {
      collectScreenOpaqueProps(el, `${path}.${idx}`, sourceFile, out);
    });
  }
}

export function readScreenStatic(node: Node): unknown {
  if (findFunctionLiteral(node)) return SCREEN_OPAQUE_MARKER;
  const obj = node.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj) {
    const out: Record<string, unknown> = {};
    for (const prop of obj.getProperties()) {
      const propAssign = prop.asKind(SyntaxKind.PropertyAssignment);
      if (!propAssign) continue;
      const init = propAssign.getInitializer();
      if (!init) continue;
      out[readPropertyKey(propAssign)] = readScreenStatic(init);
    }
    return out;
  }
  const arr = node.asKind(SyntaxKind.ArrayLiteralExpression);
  if (arr) {
    return arr.getElements().map(readScreenStatic);
  }
  const value = readDataLiteralNode(node);
  if (value === undefined) return SCREEN_OPAQUE_MARKER;
  return value;
}

export function extractScreen(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ScreenPattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "screen",
      sourceLocationFromNode(call, sourceFile),
      "expected a ScreenDefinition object as first argument",
    );
  }
  const obj = arg.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj) {
    const raw = readDataLiteralNode(arg);
    if (!isRawRefSentinel(raw)) {
      return fail(
        "screen",
        sourceLocationFromNode(call, sourceFile),
        "argument must be an inline object literal",
      );
    }
    return ok({
      kind: "screen",
      source: sourceLocationFromNode(call, sourceFile),
      definition: raw as unknown as ScreenDefinition,
      opaqueProps: {} as OpaquePropMap,
    });
  }
  const opaqueProps: Record<string, SourceLocation> = {};
  collectScreenOpaqueProps(obj, "", sourceFile, opaqueProps);
  const definition = readScreenStatic(obj);
  if (!isPlainObject(definition)) {
    return fail(
      "screen",
      sourceLocationFromNode(call, sourceFile),
      "definition could not be read structurally",
    );
  }
  return ok({
    kind: "screen",
    source: sourceLocationFromNode(call, sourceFile),
    definition: definition as ScreenDefinition,
    opaqueProps: opaqueProps as OpaquePropMap,
  });
}
