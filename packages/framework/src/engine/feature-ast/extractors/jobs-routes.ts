import type { CallExpression, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { JobDefinition } from "../../types/config";
import type { HttpRouteMethod } from "../../types/http-route";
import type { HttpRoutePattern, JobPattern } from "../patterns";
import { sourceLocationFromNode } from "../source-location";
import {
  type ExtractOutput,
  fail,
  findFunctionLiteral,
  isPlainObject,
  ok,
  readBooleanProperty,
  readDataLiteralNode,
  readPropertyKey,
} from "./shared";

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
