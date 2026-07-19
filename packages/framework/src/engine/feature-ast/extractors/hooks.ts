import type { CallExpression, Node, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { LifecycleHookType } from "../../constants";
import type { AccessRule, RateLimitOption } from "../../types/handlers";
import type { HookPhase } from "../../types/hooks";
import type { AuthClaimsPattern, HookPattern } from "../patterns";
import { sourceLocationFromNode } from "../source-location";
import {
  type ExtractOutput,
  fail,
  findFunctionLiteral,
  isPlainObject,
  ok,
  readDataLiteralNode,
  readNameOrRef,
  readNameOrRefOrList,
} from "./shared";

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

export function readOptionalAccessRule(value: unknown): AccessRule | undefined {
  if (!isPlainObject(value)) return undefined;
  if (Array.isArray(value["roles"]) && value["roles"].every((r) => typeof r === "string")) {
    return { roles: value["roles"] as readonly string[] };
  }
  if (value["openToAll"] === true) {
    return { openToAll: true };
  }
  return undefined;
}

export function readOptionalRateLimit(value: unknown): RateLimitOption | undefined {
  if (!isPlainObject(value)) return undefined;
  if (typeof value["per"] !== "string") return undefined;
  if (typeof value["limit"] !== "number") return undefined;
  if (typeof value["windowSeconds"] !== "number") return undefined;
  return value as unknown as RateLimitOption;
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
    return ok({
      kind: "hook",
      source: sourceLocationFromNode(call, sourceFile),
      hookType,
      target,
      fnBody: sourceLocationFromNode(fn, sourceFile),
      ...(phase !== undefined && { phase }),
    });
  }

  const typeArg = first.asKind(SyntaxKind.StringLiteral);
  if (!typeArg) {
    return fail(
      "hook",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal hook type (or use the object form)",
    );
  }
  const hookType = typeArg.getLiteralValue();
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
  return ok({
    kind: "hook",
    source: sourceLocationFromNode(call, sourceFile),
    hookType,
    target,
    fnBody: sourceLocationFromNode(fn, sourceFile),
    ...(phase !== undefined && { phase }),
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
