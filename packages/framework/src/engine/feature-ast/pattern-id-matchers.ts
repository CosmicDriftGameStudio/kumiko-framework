import { type CallExpression, type Node, SyntaxKind } from "ts-morph";
import {
  readNameLiteral,
  readNameOrRef,
  resolveSameFileObjectLiteral,
} from "./extractors/shared.ts";
import type { PatternId } from "./patch.ts";
import type { MembersByKind } from "./patterns.ts";

type PatternIdKind = PatternId["kind"];
type PatternIdOfKind = MembersByKind<PatternId>;

type PatternIdMatchers = {
  readonly [K in PatternIdKind]: (call: CallExpression, id: PatternIdOfKind[K]) => boolean;
};

const PATTERN_ID_MATCHERS: PatternIdMatchers = {
  requires: matchSingletonCall,
  optionalRequires: matchSingletonCall,
  readsConfig: matchSingletonCall,
  systemScope: matchSingletonCall,
  toggleable: matchSingletonCall,
  describe: matchSingletonCall,
  uiHints: matchSingletonCall,
  config: matchSingletonCall,
  translations: matchSingletonCall,
  authClaims: matchSingletonCall,
  treeActions: matchSingletonCall,
  entity: matchEntityCall,
  relation: matchRelationCall,
  nav: matchIdPropertyCall,
  workspace: matchIdPropertyCall,
  screen: matchIdPropertyCall,
  writeHandler: matchHandlerCall,
  queryHandler: matchHandlerCall,
  streamHandler: matchHandlerCall,
  hook: matchHookCall,
  metric: matchShortNameCall,
  secret: matchShortNameCall,
  secretNamespace: matchShortNameCall,
  claimKey: matchShortNameCall,
  referenceData: matchReferenceDataCall,
  useExtension: matchUseExtensionCall,
  job: matchJobCall,
  notification: matchNotificationCall,
  httpRoute: matchHttpRouteCall,
  projection: matchProjectionCall,
  multiStreamProjection: matchProjectionCall,
  defineEvent: matchDefineEventCall,
  extendsRegistrar: matchExtendsRegistrarCall,
  "ai.generate": matchAiStepCall,
  "ai.extract": matchAiStepCall,
  "ai.classify": matchAiStepCall,
};

export function callMatchesId<K extends PatternIdKind>(
  call: CallExpression,
  kind: K,
  id: PatternIdOfKind[K],
): boolean {
  return PATTERN_ID_MATCHERS[kind](call, id);
}

// Singletons: kind alone identifies the call.
function matchSingletonCall(): boolean {
  return true;
}

function matchEntityCall(call: CallExpression, id: PatternIdOfKind["entity"]): boolean {
  return (
    matchFirstArgString(call, id.entityName) || matchObjectProperty(call, "name", id.entityName)
  );
}

// Positional: r.relation(entity, name, def) | Object: { entity, name, ... }
function matchRelationCall(call: CallExpression, id: PatternIdOfKind["relation"]): boolean {
  if (matchFirstArgString(call, id.entityName)) {
    return matchArgString(call, 1, id.relationName);
  }
  return (
    matchObjectProperty(call, "entity", id.entityName) &&
    matchObjectProperty(call, "name", id.relationName)
  );
}

function matchIdPropertyCall(
  call: CallExpression,
  id: PatternIdOfKind["nav" | "workspace" | "screen"],
): boolean {
  return matchObjectProperty(call, "id", id.id);
}

function matchHandlerCall(
  call: CallExpression,
  id: PatternIdOfKind["writeHandler" | "queryHandler" | "streamHandler"],
): boolean {
  return (
    matchFirstArgString(call, id.handlerName) || matchObjectProperty(call, "name", id.handlerName)
  );
}

// Positional: r.hook(type, target, fn) | Object: { type, target }
function matchHookCall(call: CallExpression, id: PatternIdOfKind["hook"]): boolean {
  if (typeof id.target === "object") {
    return matchHookAllOfCall(call, id.hookType, id.target.allOf);
  }
  if (matchFirstArgString(call, id.hookType)) {
    return matchArgNameOrRef(call, 1, id.target);
  }
  return (
    matchObjectProperty(call, "type", id.hookType) && matchObjectProperty(call, "target", id.target)
  );
}

// Entity-wide { allOf } target — only ever appears as the object
// literal { allOf: entity } (positional or nested in the object
// form), never as a bare string, so check both call shapes.
function matchHookAllOfCall(call: CallExpression, hookType: string, allOfEntity: string): boolean {
  if (matchFirstArgString(call, hookType)) {
    return matchAllOfArg(call.getArguments()[1], allOfEntity);
  }
  return (
    matchObjectProperty(call, "type", hookType) &&
    matchObjectAllOfProperty(call, "target", allOfEntity)
  );
}

function matchShortNameCall(
  call: CallExpression,
  id: PatternIdOfKind["metric" | "secret" | "secretNamespace" | "claimKey"],
): boolean {
  return matchFirstArgString(call, id.shortName) || matchObjectProperty(call, "name", id.shortName);
}

function matchReferenceDataCall(
  call: CallExpression,
  id: PatternIdOfKind["referenceData"],
): boolean {
  return (
    matchFirstArgString(call, id.entityName) || matchObjectProperty(call, "entity", id.entityName)
  );
}

// Positional: r.useExtension(name, entity) | Object: { name, entity }
function matchUseExtensionCall(call: CallExpression, id: PatternIdOfKind["useExtension"]): boolean {
  if (matchFirstArgString(call, id.extensionName)) {
    return matchArgNameOrRef(call, 1, id.entityName);
  }
  return (
    matchObjectProperty(call, "name", id.extensionName) &&
    matchObjectProperty(call, "entity", id.entityName)
  );
}

function matchJobCall(call: CallExpression, id: PatternIdOfKind["job"]): boolean {
  return matchFirstArgString(call, id.jobName) || matchObjectProperty(call, "name", id.jobName);
}

function matchNotificationCall(call: CallExpression, id: PatternIdOfKind["notification"]): boolean {
  return (
    matchFirstArgString(call, id.notificationName) ||
    matchObjectProperty(call, "name", id.notificationName)
  );
}

// Object form only; positional doesn't apply.
function matchHttpRouteCall(call: CallExpression, id: PatternIdOfKind["httpRoute"]): boolean {
  return (
    matchObjectProperty(call, "method", id.method) && matchObjectProperty(call, "path", id.path)
  );
}

function matchProjectionCall(
  call: CallExpression,
  id: PatternIdOfKind["projection" | "multiStreamProjection"],
): boolean {
  return matchObjectProperty(call, "name", id.name);
}

function matchDefineEventCall(call: CallExpression, id: PatternIdOfKind["defineEvent"]): boolean {
  return matchFirstArgString(call, id.eventName) || matchObjectProperty(call, "name", id.eventName);
}

function matchExtendsRegistrarCall(
  call: CallExpression,
  id: PatternIdOfKind["extendsRegistrar"],
): boolean {
  return matchFirstArgString(call, id.extensionName);
}

function matchAiStepCall(
  call: CallExpression,
  id: PatternIdOfKind["ai.generate" | "ai.extract" | "ai.classify"],
): boolean {
  return readAiStepKey(call) === id.stepKey;
}

function readAiStepKey(call: CallExpression): string | undefined {
  const arg = call.getArguments()[0];
  if (!arg) return undefined;
  const obj = resolveSameFileObjectLiteral(arg);
  if (!obj) return undefined;
  const prop = obj.getProperty("stepKey");
  if (!prop) return undefined;
  const assign = prop.asKind(SyntaxKind.PropertyAssignment);
  if (assign) {
    const init = assign.getInitializer();
    if (!init) return undefined;
    return readNameLiteral(init);
  }
  const shorthand = prop.asKind(SyntaxKind.ShorthandPropertyAssignment);
  if (shorthand) return readNameLiteral(shorthand.getNameNode());
  return undefined;
}

// Resolves an argument the same way the extractors do (readNameLiteral):
// a string literal directly, or a bare identifier following its
// declaration (same-file or imported) to a string-literal initializer —
// the dominant naming style in the framework's own bundled-features
// (`r.entity(ENTITY, ...)`, `r.useExtension(EXT_X, ...)`).
//
// Narrow on purpose: every kind's arg-0 (and relation's arg-1) is parsed
// via readNameLiteral, never readNameOrRef (see round2.ts/round3.ts) —
// widening this shared helper to readNameOrRef would let an object-form
// call's first argument (an ObjectLiteralExpression) match here too,
// short-circuiting the object-form branch in callMatchesId. Positions
// where the parser itself accepts an inline `{ name: "..." }` ref use
// `matchArgNameOrRef` below instead.
function matchArgString(call: CallExpression, index: number, expected: string): boolean {
  const arg = call.getArguments()[index];
  if (!arg) return false;
  return readNameLiteral(arg) === expected;
}

// @wrapper-known semantic-alias
function matchFirstArgString(call: CallExpression, expected: string): boolean {
  return matchArgString(call, 0, expected);
}

// Like matchArgString, but via readNameOrRef — for the specific positional
// slots where the parser accepts an inline `{ name: "..." }` object ref in
// addition to a literal/identifier (useExtension's entity arg, hook's
// target arg; see round3.ts:445 / hooks.ts:75). Not a drop-in replacement
// for matchArgString: applying it to an arg-0 position would match an
// object-form call's first (and only) argument, see the comment above.
function matchArgNameOrRef(call: CallExpression, index: number, expected: string): boolean {
  const arg = call.getArguments()[index];
  if (!arg) return false;
  return readNameOrRef(arg) === expected;
}

// Object-form property values are resolved via readNameOrRef, not the
// narrower readNameLiteral — some properties (useExtension's `entity`,
// hook's `target`/`allOf`) accept an inline `{ name: "..." }` ref in the
// parser (see extractors/round3.ts, extractors/hooks.ts), not just a
// literal or identifier. readNameOrRef is a superset of readNameLiteral,
// so this is safe for every other property too.
function matchObjectProperty(call: CallExpression, propName: string, expected: string): boolean {
  const obj = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj) return false;
  const init = obj.getProperty(propName)?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
  if (!init) return false;
  return readNameOrRef(init) === expected;
}

// Matches an r.hook `{ allOf: entity }` target — as the arg node directly
// (positional call form) or as a nested object property (object call form).
function matchAllOfArg(node: Node | undefined, expectedEntity: string): boolean {
  const obj = node?.asKind(SyntaxKind.ObjectLiteralExpression);
  const init = obj?.getProperty("allOf")?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
  if (!init) return false;
  return readNameOrRef(init) === expectedEntity;
}

function matchObjectAllOfProperty(
  call: CallExpression,
  propName: string,
  expectedEntity: string,
): boolean {
  const obj = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  const propInit = obj
    ?.getProperty(propName)
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  return matchAllOfArg(propInit, expectedEntity);
}
