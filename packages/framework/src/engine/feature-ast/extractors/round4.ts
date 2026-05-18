import type { CallExpression, Node, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { LifecycleHookType } from "../../constants";
import type { JobDefinition, RunIn } from "../../types/config";
import type { AccessRule, RateLimitOption } from "../../types/handlers";
import type { HookPhase } from "../../types/hooks";
import type { HttpRouteMethod } from "../../types/http-route";
import type { MspErrorMode } from "../../types/projection";
import type { ScreenDefinition } from "../../types/screen";
import type {
  AuthClaimsPattern,
  DefineEventPattern,
  EntityHookPattern,
  EventMigrationPattern,
  HookPattern,
  HttpRoutePattern,
  JobPattern,
  MultiStreamProjectionPattern,
  NotificationPattern,
  OpaquePropMap,
  ProjectionPattern,
  QueryHandlerPattern,
  ScreenPattern,
  WriteHandlerPattern,
} from "../patterns";
import { SCREEN_OPAQUE_MARKER } from "../patterns";
import type { SourceLocation } from "../source-location";
import { sourceLocationFromNode } from "../source-location";
import {
  type ExtractOutput,
  fail,
  findFunctionLiteral,
  isPlainObject,
  ok,
  readBooleanProperty,
  readDataLiteralNode,
  readNameOrRef,
  readNameOrRefOrList,
  readPropertyKey,
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

export function isHttpRouteMethod(value: string): value is HttpRouteMethod {
  return (
    value === "GET" ||
    value === "POST" ||
    value === "PUT" ||
    value === "PATCH" ||
    value === "DELETE" ||
    value === "HEAD" ||
    value === "OPTIONS"
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
    const target = readNameOrRefOrList(targetInit);
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
  const target = readNameOrRefOrList(targetArg);
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

export function isEntityHookType(value: string): value is "postSave" | "preDelete" | "postDelete" {
  return value === "postSave" || value === "preDelete" || value === "postDelete";
}

export function extractEntityHook(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<EntityHookPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
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
        "entityHook",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `type` property",
      );
    }
    const hookType = typeInit.getLiteralValue();
    if (!isEntityHookType(hookType)) {
      return fail(
        "entityHook",
        sourceLocationFromNode(call, sourceFile),
        `entity hook type must be postSave, preDelete, or postDelete (got "${hookType}")`,
      );
    }
    const entityInit = obj
      .getProperty("entity")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!entityInit) {
      return fail(
        "entityHook",
        sourceLocationFromNode(call, sourceFile),
        "object form requires an `entity` property",
      );
    }
    const entityName = readNameOrRef(entityInit);
    if (!entityName) {
      return fail(
        "entityHook",
        sourceLocationFromNode(call, sourceFile),
        "`entity` must be a string literal or inline { name } object",
      );
    }
    const handlerInit = obj
      .getProperty("handler")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!handlerInit) {
      return fail(
        "entityHook",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `handler` property",
      );
    }
    const fn = findFunctionLiteral(handlerInit);
    if (!fn) {
      return fail(
        "entityHook",
        sourceLocationFromNode(call, sourceFile),
        "handler must be an inline arrow function or function expression",
      );
    }
    const phase = readOptionalPhase(obj);
    return ok({
      kind: "entityHook",
      source: sourceLocationFromNode(call, sourceFile),
      hookType,
      entityName,
      fnBody: sourceLocationFromNode(fn, sourceFile),
      ...(phase !== undefined && { phase }),
    });
  }

  const typeArg = first.asKind(SyntaxKind.StringLiteral);
  if (!typeArg) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal hook type (or use the object form)",
    );
  }
  const hookType = typeArg.getLiteralValue();
  if (!isEntityHookType(hookType)) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      `entity hook type must be postSave, preDelete, or postDelete (got "${hookType}")`,
    );
  }
  const entityArg = args[1];
  if (!entityArg) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      "expected an entity reference as second argument",
    );
  }
  const entityName = readNameOrRef(entityArg);
  if (!entityName) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      "second argument must be a string literal or inline { name } object",
    );
  }
  const fnArg = args[2];
  if (!fnArg) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      "expected a hook function as third argument",
    );
  }
  const fn = findFunctionLiteral(fnArg);
  if (!fn) {
    return fail(
      "entityHook",
      sourceLocationFromNode(call, sourceFile),
      "third argument must be an inline arrow function or function expression",
    );
  }
  const phase = readOptionalPhase(args[3]);
  return ok({
    kind: "entityHook",
    source: sourceLocationFromNode(call, sourceFile),
    hookType,
    entityName,
    fnBody: sourceLocationFromNode(fn, sourceFile),
    ...(phase !== undefined && { phase }),
  });
}

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

export type ParsedHandlerCall = {
  readonly source: SourceLocation;
  readonly handlerName: string;
  readonly schemaSource: SourceLocation;
  readonly handlerBody: SourceLocation;
  readonly access?: AccessRule;
  readonly rateLimit?: RateLimitOption;
  readonly unsafeSkipTransitionGuard?: boolean;
};

export function parseHandlerCall(
  call: CallExpression,
  sourceFile: SourceFile,
  methodName: "writeHandler" | "queryHandler",
): ExtractOutput<ParsedHandlerCall> {
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
    const nameLiteral = obj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameLiteral) {
      return fail(
        methodName,
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const schemaInit = obj
      .getProperty("schema")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!schemaInit) {
      return fail(
        methodName,
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `schema` property",
      );
    }
    const handlerInit = obj
      .getProperty("handler")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!handlerInit) {
      return fail(
        methodName,
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `handler` property",
      );
    }
    const fn = findFunctionLiteral(handlerInit);
    if (!fn) {
      return fail(
        methodName,
        sourceLocationFromNode(call, sourceFile),
        "handler must be an inline arrow function or function expression",
      );
    }
    const accessInit = obj
      .getProperty("access")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    const access = accessInit ? readOptionalAccessRule(readDataLiteralNode(accessInit)) : undefined;
    const rateLimitInit = obj
      .getProperty("rateLimit")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    const rateLimit = rateLimitInit
      ? readOptionalRateLimit(readDataLiteralNode(rateLimitInit))
      : undefined;
    const skip = readBooleanProperty(obj, "unsafeSkipTransitionGuard");
    return ok({
      source: sourceLocationFromNode(call, sourceFile),
      handlerName: nameLiteral.getLiteralValue(),
      schemaSource: sourceLocationFromNode(schemaInit, sourceFile),
      handlerBody: sourceLocationFromNode(fn, sourceFile),
      ...(access !== undefined && { access }),
      ...(rateLimit !== undefined && { rateLimit }),
      ...(skip === true && { unsafeSkipTransitionGuard: true }),
    });
  }

  const nameLiteral = first.asKind(SyntaxKind.StringLiteral);
  if (!nameLiteral) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal handler name (or use the object form)",
    );
  }
  const schemaArg = args[1];
  if (!schemaArg) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "expected a Zod schema as second argument",
    );
  }
  const handlerArg = args[2];
  if (!handlerArg) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "expected a handler function as third argument",
    );
  }
  const fn = findFunctionLiteral(handlerArg);
  if (!fn) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "third argument must be an inline arrow function or function expression",
    );
  }
  const optionsArg = args[3];
  let access: AccessRule | undefined;
  let rateLimit: RateLimitOption | undefined;
  if (optionsArg) {
    const options = readDataLiteralNode(optionsArg);
    if (isPlainObject(options)) {
      access = readOptionalAccessRule(options["access"]);
      rateLimit = readOptionalRateLimit(options["rateLimit"]);
    }
  }
  return ok({
    source: sourceLocationFromNode(call, sourceFile),
    handlerName: nameLiteral.getLiteralValue(),
    schemaSource: sourceLocationFromNode(schemaArg, sourceFile),
    handlerBody: sourceLocationFromNode(fn, sourceFile),
    ...(access !== undefined && { access }),
    ...(rateLimit !== undefined && { rateLimit }),
  });
}

export function extractWriteHandler(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<WriteHandlerPattern> {
  const parsed = parseHandlerCall(call, sourceFile, "writeHandler");
  if (parsed.kind === "error") return parsed;
  return ok({
    kind: "writeHandler",
    source: parsed.pattern.source,
    handlerName: parsed.pattern.handlerName,
    schemaSource: parsed.pattern.schemaSource,
    handlerBody: parsed.pattern.handlerBody,
    ...(parsed.pattern.access !== undefined && { access: parsed.pattern.access }),
    ...(parsed.pattern.rateLimit !== undefined && { rateLimit: parsed.pattern.rateLimit }),
    ...(parsed.pattern.unsafeSkipTransitionGuard === true && { unsafeSkipTransitionGuard: true }),
  });
}

export function extractQueryHandler(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<QueryHandlerPattern> {
  const parsed = parseHandlerCall(call, sourceFile, "queryHandler");
  if (parsed.kind === "error") return parsed;
  return ok({
    kind: "queryHandler",
    source: parsed.pattern.source,
    handlerName: parsed.pattern.handlerName,
    schemaSource: parsed.pattern.schemaSource,
    handlerBody: parsed.pattern.handlerBody,
    ...(parsed.pattern.access !== undefined && { access: parsed.pattern.access }),
    ...(parsed.pattern.rateLimit !== undefined && { rateLimit: parsed.pattern.rateLimit }),
  });
}

export function extractJob(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<JobPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail("job", sourceLocationFromNode(call, sourceFile), "expected at least one argument");
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
        "job",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const handlerInit = obj
      .getProperty("handler")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!handlerInit) {
      return fail(
        "job",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `handler` property",
      );
    }
    const fn = findFunctionLiteral(handlerInit);
    if (!fn) {
      return fail(
        "job",
        sourceLocationFromNode(call, sourceFile),
        "handler must be an inline arrow function or function expression",
      );
    }
    const optionsBag: Record<string, unknown> = {};
    for (const prop of obj.getProperties()) {
      const propAssign = prop.asKind(SyntaxKind.PropertyAssignment);
      if (!propAssign) continue;
      const key = readPropertyKey(propAssign);
      if (key === "name" || key === "handler") continue;
      const init = propAssign.getInitializer();
      if (!init) continue;
      const value = readDataLiteralNode(init);
      if (value === undefined) {
        return fail(
          "job",
          sourceLocationFromNode(call, sourceFile),
          `option "${key}" could not be read as a plain value`,
        );
      }
      optionsBag[key] = value;
    }
    return ok({
      kind: "job",
      source: sourceLocationFromNode(call, sourceFile),
      jobName: nameInit.getLiteralValue(),
      options: optionsBag as Omit<JobDefinition, "name" | "handler">,
      handlerBody: sourceLocationFromNode(fn, sourceFile),
    });
  }

  const nameArg = first.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "job",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal job name (or use the object form)",
    );
  }
  const optionsArg = args[1];
  if (!optionsArg) {
    return fail(
      "job",
      sourceLocationFromNode(call, sourceFile),
      "expected an options object as second argument",
    );
  }
  const options = readDataLiteralNode(optionsArg);
  if (!isPlainObject(options)) {
    return fail(
      "job",
      sourceLocationFromNode(call, sourceFile),
      "options could not be read as a plain object",
    );
  }
  const handlerArg = args[2];
  if (!handlerArg) {
    return fail(
      "job",
      sourceLocationFromNode(call, sourceFile),
      "expected a handler function as third argument",
    );
  }
  const fn = findFunctionLiteral(handlerArg);
  if (!fn) {
    return fail(
      "job",
      sourceLocationFromNode(call, sourceFile),
      "third argument must be an inline arrow function or function expression",
    );
  }
  return ok({
    kind: "job",
    source: sourceLocationFromNode(call, sourceFile),
    jobName: nameArg.getLiteralValue(),
    options: options as Omit<JobDefinition, "name" | "handler">,
    handlerBody: sourceLocationFromNode(fn, sourceFile),
  });
}

export function extractHttpRoute(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<HttpRoutePattern> {
  const arg = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!arg) {
    return fail(
      "httpRoute",
      sourceLocationFromNode(call, sourceFile),
      "argument must be an inline HttpRouteDefinition object",
    );
  }
  const methodLiteral = arg
    .getProperty("method")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  if (!methodLiteral) {
    return fail(
      "httpRoute",
      sourceLocationFromNode(call, sourceFile),
      "method must be a string literal",
    );
  }
  const methodValue = methodLiteral.getLiteralValue();
  if (!isHttpRouteMethod(methodValue)) {
    return fail(
      "httpRoute",
      sourceLocationFromNode(call, sourceFile),
      `method must be one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS (got "${methodValue}")`,
    );
  }
  const pathLiteral = arg
    .getProperty("path")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  if (!pathLiteral) {
    return fail(
      "httpRoute",
      sourceLocationFromNode(call, sourceFile),
      "path must be a string literal",
    );
  }
  const handlerInit = arg
    .getProperty("handler")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  if (!handlerInit) {
    return fail(
      "httpRoute",
      sourceLocationFromNode(call, sourceFile),
      "missing `handler` property",
    );
  }
  const fn = findFunctionLiteral(handlerInit);
  if (!fn) {
    return fail(
      "httpRoute",
      sourceLocationFromNode(call, sourceFile),
      "handler must be an inline arrow function or function expression",
    );
  }
  const anonymous = readBooleanProperty(arg, "anonymous");
  return ok({
    kind: "httpRoute",
    source: sourceLocationFromNode(call, sourceFile),
    method: methodValue,
    path: pathLiteral.getLiteralValue(),
    handlerBody: sourceLocationFromNode(fn, sourceFile),
    ...(anonymous === true && { anonymous: true }),
  });
}

export function extractDefineEvent(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<DefineEventPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "defineEvent",
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
        "defineEvent",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const schemaInit = obj
      .getProperty("schema")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!schemaInit) {
      return fail(
        "defineEvent",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `schema` property",
      );
    }
    let version: number | undefined;
    const versionInit = obj
      .getProperty("version")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (versionInit) {
      const v = readDataLiteralNode(versionInit);
      if (typeof v === "number") version = v;
    }
    return ok({
      kind: "defineEvent",
      source: sourceLocationFromNode(call, sourceFile),
      eventName: nameInit.getLiteralValue(),
      schemaSource: sourceLocationFromNode(schemaInit, sourceFile),
      ...(version !== undefined && { version }),
    });
  }

  const nameArg = first.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "defineEvent",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal event name (or use the object form)",
    );
  }
  const schemaArg = args[1];
  if (!schemaArg) {
    return fail(
      "defineEvent",
      sourceLocationFromNode(call, sourceFile),
      "expected a Zod schema as second argument",
    );
  }
  let version: number | undefined;
  const optionsArg = args[2];
  if (optionsArg) {
    const options = readDataLiteralNode(optionsArg);
    if (isPlainObject(options) && typeof options["version"] === "number") {
      version = options["version"];
    }
  }
  return ok({
    kind: "defineEvent",
    source: sourceLocationFromNode(call, sourceFile),
    eventName: nameArg.getLiteralValue(),
    schemaSource: sourceLocationFromNode(schemaArg, sourceFile),
    ...(version !== undefined && { version }),
  });
}

export function extractEventMigration(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<EventMigrationPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "eventMigration",
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) {
    const eventInit = obj
      .getProperty("event")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!eventInit) {
      return fail(
        "eventMigration",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `event` property",
      );
    }
    const fromInit = obj
      .getProperty("fromVersion")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    const fromVersion = fromInit ? readDataLiteralNode(fromInit) : undefined;
    if (typeof fromVersion !== "number") {
      return fail(
        "eventMigration",
        sourceLocationFromNode(call, sourceFile),
        "fromVersion must be a numeric literal",
      );
    }
    const toInit = obj
      .getProperty("toVersion")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    const toVersion = toInit ? readDataLiteralNode(toInit) : undefined;
    if (typeof toVersion !== "number") {
      return fail(
        "eventMigration",
        sourceLocationFromNode(call, sourceFile),
        "toVersion must be a numeric literal",
      );
    }
    const transformInit = obj
      .getProperty("transform")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (!transformInit) {
      return fail(
        "eventMigration",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a `transform` property",
      );
    }
    const fn = findFunctionLiteral(transformInit);
    if (!fn) {
      return fail(
        "eventMigration",
        sourceLocationFromNode(call, sourceFile),
        "transform must be an inline arrow function or function expression",
      );
    }
    return ok({
      kind: "eventMigration",
      source: sourceLocationFromNode(call, sourceFile),
      eventName: eventInit.getLiteralValue(),
      fromVersion,
      toVersion,
      transformBody: sourceLocationFromNode(fn, sourceFile),
    });
  }

  const nameArg = first.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "eventMigration",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal event name (or use the object form)",
    );
  }
  const fromArg = args[1];
  const fromVersion = fromArg ? readDataLiteralNode(fromArg) : undefined;
  if (typeof fromVersion !== "number") {
    return fail(
      "eventMigration",
      sourceLocationFromNode(call, sourceFile),
      "fromVersion must be a numeric literal",
    );
  }
  const toArg = args[2];
  const toVersion = toArg ? readDataLiteralNode(toArg) : undefined;
  if (typeof toVersion !== "number") {
    return fail(
      "eventMigration",
      sourceLocationFromNode(call, sourceFile),
      "toVersion must be a numeric literal",
    );
  }
  const transformArg = args[3];
  if (!transformArg) {
    return fail(
      "eventMigration",
      sourceLocationFromNode(call, sourceFile),
      "expected a transform function as fourth argument",
    );
  }
  const fn = findFunctionLiteral(transformArg);
  if (!fn) {
    return fail(
      "eventMigration",
      sourceLocationFromNode(call, sourceFile),
      "transform must be an inline arrow function or function expression",
    );
  }
  return ok({
    kind: "eventMigration",
    source: sourceLocationFromNode(call, sourceFile),
    eventName: nameArg.getLiteralValue(),
    fromVersion,
    toVersion,
    transformBody: sourceLocationFromNode(fn, sourceFile),
  });
}

export function extractNotification(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<NotificationPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "notification",
      sourceLocationFromNode(call, sourceFile),
      "expected at least one argument",
    );
  }

  let nameLiteral: ReturnType<typeof first.asKind<SyntaxKind.StringLiteral>>;
  let defObj: ReturnType<typeof first.asKind<SyntaxKind.ObjectLiteralExpression>>;

  const firstObj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (firstObj && args.length === 1) {
    nameLiteral = firstObj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameLiteral) {
      return fail(
        "notification",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    defObj = firstObj;
  } else {
    nameLiteral = first.asKind(SyntaxKind.StringLiteral);
    if (!nameLiteral) {
      return fail(
        "notification",
        sourceLocationFromNode(call, sourceFile),
        "first argument must be a string literal notification name (or use the object form)",
      );
    }
    defObj = args[1]?.asKind(SyntaxKind.ObjectLiteralExpression);
    if (!defObj) {
      return fail(
        "notification",
        sourceLocationFromNode(call, sourceFile),
        "second argument must be an inline definition object",
      );
    }
  }
  const nameArg = nameLiteral;
  const triggerObj = defObj
    .getProperty("trigger")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!triggerObj) {
    return fail(
      "notification",
      sourceLocationFromNode(call, sourceFile),
      "missing or non-object `trigger` property",
    );
  }
  const onInit = triggerObj
    .getProperty("on")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  const onName = onInit ? readNameOrRef(onInit) : undefined;
  if (!onName) {
    return fail(
      "notification",
      sourceLocationFromNode(call, sourceFile),
      "trigger.on must be a string literal or inline { name } object",
    );
  }
  const recipientInit = defObj
    .getProperty("recipient")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  const recipientFn = recipientInit ? findFunctionLiteral(recipientInit) : undefined;
  if (!recipientFn) {
    return fail(
      "notification",
      sourceLocationFromNode(call, sourceFile),
      "recipient must be an inline arrow function or function expression",
    );
  }
  const dataInit = defObj
    .getProperty("data")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  const dataFn = dataInit ? findFunctionLiteral(dataInit) : undefined;
  if (!dataFn) {
    return fail(
      "notification",
      sourceLocationFromNode(call, sourceFile),
      "data must be an inline arrow function or function expression",
    );
  }
  let templates: Record<string, SourceLocation> | undefined;
  const templatesObj = defObj
    .getProperty("templates")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (templatesObj) {
    templates = {};
    for (const prop of templatesObj.getProperties()) {
      const propAssign = prop.asKind(SyntaxKind.PropertyAssignment);
      if (!propAssign) continue;
      const init = propAssign.getInitializer();
      if (!init) continue;
      const tfn = findFunctionLiteral(init);
      if (!tfn) continue;
      templates[readPropertyKey(propAssign)] = sourceLocationFromNode(tfn, sourceFile);
    }
  }
  return ok({
    kind: "notification",
    source: sourceLocationFromNode(call, sourceFile),
    notificationName: nameArg.getLiteralValue(),
    trigger: { on: onName },
    recipientBody: sourceLocationFromNode(recipientFn, sourceFile),
    dataBody: sourceLocationFromNode(dataFn, sourceFile),
    ...(templates !== undefined && { templates }),
  });
}

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
    return fail(
      "screen",
      sourceLocationFromNode(call, sourceFile),
      "argument must be an inline object literal",
    );
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
