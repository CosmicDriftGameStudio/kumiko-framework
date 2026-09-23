import type { CallExpression, Node, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { LifecycleHookType } from "../../constants";
import type {
  AccessRule,
  EscapeHatchDeclaration,
  RateLimitDeclaration,
} from "../../types/handlers";
import type { HookPhase } from "../../types/hooks";
import type { AuthClaimsPattern, HookPattern } from "../patterns";
import { sourceLocationFromNode } from "../source-location";
import {
  containsRawRefSentinel,
  type ExtractOutput,
  fail,
  findFunctionLiteral,
  isPlainObject,
  ok,
  type RawRefSentinel,
  readDataLiteralNode,
  readNameLiteral,
  readNameOrRef,
  readNameOrRefOrList,
  readObjectPropertyInitializer,
} from "./shared";

export type HeaderReadResult<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "raw"; readonly sentinel: RawRefSentinel }
  | { readonly kind: "unrecognized" };

// Raw-sentinel check runs before recognize: recognize narrows literals and
// would silently drop a nested reference (e.g. roles array plus a
// non-literal personalData) that the whole-object narrowing can't see.
export function readHeaderValueOrRaw<T>(
  init: Node,
  recognize: (value: unknown) => T | undefined,
): HeaderReadResult<T> {
  const value = readDataLiteralNode(init);
  if (value === undefined || containsRawRefSentinel(value)) {
    return { kind: "raw", sentinel: { __raw: init.getText() } };
  }
  const recognized = recognize(value);
  if (recognized === undefined) return { kind: "unrecognized" };
  return { kind: "value", value: recognized };
}

export function isHookType(value: string): value is LifecycleHookType | "validation" {
  return (
    value === "preSave" ||
    value === "postSave" ||
    value === "preDelete" ||
    value === "postDelete" ||
    value === "preQuery" ||
    value === "validation"
  );
}

export function readOptionalPhase(node: Node | undefined): HookPhase | undefined {
  if (!node) return undefined;
  const obj = readDataLiteralNode(node);
  if (!isPlainObject(obj)) return undefined;
  const phase = obj["phase"];
  if (phase === "inTransaction" || phase === "afterCommit") return phase as HookPhase;
  return undefined;
}

// `openToAll: true` (deprecated) is not recognised here — isOpenToAllGranted never grants it, so extracting it would round-trip a rule that looks configured but denies everyone.
export function readOptionalAccessRule(value: unknown): AccessRule | undefined {
  if (!isPlainObject(value)) return undefined;
  if (Array.isArray(value["roles"]) && value["roles"].every((r) => typeof r === "string")) {
    const personalData =
      value["personalData"] === "public-intake" ? { personalData: "public-intake" as const } : {};
    return { roles: value["roles"] as readonly string[], ...personalData };
  }
  const openToAll = value["openToAll"];
  if (isPlainObject(openToAll) && typeof openToAll["reason"] === "string") {
    const personalData =
      openToAll["personalData"] === "tenant-members"
        ? { personalData: "tenant-members" as const }
        : {};
    return { openToAll: { reason: openToAll["reason"], ...personalData } };
  }
  return undefined;
}

export function readOptionalRateLimit(value: unknown): RateLimitDeclaration | undefined {
  if (!isPlainObject(value)) return undefined;
  if (value["disabled"] === true) {
    // Strict shape: exactly { disabled: true, reason } — anything extra
    // isn't RateLimitDisabled and falls through to "unrecognized".
    if (typeof value["reason"] !== "string") return undefined;
    if (Object.keys(value).length !== 2) return undefined;
    return { disabled: true, reason: value["reason"] };
  }
  if (typeof value["per"] !== "string") return undefined;
  if (typeof value["limit"] !== "number") return undefined;
  if (typeof value["windowSeconds"] !== "number") return undefined;
  return value as unknown as RateLimitDeclaration;
}

export function readOptionalEscapeHatch(value: unknown): EscapeHatchDeclaration | undefined {
  if (!isPlainObject(value)) return undefined;
  if (typeof value["reason"] !== "string") return undefined;
  return { reason: value["reason"] };
}

// Reads the `escapeHatch` sub-property node first, not via readDataLiteralNode
// on the whole object: a sibling property like `handler` (a closure) isn't
// representable as plain data, which would make the whole-object read
// return undefined. undefined means the property is absent, not an error.
function readOptionalHookEscapeHatch(
  node: Node | undefined,
): HeaderReadResult<EscapeHatchDeclaration> | undefined {
  const obj = node?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj) return undefined;
  const init = readObjectPropertyInitializer(obj, "escapeHatch");
  if (!init) return undefined;
  return readHeaderValueOrRaw(init, readOptionalEscapeHatch);
}

// Resolves the hook's escapeHatch into either a field to spread into the
// pattern, or a ParseError for a fully literal but unrecognized shape.
function readHookEscapeHatch(
  node: Node | undefined,
  call: CallExpression,
  sourceFile: SourceFile,
): { readonly escapeHatch?: EscapeHatchDeclaration | RawRefSentinel } | ReturnType<typeof fail> {
  const result = readOptionalHookEscapeHatch(node);
  if (!result) return {};
  if (result.kind === "unrecognized") {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      "escapeHatch must be { reason: string }, or a reference to one",
    );
  }
  return { escapeHatch: result.kind === "value" ? result.value : result.sentinel };
}

// r.hook's target: a NameOrRef, a list of them, or an entity-wide
// `{ allOf: entityRef }` (replaces the old r.entityHook(type, entity, fn)).
// Checked first so a malformed `{ allOf }` doesn't silently fall through
// to being read as some other object shape.
function readHookTarget(
  node: Node,
): string | readonly string[] | { readonly allOf: string } | undefined {
  const obj = node.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj) {
    const allOfProp = obj.getProperty("allOf")?.asKind(SyntaxKind.PropertyAssignment);
    if (allOfProp) {
      const initializer = allOfProp.getInitializer();
      const entityName = initializer && readNameOrRef(initializer);
      return entityName ? { allOf: entityName } : undefined;
    }
  }
  return readNameOrRefOrList(node);
}

export function extractHook(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<HookPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail("hook", sourceLocationFromNode(call, sourceFile), "expected at least one argument");
  }

  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const typeInit = obj
      .getProperty("type")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!typeInit) {
      return fail(
        "hook",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `type` property",
      );
    }
    const hookType = typeInit.getLiteralValue();
    if (!isHookType(hookType)) {
      return fail(
        "hook",
        sourceLocationFromNode(call, sourceFile),
        `hook type "${hookType}" is not one of the lifecycle types or "validation"`,
      );
    }
    const targetInit = obj
      .getProperty("target")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!targetInit) {
      return fail(
        "hook",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `target` property",
      );
    }
    const target = readHookTarget(targetInit);
    if (!target) {
      return fail(
        "hook",
        sourceLocationFromNode(call, sourceFile),
        "target must be a string literal, an inline { name } object, or an array",
      );
    }
    const handlerInit = obj
      .getProperty("handler")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!handlerInit) {
      return fail(
        "hook",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `handler` property",
      );
    }
    const fn = findFunctionLiteral(handlerInit);
    if (!fn) {
      return fail(
        "hook",
        sourceLocationFromNode(call, sourceFile),
        "handler must be an inline arrow function or function expression",
      );
    }
    const phase = readOptionalPhase(obj);
    const escapeHatchOutcome = readHookEscapeHatch(obj, call, sourceFile);
    if ("kind" in escapeHatchOutcome) return escapeHatchOutcome;
    return ok({
      kind: "hook",
      source: sourceLocationFromNode(call, sourceFile),
      hookType,
      target,
      fnBody: sourceLocationFromNode(fn, sourceFile),
      ...(phase !== undefined && { phase }),
      ...escapeHatchOutcome,
    });
  }

  const hookType = readNameLiteral(first);
  if (hookType === undefined) {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal hook type, or an identifier resolving to one (or use the object form)",
    );
  }
  if (!isHookType(hookType)) {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      `hook type "${hookType}" is not one of the lifecycle types or "validation"`,
    );
  }
  const targetArg = args[1];
  if (!targetArg) {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      "expected a target (NameOrRef or array) as second argument",
    );
  }
  const target = readHookTarget(targetArg);
  if (!target) {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      "target must be a string literal, an inline { name } object, or an array",
    );
  }
  const fnArg = args[2];
  if (!fnArg) {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      "expected a hook function as third argument",
    );
  }
  const fn = findFunctionLiteral(fnArg);
  if (!fn) {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      "third argument must be an inline arrow function or function expression",
    );
  }
  const phase = readOptionalPhase(args[3]);
  const escapeHatchOutcome = readHookEscapeHatch(args[3], call, sourceFile);
  if ("kind" in escapeHatchOutcome) return escapeHatchOutcome;
  return ok({
    kind: "hook",
    source: sourceLocationFromNode(call, sourceFile),
    hookType,
    target,
    fnBody: sourceLocationFromNode(fn, sourceFile),
    ...(phase !== undefined && { phase }),
    ...escapeHatchOutcome,
  });
}

// guard:dup-ok — intentionale Parallele zu extractTree (round6); verschiedene Feature-AST-Extraktoren by design
export function extractAuthClaims(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<AuthClaimsPattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "authClaims",
      sourceLocationFromNode(call, sourceFile),
      "expected a function as first argument",
    );
  }
  const fn = findFunctionLiteral(arg);
  if (!fn) {
    return fail(
      "authClaims",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be an inline arrow function or function expression",
    );
  }
  return ok({
    kind: "authClaims",
    source: sourceLocationFromNode(call, sourceFile),
    fnBody: sourceLocationFromNode(fn, sourceFile),
  });
}
