import type { CallExpression, Node, ObjectLiteralExpression, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type {
  AccessRule,
  AgentHandlerHints,
  AgentRisk,
  EscapeHatchDeclaration,
  RateLimitDeclaration,
} from "../../types/handlers";
import type { QueryHandlerPattern, StreamHandlerPattern, WriteHandlerPattern } from "../patterns";
import type { SourceLocation } from "../source-location";
import { sourceLocationFromNode } from "../source-location";
import {
  readHeaderValueOrRaw,
  readOptionalAccessRule,
  readOptionalEscapeHatch,
  readOptionalRateLimit,
} from "./hooks";
import {
  type ExtractOutput,
  fail,
  findFunctionLiteral,
  isPlainObject,
  isRawRefSentinel,
  ok,
  type RawRefSentinel,
  readBooleanProperty,
  readDataLiteralNode,
  readNameLiteral,
  readObjectPropertyInitializer,
} from "./shared";

export type ParsedHandlerCall = {
  readonly source: SourceLocation;
  readonly handlerName?: string;
  readonly schemaSource?: SourceLocation;
  readonly handlerBody?: SourceLocation;
  readonly access?: AccessRule | RawRefSentinel;
  readonly description?: string;
  readonly agent?: AgentHandlerHints | RawRefSentinel;
  readonly rateLimit?: RateLimitDeclaration | RawRefSentinel;
  readonly unsafeSkipTransitionGuard?: boolean;
  readonly escapeHatch?: EscapeHatchDeclaration | RawRefSentinel;
};

export const AGENT_RISK_VALUES: readonly AgentRisk[] = ["low", "mid", "high"];

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

// Deliberately does NOT resolve identifiers (unlike resolveObjectLiteralArg):
// an options argument authored as a bare reference has no per-property
// nodes to read, so it must ParseError instead of silently dropping headers.
function unwrapObjectLiteral(node: Node): ObjectLiteralExpression | undefined {
  const direct = node.asKind(SyntaxKind.ObjectLiteralExpression);
  if (direct) return direct;
  const asExpr = node.asKind(SyntaxKind.AsExpression);
  if (asExpr) return unwrapObjectLiteral(asExpr.getExpression());
  const satisfiesExpr = node.asKind(SyntaxKind.SatisfiesExpression);
  if (satisfiesExpr) return unwrapObjectLiteral(satisfiesExpr.getExpression());
  const paren = node.asKind(SyntaxKind.ParenthesizedExpression);
  if (paren) return unwrapObjectLiteral(paren.getExpression());
  return undefined;
}

function readHeaderField<T>(
  init: Node | undefined,
  recognize: (value: unknown) => T | undefined,
  methodName: "writeHandler" | "queryHandler" | "streamHandler",
  sourceFile: SourceFile,
  unrecognizedReason: string,
): ExtractOutput<T | RawRefSentinel | undefined> {
  if (!init) return ok(undefined);
  const result = readHeaderValueOrRaw(init, recognize);
  if (result.kind === "value") return ok<T | RawRefSentinel | undefined>(result.value);
  if (result.kind === "raw") return ok<T | RawRefSentinel | undefined>(result.sentinel);
  return fail(methodName, sourceLocationFromNode(init, sourceFile), unrecognizedReason);
}

type HandlerHeaderFields = Pick<
  ParsedHandlerCall,
  "access" | "rateLimit" | "escapeHatch" | "agent"
>;

// Shared by the object-form call body and the positional options object,
// which carry the same header shape.
function readHandlerHeaderFields(
  obj: ObjectLiteralExpression,
  methodName: "writeHandler" | "queryHandler" | "streamHandler",
  sourceFile: SourceFile,
): ExtractOutput<HandlerHeaderFields> {
  const accessResult = readHeaderField(
    readObjectPropertyInitializer(obj, "access"),
    readOptionalAccessRule,
    methodName,
    sourceFile,
    "access must be a recognized AccessRule ({ roles: [...] } or { openToAll: { reason } }), or a reference to one",
  );
  if (accessResult.kind === "error") return accessResult;

  const rateLimitResult = readHeaderField(
    readObjectPropertyInitializer(obj, "rateLimit"),
    readOptionalRateLimit,
    methodName,
    sourceFile,
    "rateLimit must be { per, limit, windowSeconds } or { disabled: true, reason }, or a reference to one",
  );
  if (rateLimitResult.kind === "error") return rateLimitResult;

  const escapeHatchResult = readHeaderField(
    readObjectPropertyInitializer(obj, "escapeHatch"),
    readOptionalEscapeHatch,
    methodName,
    sourceFile,
    "escapeHatch must be { reason: string }, or a reference to one",
  );
  if (escapeHatchResult.kind === "error") return escapeHatchResult;

  const agentResult = readHeaderField(
    readObjectPropertyInitializer(obj, "agent"),
    readOptionalAgentHints,
    methodName,
    sourceFile,
    'agent must be { expose?: boolean, risk?: "low" | "mid" | "high" }, or a reference to one',
  );
  if (agentResult.kind === "error") return agentResult;

  return ok({
    ...(accessResult.pattern !== undefined && { access: accessResult.pattern }),
    ...(rateLimitResult.pattern !== undefined && { rateLimit: rateLimitResult.pattern }),
    ...(escapeHatchResult.pattern !== undefined && { escapeHatch: escapeHatchResult.pattern }),
    ...(agentResult.pattern !== undefined && { agent: agentResult.pattern }),
  });
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
    const headerResult = readHandlerHeaderFields(obj, methodName, sourceFile);
    if (headerResult.kind === "error") return headerResult;
    const descriptionLiteral = obj
      .getProperty("description")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    const skip = readBooleanProperty(obj, "unsafeSkipTransitionGuard");
    return ok({
      source: sourceLocationFromNode(call, sourceFile),
      handlerName: nameLiteral.getLiteralValue(),
      schemaSource: sourceLocationFromNode(schemaInit, sourceFile),
      handlerBody: sourceLocationFromNode(fn, sourceFile),
      ...headerResult.pattern,
      ...(descriptionLiteral !== undefined && {
        description: descriptionLiteral.getLiteralValue(),
      }),
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
  let headerFields: HandlerHeaderFields = {};
  let description: string | undefined;
  if (optionsArg) {
    const optionsObj = unwrapObjectLiteral(optionsArg);
    if (!optionsObj) {
      return fail(
        methodName,
        sourceLocationFromNode(optionsArg, sourceFile),
        "options argument (4th) must be an inline object literal",
      );
    }
    const headerResult = readHandlerHeaderFields(optionsObj, methodName, sourceFile);
    if (headerResult.kind === "error") return headerResult;
    headerFields = headerResult.pattern;
    description = optionsObj
      .getProperty("description")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral)
      ?.getLiteralValue();
  }
  return ok({
    source: sourceLocationFromNode(call, sourceFile),
    handlerName,
    schemaSource: sourceLocationFromNode(schemaArg, sourceFile),
    handlerBody: sourceLocationFromNode(fn, sourceFile),
    ...headerFields,
    ...(description !== undefined && { description }),
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
    ...(parsed.pattern.escapeHatch !== undefined && { escapeHatch: parsed.pattern.escapeHatch }),
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
    ...(parsed.pattern.escapeHatch !== undefined && { escapeHatch: parsed.pattern.escapeHatch }),
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

// StreamHandlerDef has no description/agent at runtime, unlike escapeHatch,
// so readHandlerFields forwards only access/rateLimit/escapeHatch.
export function extractStreamHandler(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<StreamHandlerPattern> {
  const parsed = parseHandlerCall(call, sourceFile, "streamHandler");
  if (parsed.kind === "error") return parsed;
  return ok({ kind: "streamHandler", ...readHandlerFields(parsed) });
}
