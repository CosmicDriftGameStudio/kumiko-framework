import type { CallExpression, Node, ObjectLiteralExpression, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type {
  AccessRule,
  AgentHandlerHints,
  AgentRisk,
  RateLimitOption,
} from "../../types/handlers";
import type { QueryHandlerPattern, StreamHandlerPattern, WriteHandlerPattern } from "../patterns";
import type { SourceLocation } from "../source-location";
import { sourceLocationFromNode } from "../source-location";
import { readOptionalAccessRule, readOptionalRateLimit } from "./hooks";
import {
  type ExtractOutput,
  fail,
  findFunctionLiteral,
  isPlainObject,
  isRawRefSentinel,
  ok,
  readBooleanProperty,
  readDataLiteralNode,
  readNameLiteral,
} from "./shared";

export type ParsedHandlerCall = {
  readonly source: SourceLocation;
  readonly handlerName?: string;
  readonly schemaSource?: SourceLocation;
  readonly handlerBody?: SourceLocation;
  readonly access?: AccessRule;
  readonly description?: string;
  readonly agent?: AgentHandlerHints;
  readonly rateLimit?: RateLimitOption;
  readonly unsafeSkipTransitionGuard?: boolean;
};

const AGENT_RISK_VALUES: readonly AgentRisk[] = ["low", "mid", "high"];

function isAgentRisk(value: unknown): value is AgentRisk {
  return typeof value === "string" && (AGENT_RISK_VALUES as readonly string[]).includes(value);
}

export function readOptionalAgentHints(value: unknown): AgentHandlerHints | undefined {
  if (!isPlainObject(value)) return undefined;
  const expose = typeof value["expose"] === "boolean" ? value["expose"] : undefined;
  const risk = isAgentRisk(value["risk"]) ? value["risk"] : undefined;
  if (expose === undefined && risk === undefined) return undefined;
  return {
    ...(expose !== undefined && { expose }),
    ...(risk !== undefined && { risk }),
  };
}

/**
 * Reads the two AI-agent-manifest slots (`description`, `agent`) off an
 * object-form handler-call literal. Factored out of parseHandlerCall to
 * keep that function's branching flat — both fields are optional and
 * independent of the rest of the header (access/rateLimit/schema/handler).
 */
function readDescriptionAndAgent(
  obj: ObjectLiteralExpression,
): Pick<ParsedHandlerCall, "description" | "agent"> {
  const descriptionLiteral = obj
    .getProperty("description")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer()
    ?.asKind(SyntaxKind.StringLiteral);
  const agentInit = obj
    .getProperty("agent")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  const agent = agentInit ? readOptionalAgentHints(readDataLiteralNode(agentInit)) : undefined;
  return {
    ...(descriptionLiteral !== undefined && { description: descriptionLiteral.getLiteralValue() }),
    ...(agent !== undefined && { agent }),
  };
}

/**
 * Reads `access`/`rateLimit`/`description`/`agent` off the positional
 * 4th-argument options object (the inline-authoring form). Mirrors
 * readDescriptionAndAgent's role for the object-form branch — keeping
 * parseHandlerCall's positional branch to a single assignment instead of
 * four independent mutable locals.
 */
function readOptionsFields(
  options: unknown,
): Pick<ParsedHandlerCall, "access" | "rateLimit" | "description" | "agent"> {
  if (!isPlainObject(options)) return {};
  const access = readOptionalAccessRule(options["access"]);
  const rateLimit = readOptionalRateLimit(options["rateLimit"]);
  const description =
    typeof options["description"] === "string" ? options["description"] : undefined;
  const agent = readOptionalAgentHints(options["agent"]);
  return {
    ...(access !== undefined && { access }),
    ...(description !== undefined && { description }),
    ...(agent !== undefined && { agent }),
    ...(rateLimit !== undefined && { rateLimit }),
  };
}

/**
 * Resolves an argument standing in for a handler-call's object-form body:
 * either it's already an object literal, or a bare identifier declared
 * locally (same file only) with one as its initializer. Anything else
 * (imported binding, factory call, ...) is not resolvable here.
 */
function resolveObjectLiteralArg(node: Node) {
  const direct = node.asKind(SyntaxKind.ObjectLiteralExpression);
  if (direct) return direct;
  const identifier = node.asKind(SyntaxKind.Identifier);
  if (!identifier) return undefined;
  const varDecl = node.getSourceFile().getVariableDeclaration(identifier.getText());
  return varDecl?.getInitializer()?.asKind(SyntaxKind.ObjectLiteralExpression);
}

export function parseHandlerCall(
  call: CallExpression,
  sourceFile: SourceFile,
  methodName: "writeHandler" | "queryHandler" | "streamHandler",
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

  const obj = args.length === 1 ? resolveObjectLiteralArg(first) : undefined;
  if (obj) {
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
    const { description, agent } = readDescriptionAndAgent(obj);
    const skip = readBooleanProperty(obj, "unsafeSkipTransitionGuard");
    return ok({
      source: sourceLocationFromNode(call, sourceFile),
      handlerName: nameLiteral.getLiteralValue(),
      schemaSource: sourceLocationFromNode(schemaInit, sourceFile),
      handlerBody: sourceLocationFromNode(fn, sourceFile),
      ...(access !== undefined && { access }),
      ...(description !== undefined && { description }),
      ...(agent !== undefined && { agent }),
      ...(rateLimit !== undefined && { rateLimit }),
      ...(skip === true && { unsafeSkipTransitionGuard: true }),
    });
  }

  // A single reference standing in for the whole handler argument set
  // (`r.writeHandler(eventCreateHandler)`, `r.queryHandler(someQuery())`)
  // that resolveObjectLiteralArg above couldn't turn into an object literal
  // (imported binding, factory call, ...). Keep it recognised as this kind
  // instead of ParseErroring — see #1007. Opaque: renderWriteHandler/
  // renderQueryHandler re-emit `source.raw` verbatim when handlerName is
  // undefined.
  if (args.length === 1 && isRawRefSentinel(readDataLiteralNode(first))) {
    return ok({ source: sourceLocationFromNode(call, sourceFile) });
  }
  const handlerName = readNameLiteral(first);
  if (handlerName === undefined) {
    return fail(
      methodName,
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal handler name, or an identifier resolving to one (or use the object form)",
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
  const optionsFields = optionsArg ? readOptionsFields(readDataLiteralNode(optionsArg)) : {};
  return ok({
    source: sourceLocationFromNode(call, sourceFile),
    handlerName,
    schemaSource: sourceLocationFromNode(schemaArg, sourceFile),
    handlerBody: sourceLocationFromNode(fn, sourceFile),
    ...optionsFields,
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
    ...(parsed.pattern.description !== undefined && { description: parsed.pattern.description }),
    ...(parsed.pattern.agent !== undefined && { agent: parsed.pattern.agent }),
    ...(parsed.pattern.rateLimit !== undefined && { rateLimit: parsed.pattern.rateLimit }),
    ...(parsed.pattern.unsafeSkipTransitionGuard === true && { unsafeSkipTransitionGuard: true }),
  });
}

function readHandlerFields(parsed: Extract<ExtractOutput<ParsedHandlerCall>, { kind: "pattern" }>) {
  return {
    source: parsed.pattern.source,
    handlerName: parsed.pattern.handlerName,
    schemaSource: parsed.pattern.schemaSource,
    handlerBody: parsed.pattern.handlerBody,
    ...(parsed.pattern.access !== undefined && { access: parsed.pattern.access }),
    ...(parsed.pattern.rateLimit !== undefined && { rateLimit: parsed.pattern.rateLimit }),
  };
}

export function extractQueryHandler(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<QueryHandlerPattern> {
  const parsed = parseHandlerCall(call, sourceFile, "queryHandler");
  if (parsed.kind === "error") return parsed;
  return ok({
    kind: "queryHandler",
    ...readHandlerFields(parsed),
    ...(parsed.pattern.description !== undefined && { description: parsed.pattern.description }),
    ...(parsed.pattern.agent !== undefined && { agent: parsed.pattern.agent }),
  });
}

// streamHandler shares parseHandlerCall with writeHandler/queryHandler, but
// StreamHandlerDef carries neither `description` nor `agent` at runtime —
// readHandlerFields intentionally does not forward them here.
export function extractStreamHandler(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<StreamHandlerPattern> {
  const parsed = parseHandlerCall(call, sourceFile, "streamHandler");
  if (parsed.kind === "error") return parsed;
  return ok({ kind: "streamHandler", ...readHandlerFields(parsed) });
}
