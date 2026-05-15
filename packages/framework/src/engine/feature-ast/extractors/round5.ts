import type { CallExpression, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { ExposesApiPattern, ExtendsRegistrarPattern, UsesApiPattern } from "../patterns";
import { sourceLocationFromNode } from "../source-location";
import { type ExtractOutput, fail, ok } from "./shared";

export function extractExtendsRegistrar(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ExtendsRegistrarPattern> {
  const args = call.getArguments();
  const nameArg = args[0]?.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "extendsRegistrar",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal extension name",
    );
  }
  const defArg = args[1];
  if (!defArg) {
    return fail(
      "extendsRegistrar",
      sourceLocationFromNode(call, sourceFile),
      "expected a definition argument",
    );
  }
  return ok({
    kind: "extendsRegistrar",
    source: sourceLocationFromNode(call, sourceFile),
    extensionName: nameArg.getLiteralValue(),
    defBody: sourceLocationFromNode(defArg, sourceFile),
  });
}

export function extractUsesApi(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<UsesApiPattern> {
  const arg = call.getArguments()[0]?.asKind(SyntaxKind.StringLiteral);
  if (!arg) {
    return fail(
      "usesApi",
      sourceLocationFromNode(call, sourceFile),
      'expected a single string-literal API name (e.g. "sessions.revokeAllForUser")',
    );
  }
  return ok({
    kind: "usesApi",
    source: sourceLocationFromNode(call, sourceFile),
    apiName: arg.getLiteralValue(),
  });
}

export function extractExposesApi(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ExposesApiPattern> {
  const arg = call.getArguments()[0]?.asKind(SyntaxKind.StringLiteral);
  if (!arg) {
    return fail(
      "exposesApi",
      sourceLocationFromNode(call, sourceFile),
      'expected a single string-literal API name (e.g. "sessions.revokeAllForUser")',
    );
  }
  return ok({
    kind: "exposesApi",
    source: sourceLocationFromNode(call, sourceFile),
    apiName: arg.getLiteralValue(),
  });
}
