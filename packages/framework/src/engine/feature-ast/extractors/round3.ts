import type { CallExpression, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { ConfigKeyDefinition, ConfigKeyType, TranslationKeys } from "../../types/config";
import type { MetricOptions, SecretOptions } from "../../types/feature";
import type { ClaimKeyType } from "../../types/handlers";
import type { ParseError } from "../parse";
import type {
  ClaimKeyPattern,
  ConfigPattern,
  MetricPattern,
  ReferenceDataPattern,
  SecretPattern,
  TranslationsPattern,
  UseExtensionPattern,
} from "../patterns";
import { sourceLocationFromNode } from "../source-location";
import {
  type ExtractOutput,
  fail,
  isPlainObject,
  ok,
  readDataLiteralNode,
  readNameOrRef,
} from "./shared";

export type NamedOptionsResult =
  | { readonly kind: "ok"; readonly name: string; readonly options: Record<string, unknown> }
  | { readonly kind: "error"; readonly error: ParseError };

export function readNamedOptions(
  call: CallExpression,
  sourceFile: SourceFile,
  methodName: string,
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
  if (obj && args.length === 1) {
    const nameInit = obj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameInit) {
      return fail(
        methodName,
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const data = readDataLiteralNode(obj);
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

  const nameLiteral = first.asKind(SyntaxKind.StringLiteral);
  if (!nameLiteral) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal name (or use the object form)",
    );
  }
  const optionsArg = args[1];
  if (!optionsArg) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "expected an options object as second argument",
    );
  }
  const options = readDataLiteralNode(optionsArg);
  if (!isPlainObject(options)) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "options could not be read as a plain object",
    );
  }
  return { kind: "ok", name: nameLiteral.getLiteralValue(), options };
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
  const parsed = readNamedOptions(call, sourceFile, "secret");
  if (parsed.kind === "error") return parsed;
  return ok({
    kind: "secret",
    source: sourceLocationFromNode(call, sourceFile),
    shortName: parsed.name,
    options: parsed.options as SecretOptions,
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
  if (obj && args.length === 1) {
    const entityInit = obj
      .getProperty("entity")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!entityInit) {
      return fail(
        "referenceData",
        sourceLocationFromNode(call, sourceFile),
        "object form requires an `entity` property",
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
    const dataInit = obj
      .getProperty("data")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!dataInit) {
      return fail(
        "referenceData",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `data` property",
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
    let upsertKey: string | undefined;
    const upsertKeyInit = obj
      .getProperty("upsertKey")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (upsertKeyInit) {
      upsertKey = upsertKeyInit.getLiteralValue();
    }
    return ok({
      kind: "referenceData",
      source: sourceLocationFromNode(call, sourceFile),
      entityName,
      data: data as readonly Record<string, unknown>[],
      ...(upsertKey !== undefined && { upsertKey }),
    });
  }

  const entityName = readNameOrRef(first);
  if (!entityName) {
    return fail(
      "referenceData",
      sourceLocationFromNode(call, sourceFile),
      'first argument must be a string literal or an inline { name: "..." } object (or use the object form)',
    );
  }
  const dataArg = args[1];
  if (!dataArg) {
    return fail(
      "referenceData",
      sourceLocationFromNode(call, sourceFile),
      "expected a data array as second argument",
    );
  }
  const data = readDataLiteralNode(dataArg);
  if (!Array.isArray(data) || !data.every(isPlainObject)) {
    return fail(
      "referenceData",
      sourceLocationFromNode(call, sourceFile),
      "data must be an array of plain objects",
    );
  }
  let upsertKey: string | undefined;
  const optionsArg = args[2];
  if (optionsArg) {
    const options = readDataLiteralNode(optionsArg);
    if (!isPlainObject(options)) {
      return fail(
        "referenceData",
        sourceLocationFromNode(call, sourceFile),
        "options could not be read as a plain object",
      );
    }
    if (options["upsertKey"] !== undefined) {
      if (typeof options["upsertKey"] !== "string") {
        return fail(
          "referenceData",
          sourceLocationFromNode(call, sourceFile),
          "upsertKey must be a string when provided",
        );
      }
      upsertKey = options["upsertKey"];
    }
  }
  return ok({
    kind: "referenceData",
    source: sourceLocationFromNode(call, sourceFile),
    entityName,
    data: data as readonly Record<string, unknown>[],
    ...(upsertKey !== undefined && { upsertKey }),
  });
}

export function extractUseExtension(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<UseExtensionPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "useExtension",
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const nameInit = obj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameInit) {
      return fail(
        "useExtension",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const entityInit = obj
      .getProperty("entity")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!entityInit) {
      return fail(
        "useExtension",
        sourceLocationFromNode(call, sourceFile),
        "object form requires an `entity` property",
      );
    }
    const entityName = readNameOrRef(entityInit);
    if (!entityName) {
      return fail(
        "useExtension",
        sourceLocationFromNode(call, sourceFile),
        '`entity` must be a string literal or `{ name: "..." }` ref',
      );
    }
    let options: Readonly<Record<string, unknown>> | undefined;
    const optionsInit = obj
      .getProperty("options")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (optionsInit) {
      const parsed = readDataLiteralNode(optionsInit);
      if (!isPlainObject(parsed)) {
        return fail(
          "useExtension",
          sourceLocationFromNode(call, sourceFile),
          "options could not be read as a plain object",
        );
      }
      options = parsed;
    }
    return ok({
      kind: "useExtension",
      source: sourceLocationFromNode(call, sourceFile),
      extensionName: nameInit.getLiteralValue(),
      entityName,
      ...(options !== undefined && { options }),
    });
  }

  const nameArg = first.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "useExtension",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal extension name (or use the object form)",
    );
  }
  const entityRefArg = args[1];
  if (!entityRefArg) {
    return fail(
      "useExtension",
      sourceLocationFromNode(call, sourceFile),
      "expected an entity reference as second argument",
    );
  }
  const entityName = readNameOrRef(entityRefArg);
  if (!entityName) {
    return fail(
      "useExtension",
      sourceLocationFromNode(call, sourceFile),
      'second argument must be a string literal or an inline { name: "..." } object',
    );
  }
  const optionsArg = args[2];
  let options: Readonly<Record<string, unknown>> | undefined;
  if (optionsArg) {
    const parsed = readDataLiteralNode(optionsArg);
    if (!isPlainObject(parsed)) {
      return fail(
        "useExtension",
        sourceLocationFromNode(call, sourceFile),
        "options could not be read as a plain object",
      );
    }
    options = parsed;
  }
  return ok({
    kind: "useExtension",
    source: sourceLocationFromNode(call, sourceFile),
    extensionName: nameArg.getLiteralValue(),
    entityName,
    ...(options !== undefined && { options }),
  });
}
