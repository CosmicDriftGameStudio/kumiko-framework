import type { CallExpression, SourceFile } from "ts-morph";
import type { TreeActionDef } from "../../types/tree-node";
import type { TreeActionsPattern, TreePattern } from "../patterns";
import { sourceLocationFromNode } from "../source-location";
import {
  ExtractOutput,
  fail,
  findFunctionLiteral,
  isPlainObject,
  ok,
  readDataLiteralNode,
} from "./shared";

export function extractTreeActions(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<TreeActionsPattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "treeActions",
      sourceLocationFromNode(call, sourceFile),
      "expected an action-map object literal as first argument",
    );
  }
  const definitions = readDataLiteralNode(arg);
  if (!isPlainObject(definitions)) {
    return fail(
      "treeActions",
      sourceLocationFromNode(call, sourceFile),
      "action-map could not be read as a plain object",
    );
  }
  return ok({
    kind: "treeActions",
    source: sourceLocationFromNode(call, sourceFile),
    definitions: definitions as Readonly<Record<string, TreeActionDef>>,
  });
}

export function extractTree(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<TreePattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "tree",
      sourceLocationFromNode(call, sourceFile),
      "expected a tree-provider function as first argument",
    );
  }
  const fn = findFunctionLiteral(arg);
  if (!fn) {
    return fail(
      "tree",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be an inline arrow function or function expression",
    );
  }
  return ok({
    kind: "tree",
    source: sourceLocationFromNode(call, sourceFile),
    providerBody: sourceLocationFromNode(fn, sourceFile),
  });
}
