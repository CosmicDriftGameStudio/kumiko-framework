import type { CallExpression, Node, ObjectLiteralExpression, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type {
  AiClassifyPattern,
  AiExtractPattern,
  AiGeneratePattern,
  AiStepOpaqueArgs,
  AiStepPolicy,
} from "../patterns";
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
  readStringOrRaw,
} from "./shared";

type AiStepKind = AiGeneratePattern["kind"] | AiExtractPattern["kind"] | AiClassifyPattern["kind"];

type AiStepCommonExtracted = {
  readonly source: SourceLocation;
  readonly argsSource?: AiStepOpaqueArgs;
  readonly stepKey?: string | AiStepOpaqueArgs;
  readonly promptKey?: string | AiStepOpaqueArgs;
  readonly promptFallback?: string | AiStepOpaqueArgs;
  readonly defaults?: AiStepPolicy | AiStepOpaqueArgs;
  readonly paramsSchemaSource?: SourceLocation;
};

function resolveObjectLiteralArg(node: Node): ObjectLiteralExpression | undefined {
  const direct = node.asKind(SyntaxKind.ObjectLiteralExpression);
  if (direct) return direct;
  const identifier = node.asKind(SyntaxKind.Identifier);
  if (!identifier) return undefined;
  const varDecl = node.getSourceFile().getVariableDeclaration(identifier.getText());
  return varDecl?.getInitializer()?.asKind(SyntaxKind.ObjectLiteralExpression);
}

function readPropertyInitializer(
  obj: ObjectLiteralExpression,
  propertyName: string,
): import("ts-morph").Expression | undefined {
  const prop = obj.getProperty(propertyName);
  if (!prop) return undefined;
  const assign = prop.asKind(SyntaxKind.PropertyAssignment);
  if (assign) return assign.getInitializer();
  const shorthand = prop.asKind(SyntaxKind.ShorthandPropertyAssignment);
  if (shorthand) return shorthand.getNameNode();
  return undefined;
}

function readEditableStringProp(
  obj: ObjectLiteralExpression,
  propertyName: string,
): string | AiStepOpaqueArgs | undefined {
  const init = readPropertyInitializer(obj, propertyName);
  if (!init) return undefined;
  const value = readStringOrRaw(init);
  if (value === undefined) return undefined;
  return value;
}

function readEditableDefaults(
  node: import("ts-morph").Expression,
): AiStepPolicy | AiStepOpaqueArgs | undefined {
  const value = readDataLiteralNode(node);
  if (isRawRefSentinel(value)) return value;
  if (!isPlainObject(value)) return undefined;
  if (typeof value["enabled"] !== "boolean") return undefined;
  if (!isPlainObject(value["params"])) return undefined;
  const policy: AiStepPolicy = {
    enabled: value["enabled"],
    params: value["params"] as Record<string, unknown>,
  };
  if (typeof value["providerId"] === "string") {
    return { ...policy, providerId: value["providerId"] };
  }
  if (typeof value["model"] === "string") {
    return { ...policy, model: value["model"] };
  }
  return policy;
}

function readClassifyActions(
  node: import("ts-morph").Expression,
): readonly { readonly type: string; readonly description: string }[] | undefined {
  const value = readDataLiteralNode(node);
  if (!Array.isArray(value)) return undefined;
  const out: { type: string; description: string }[] = [];
  for (const entry of value) {
    if (!isPlainObject(entry)) return undefined;
    if (typeof entry["type"] !== "string" || typeof entry["description"] !== "string") {
      return undefined;
    }
    out.push({ type: entry["type"], description: entry["description"] });
  }
  return out;
}

function extractAiStepCommon(
  call: CallExpression,
  sourceFile: SourceFile,
  kind: AiStepKind,
): ExtractOutput<AiStepCommonExtracted> {
  const source = sourceLocationFromNode(call, sourceFile);
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(kind, source, "expected one argument object");
  }

  const obj = resolveObjectLiteralArg(arg);
  if (!obj) {
    if (isRawRefSentinel(readDataLiteralNode(arg))) {
      return ok({
        source,
        argsSource: { __raw: arg.getText() },
      });
    }
    return fail(
      kind,
      source,
      "argument must be an inline object literal or a same-file const resolving to one",
    );
  }

  const stepKey = readEditableStringProp(obj, "stepKey");
  if (stepKey === undefined) {
    return fail(kind, source, "missing `stepKey` property");
  }
  const promptKey = readEditableStringProp(obj, "promptKey");
  if (promptKey === undefined) {
    return fail(kind, source, "missing `promptKey` property");
  }
  const promptFallbackInit = readPropertyInitializer(obj, "promptFallback");
  if (!promptFallbackInit) {
    return fail(kind, source, "missing `promptFallback` property");
  }
  const promptFallback = readStringOrRaw(promptFallbackInit);
  if (promptFallback === undefined) {
    return fail(kind, source, "`promptFallback` must be a string literal or identifier reference");
  }

  const defaultsInit = readPropertyInitializer(obj, "defaults");
  if (!defaultsInit) {
    return fail(kind, source, "missing `defaults` property");
  }
  const defaults = readEditableDefaults(defaultsInit);
  if (defaults === undefined) {
    return fail(kind, source, "`defaults` could not be read as a StepPolicy literal");
  }

  const paramsSchemaInit = readPropertyInitializer(obj, "paramsSchema");
  if (!paramsSchemaInit) {
    return fail(kind, source, "missing `paramsSchema` property");
  }

  return ok({
    source,
    stepKey,
    promptKey,
    promptFallback,
    defaults,
    paramsSchemaSource: sourceLocationFromNode(paramsSchemaInit, sourceFile),
  });
}

function requireResolvedCommon(
  kind: AiStepKind,
  pattern: AiStepCommonExtracted,
): ExtractOutput<
  Required<
    Pick<
      AiStepCommonExtracted,
      "stepKey" | "promptKey" | "promptFallback" | "defaults" | "paramsSchemaSource"
    >
  > & { readonly source: SourceLocation }
> {
  if (pattern.argsSource) {
    return fail(kind, pattern.source, "expected resolved inline object, got opaque args reference");
  }
  const { stepKey, promptKey, promptFallback, defaults, paramsSchemaSource, source } = pattern;
  if (
    stepKey === undefined ||
    promptKey === undefined ||
    promptFallback === undefined ||
    defaults === undefined ||
    paramsSchemaSource === undefined
  ) {
    return fail(kind, source, "resolved AI step is missing required header fields");
  }
  return ok({ source, stepKey, promptKey, promptFallback, defaults, paramsSchemaSource });
}

export function extractAiGenerate(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<AiGeneratePattern> {
  const common = extractAiStepCommon(call, sourceFile, "ai.generate");
  if (common.kind === "error") return common;
  if (common.pattern.argsSource) {
    return ok({
      kind: "ai.generate",
      source: common.pattern.source,
      argsSource: common.pattern.argsSource,
    });
  }

  const arg = call.getArguments()[0];
  const obj = arg ? resolveObjectLiteralArg(arg) : undefined;
  if (!obj) {
    return fail("ai.generate", common.pattern.source, "expected resolvable argument object");
  }
  const inputInit = readPropertyInitializer(obj, "input");
  if (!inputInit) {
    return fail("ai.generate", common.pattern.source, "missing `input` property");
  }
  const fn = findFunctionLiteral(inputInit);
  if (!fn) {
    return fail(
      "ai.generate",
      common.pattern.source,
      "`input` must be an inline arrow function or function expression",
    );
  }

  const resolved = requireResolvedCommon("ai.generate", common.pattern);
  if (resolved.kind === "error") return resolved;
  return ok({
    kind: "ai.generate",
    source: resolved.pattern.source,
    stepKey: resolved.pattern.stepKey,
    promptKey: resolved.pattern.promptKey,
    promptFallback: resolved.pattern.promptFallback,
    defaults: resolved.pattern.defaults,
    paramsSchemaSource: resolved.pattern.paramsSchemaSource,
    inputBody: sourceLocationFromNode(fn, sourceFile),
  });
}

export function extractAiExtract(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<AiExtractPattern> {
  const common = extractAiStepCommon(call, sourceFile, "ai.extract");
  if (common.kind === "error") return common;
  if (common.pattern.argsSource) {
    return ok({
      kind: "ai.extract",
      source: common.pattern.source,
      argsSource: common.pattern.argsSource,
    });
  }

  const arg = call.getArguments()[0];
  const obj = arg ? resolveObjectLiteralArg(arg) : undefined;
  if (!obj) {
    return fail("ai.extract", common.pattern.source, "expected resolvable argument object");
  }

  const outputSchemaInit = readPropertyInitializer(obj, "outputSchema");
  if (!outputSchemaInit) {
    return fail("ai.extract", common.pattern.source, "missing `outputSchema` property");
  }
  const instructionsInit = readPropertyInitializer(obj, "instructions");
  if (!instructionsInit) {
    return fail("ai.extract", common.pattern.source, "missing `instructions` property");
  }
  const instructionsFn = findFunctionLiteral(instructionsInit);
  if (!instructionsFn) {
    return fail(
      "ai.extract",
      common.pattern.source,
      "`instructions` must be an inline arrow function or function expression",
    );
  }

  const documentInit = readPropertyInitializer(obj, "document");
  let documentBody: SourceLocation | undefined;
  if (documentInit) {
    const documentFn = findFunctionLiteral(documentInit);
    if (!documentFn) {
      return fail(
        "ai.extract",
        common.pattern.source,
        "`document` must be an inline arrow function or function expression",
      );
    }
    documentBody = sourceLocationFromNode(documentFn, sourceFile);
  }

  const resolved = requireResolvedCommon("ai.extract", common.pattern);
  if (resolved.kind === "error") return resolved;
  return ok({
    kind: "ai.extract",
    source: resolved.pattern.source,
    stepKey: resolved.pattern.stepKey,
    promptKey: resolved.pattern.promptKey,
    promptFallback: resolved.pattern.promptFallback,
    defaults: resolved.pattern.defaults,
    paramsSchemaSource: resolved.pattern.paramsSchemaSource,
    outputSchemaSource: sourceLocationFromNode(outputSchemaInit, sourceFile),
    instructionsBody: sourceLocationFromNode(instructionsFn, sourceFile),
    ...(documentBody !== undefined && { documentBody }),
  });
}

export function extractAiClassify(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<AiClassifyPattern> {
  const common = extractAiStepCommon(call, sourceFile, "ai.classify");
  if (common.kind === "error") return common;
  if (common.pattern.argsSource) {
    return ok({
      kind: "ai.classify",
      source: common.pattern.source,
      argsSource: common.pattern.argsSource,
    });
  }

  const arg = call.getArguments()[0];
  const obj = arg ? resolveObjectLiteralArg(arg) : undefined;
  if (!obj) {
    return fail("ai.classify", common.pattern.source, "expected resolvable argument object");
  }

  const actionsInit = readPropertyInitializer(obj, "actions");
  if (!actionsInit) {
    return fail("ai.classify", common.pattern.source, "missing `actions` property");
  }
  const actions = readClassifyActions(actionsInit);
  if (actions === undefined) {
    return fail(
      "ai.classify",
      common.pattern.source,
      "`actions` must be an inline array of { type, description } objects",
    );
  }

  const inputInit = readPropertyInitializer(obj, "input");
  if (!inputInit) {
    return fail("ai.classify", common.pattern.source, "missing `input` property");
  }
  const inputFn = findFunctionLiteral(inputInit);
  if (!inputFn) {
    return fail(
      "ai.classify",
      common.pattern.source,
      "`input` must be an inline arrow function or function expression",
    );
  }

  const resolved = requireResolvedCommon("ai.classify", common.pattern);
  if (resolved.kind === "error") return resolved;
  return ok({
    kind: "ai.classify",
    source: resolved.pattern.source,
    stepKey: resolved.pattern.stepKey,
    promptKey: resolved.pattern.promptKey,
    promptFallback: resolved.pattern.promptFallback,
    defaults: resolved.pattern.defaults,
    paramsSchemaSource: resolved.pattern.paramsSchemaSource,
    actions,
    inputBody: sourceLocationFromNode(inputFn, sourceFile),
  });
}
