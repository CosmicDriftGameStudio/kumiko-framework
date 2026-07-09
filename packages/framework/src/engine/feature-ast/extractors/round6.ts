import type { CallExpression, SourceFile } from "ts-morph";
import type { TreeActionDef } from "../../types/tree-node";
import type { TreeActionsPattern } from "../patterns";
import { sourceLocationFromNode } from "../source-location";
import { type ExtractOutput, fail, isPlainObject, ok, readDataLiteralNode } from "./shared";

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
