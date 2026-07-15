import type { CallExpression, SourceFile } from "ts-morph";
import type {
  DescribePattern,
  OptionalRequiresPattern,
  ReadsConfigPattern,
  RequiresPattern,
  SystemScopePattern,
  ToggleablePattern,
  UiHintsPattern,
} from "../patterns";
import { sourceLocationFromNode } from "../source-location";
import {
  type ExtractOutput,
  fail,
  ok,
  readBooleanProperty,
  readStringLiteralArgs,
  readVarargsOrArrayProp,
} from "./shared";

export function extractRequires(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<RequiresPattern> {
  const names = readVarargsOrArrayProp(call, "features");
  if (!names) {
    return fail(
      "requires",
      sourceLocationFromNode(call, sourceFile),
      "expected positional string literals or { features: string[] }",
    );
  }
  return ok({
    kind: "requires",
    source: sourceLocationFromNode(call, sourceFile),
    featureNames: names as readonly string[],
  });
}

export function extractOptionalRequires(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<OptionalRequiresPattern> {
  const names = readVarargsOrArrayProp(call, "features");
  if (!names) {
    return fail(
      "optionalRequires",
      sourceLocationFromNode(call, sourceFile),
      "expected positional string literals or { features: string[] }",
    );
  }
  return ok({
    kind: "optionalRequires",
    source: sourceLocationFromNode(call, sourceFile),
    featureNames: names as readonly string[],
  });
}

export function extractReadsConfig(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ReadsConfigPattern> {
  const keys = readVarargsOrArrayProp(call, "keys");
  if (!keys) {
    return fail(
      "readsConfig",
      sourceLocationFromNode(call, sourceFile),
      "expected positional string literals or { keys: string[] }",
    );
  }
  return ok({
    kind: "readsConfig",
    source: sourceLocationFromNode(call, sourceFile),
    qualifiedKeys: keys as readonly string[],
  });
}

export function extractSystemScope(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<SystemScopePattern> {
  return ok({
    kind: "systemScope",
    source: sourceLocationFromNode(call, sourceFile),
  });
}

export function extractUiHints(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<UiHintsPattern> {
  return ok({
    kind: "uiHints",
    source: sourceLocationFromNode(call, sourceFile),
  });
}

export function extractDescribe(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<DescribePattern> {
  const args = readStringLiteralArgs(call);
  const text = args?.[0];
  if (text === undefined || args?.length !== 1) {
    return fail(
      "describe",
      sourceLocationFromNode(call, sourceFile),
      "expected a single string literal",
    );
  }
  // Mirrors the define-feature boot guard: whitespace-only describes throw
  // at boot — the AST path must reject them too, and store the TRIMMED
  // text so render output matches the runtime/manifest value.
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return fail("describe", sourceLocationFromNode(call, sourceFile), "must be a non-empty string");
  }
  return ok({
    kind: "describe",
    source: sourceLocationFromNode(call, sourceFile),
    text: trimmed,
  });
}

export function extractToggleable(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ToggleablePattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "toggleable",
      sourceLocationFromNode(call, sourceFile),
      "expected an object argument with a `default` boolean",
    );
  }
  const defaultValue = readBooleanProperty(arg, "default");
  if (defaultValue === undefined) {
    return fail(
      "toggleable",
      sourceLocationFromNode(call, sourceFile),
      "argument must be `{ default: true | false }`",
    );
  }
  return ok({
    kind: "toggleable",
    source: sourceLocationFromNode(call, sourceFile),
    default: defaultValue,
  });
}
