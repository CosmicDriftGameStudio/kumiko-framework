import type {
  ClaimKeyType,
  ConfigKeyDefinition,
  ConfigKeyType,
  SecretNamespaceOptions,
  TranslationKeys,
} from "@cosmicdrift/kumiko-framework/engine";
import type { MetricOptions, SecretOptions } from "@cosmicdrift/kumiko-types/feature";
import type { CallExpression, ObjectLiteralExpression, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { ParseError } from "../parse.ts";
import type {
  ClaimKeyPattern,
  ConfigPattern,
  MetricPattern,
  ReferenceDataPattern,
  SecretNamespacePattern,
  SecretPattern,
  TranslationsPattern,
  UseExtensionPattern,
} from "../patterns.ts";
import { sourceLocationFromNode } from "../source-location.ts";
import {
  type ExtractOutput,
  fail,
  isPlainObject,
  ok,
  type ReadDataLiteralOptions,
  readDataLiteralNode,
  readNameLiteralRef,
  readNameOrRef,
} from "./shared.ts";

export type NamedOptionsResult =
  | { readonly kind: "ok"; readonly name: string; readonly options: Record<string, unknown> }
  | { readonly kind: "error"; readonly error: ParseError };

export function readNamedOptions(
  call: CallExpression,
  sourceFile: SourceFile,
  methodName: string,
  readOptions: ReadDataLiteralOptions = {},
): NamedOptionsResult {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj || args.length !== 1) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "expected a single options object",
    );
  }
  const nameInit = obj
    .getProperty("name")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  if (!nameInit) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "options object requires a string-literal `name` property",
    );
  }
  const data = readDataLiteralNode(obj, readOptions);
  if (!isPlainObject(data)) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "argument could not be read as a plain object",
    );
  }
  const { name: _name, ...optionsWithoutName } = data;
  return { kind: "ok", name: nameInit.getLiteralValue(), options: optionsWithoutName };
}

export function extractConfig(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ConfigPattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "config",
      sourceLocationFromNode(call, sourceFile),
      "expected `{ keys: { ... } }` as first argument",
    );
  }
  const obj = readDataLiteralNode(arg);
  if (!isPlainObject(obj)) {
    return fail(
      "config",
      sourceLocationFromNode(call, sourceFile),
      "argument could not be read as a plain object",
    );
  }
  const keys = obj["keys"];
  if (!isPlainObject(keys)) {
    return fail(
      "config",
      sourceLocationFromNode(call, sourceFile),
      "missing or non-object `keys` property",
    );
  }
  return ok({
    kind: "config",
    source: sourceLocationFromNode(call, sourceFile),
    keys: keys as Readonly<Record<string, ConfigKeyDefinition<ConfigKeyType>>>,
  });
}

export function extractTranslations(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<TranslationsPattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "translations",
      sourceLocationFromNode(call, sourceFile),
      "expected `{ keys: { ... } }` as first argument",
    );
  }
  const obj = readDataLiteralNode(arg);
  if (!isPlainObject(obj)) {
    return fail(
      "translations",
      sourceLocationFromNode(call, sourceFile),
      "argument could not be read as a plain object",
    );
  }
  const keys = obj["keys"];
  if (!isPlainObject(keys)) {
    return fail(
      "translations",
      sourceLocationFromNode(call, sourceFile),
      "missing or non-object `keys` property",
    );
  }
  return ok({
    kind: "translations",
    source: sourceLocationFromNode(call, sourceFile),
    keys: keys as TranslationKeys,
  });
}

export function extractMetric(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<MetricPattern> {
  const parsed = readNamedOptions(call, sourceFile, "metric");
  if (parsed.kind === "error") return parsed;
  return ok({
    kind: "metric",
    source: sourceLocationFromNode(call, sourceFile),
    shortName: parsed.name,
    options: parsed.options as MetricOptions,
  });
}

export function extractSecret(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<SecretPattern> {
  const parsed = readNamedOptions(call, sourceFile, "secret", { functionValuesAsRaw: true });
  if (parsed.kind === "error") return parsed;
  return ok({
    kind: "secret",
    source: sourceLocationFromNode(call, sourceFile),
    shortName: parsed.name,
    options: parsed.options as SecretOptions,
  });
}

export function extractSecretNamespace(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<SecretNamespacePattern> {
  const parsed = readNamedOptions(call, sourceFile, "secretNamespace");
  if (parsed.kind === "error") return parsed;
  return ok({
    kind: "secretNamespace",
    source: sourceLocationFromNode(call, sourceFile),
    shortName: parsed.name,
    options: parsed.options as SecretNamespaceOptions,
  });
}

export function isClaimKeyType(value: unknown): value is ClaimKeyType {
  return (
    value === "string" ||
    value === "number" ||
    value === "boolean" ||
    value === "string[]" ||
    value === "object"
  );
}

export function extractClaimKey(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ClaimKeyPattern> {
  const parsed = readNamedOptions(call, sourceFile, "claimKey");
  if (parsed.kind === "error") return parsed;
  const claimType = parsed.options["type"];
  if (!isClaimKeyType(claimType)) {
    return fail(
      "claimKey",
      sourceLocationFromNode(call, sourceFile),
      'type must be one of "string" | "number" | "boolean" | "string[]" | "object"',
    );
  }
  return ok({
    kind: "claimKey",
    source: sourceLocationFromNode(call, sourceFile),
    shortName: parsed.name,
    claimType,
  });
}

export function extractReferenceData(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<ReferenceDataPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "referenceData",
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj || args.length !== 1) {
    return fail(
      "referenceData",
      sourceLocationFromNode(call, sourceFile),
      "expected a single options object",
    );
  }
  const entityInit = obj.getProperty("entity")?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
  if (!entityInit) {
    return fail(
      "referenceData",
      sourceLocationFromNode(call, sourceFile),
      "options object requires an `entity` property",
    );
  }
  const entityName = readNameOrRef(entityInit);
  if (!entityName) {
    return fail(
      "referenceData",
      sourceLocationFromNode(call, sourceFile),
      '`entity` must be a string literal or `{ name: "..." }` ref',
    );
  }
  const dataInit = obj.getProperty("data")?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
  if (!dataInit) {
    return fail(
      "referenceData",
      sourceLocationFromNode(call, sourceFile),
      "options object requires a `data` property",
    );
  }
  const data = readDataLiteralNode(dataInit);
  if (!Array.isArray(data) || !data.every(isPlainObject)) {
    return fail(
      "referenceData",
      sourceLocationFromNode(call, sourceFile),
      "data must be an array of plain objects",
    );
  }
  const upsertKeyInit = obj
    .getProperty("upsertKey")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  return ok({
    kind: "referenceData",
    source: sourceLocationFromNode(call, sourceFile),
    entityName,
    data: data as readonly Record<string, unknown>[],
    ...(upsertKeyInit !== undefined && { upsertKey: upsertKeyInit.getLiteralValue() }),
  });
}

const USE_EXTENSION_READ_OPTIONS = { functionValuesAsRaw: true } as const;

// Options sit inline next to name and entity. A single `...ref` spread stays a raw reference.
function readApplyExtensionOptions(
  obj: ObjectLiteralExpression,
): Readonly<Record<string, unknown>> | { readonly __raw: string } | undefined | "unreadable" {
  const extras = obj.getProperties().filter((property) => {
    const propertyName = property.asKind(SyntaxKind.PropertyAssignment)?.getName();
    return propertyName !== "name" && propertyName !== "entity";
  });
  if (extras.length === 0) return undefined;
  const [onlyExtra] = extras;
  const spread = onlyExtra?.asKind(SyntaxKind.SpreadAssignment);
  if (extras.length === 1 && spread) return { __raw: spread.getExpression().getText() };
  const options: Record<string, unknown> = {};
  for (const property of extras) {
    const assignment = property.asKind(SyntaxKind.PropertyAssignment);
    const init = assignment?.getInitializer();
    if (assignment === undefined || init === undefined) return "unreadable";
    options[assignment.getName()] = readDataLiteralNode(init, USE_EXTENSION_READ_OPTIONS);
  }
  return options;
}

export function extractUseExtension(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<UseExtensionPattern> {
  const args = call.getArguments();
  const obj = args[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj || args.length !== 1) {
    return fail(
      "useExtension",
      sourceLocationFromNode(call, sourceFile),
      "expected a single options object",
    );
  }
  const nameInit = obj.getProperty("name")?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
  const extensionNameRef = nameInit === undefined ? undefined : readNameLiteralRef(nameInit);
  if (extensionNameRef === undefined) {
    return fail(
      "useExtension",
      sourceLocationFromNode(call, sourceFile),
      "options object requires a `name` that is a string literal or an identifier resolving to one",
    );
  }
  const entityInit = obj
    .getProperty("entity")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  const entityName = entityInit === undefined ? undefined : readNameOrRef(entityInit);
  if (entityName === undefined) {
    return fail(
      "useExtension",
      sourceLocationFromNode(call, sourceFile),
      '`entity` must be a string literal or `{ name: "..." }` ref',
    );
  }
  const options = readApplyExtensionOptions(obj);
  if (options === "unreadable" || (options !== undefined && !isPlainObject(options))) {
    return fail(
      "useExtension",
      sourceLocationFromNode(call, sourceFile),
      "options could not be read as a plain object",
    );
  }
  return ok({
    kind: "useExtension",
    source: sourceLocationFromNode(call, sourceFile),
    extensionName: extensionNameRef.value,
    ...(extensionNameRef.raw !== undefined && { extensionNameRaw: extensionNameRef.raw }),
    entityName,
    ...(options !== undefined && { options }),
  });
}
