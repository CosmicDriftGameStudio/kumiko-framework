import { type CallExpression, SyntaxKind } from "ts-morph";
import { readNameLiteral, readNameOrRef } from "./extractors/shared.ts";
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
};

export function callMatchesId(call: CallExpression, id: PatternId): boolean {
  return dispatchMatcher(call, id.kind, id);
}

function dispatchMatcher<K extends PatternIdKind>(
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
  return matchObjectProperty(call, "name", id.entityName);
}

function matchRelationCall(call: CallExpression, id: PatternIdOfKind["relation"]): boolean {
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
  return matchObjectProperty(call, "name", id.handlerName);
}

// Object form: { type, target }, where target is a name or an entity-wide { allOf } ref.
function matchHookCall(call: CallExpression, id: PatternIdOfKind["hook"]): boolean {
  if (typeof id.target === "object") {
    return (
      matchObjectProperty(call, "type", id.hookType) &&
      matchObjectAllOfProperty(call, "target", id.target.allOf)
    );
  }
  return (
    matchObjectProperty(call, "type", id.hookType) && matchObjectProperty(call, "target", id.target)
  );
}

function matchShortNameCall(
  call: CallExpression,
  id: PatternIdOfKind["metric" | "secret" | "secretNamespace" | "claimKey"],
): boolean {
  return matchObjectProperty(call, "name", id.shortName);
}

function matchReferenceDataCall(
  call: CallExpression,
  id: PatternIdOfKind["referenceData"],
): boolean {
  return matchObjectProperty(call, "entity", id.entityName);
}

// r.applyExtension({ name, entity, ... })
function matchUseExtensionCall(call: CallExpression, id: PatternIdOfKind["useExtension"]): boolean {
  return (
    matchObjectProperty(call, "name", id.extensionName) &&
    matchObjectProperty(call, "entity", id.entityName)
  );
}

function matchJobCall(call: CallExpression, id: PatternIdOfKind["job"]): boolean {
  return matchObjectProperty(call, "name", id.jobName);
}

function matchNotificationCall(call: CallExpression, id: PatternIdOfKind["notification"]): boolean {
  return matchObjectProperty(call, "name", id.notificationName);
}

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

// r.defineEvent(name, schema, options) is positional by design.
function matchDefineEventCall(call: CallExpression, id: PatternIdOfKind["defineEvent"]): boolean {
  return matchFirstArgString(call, id.eventName);
}

function matchExtendsRegistrarCall(
  call: CallExpression,
  id: PatternIdOfKind["extendsRegistrar"],
): boolean {
  return matchFirstArgString(call, id.extensionName);
}

// Resolves the first argument like the extractors do (readNameLiteral): a string literal, or an
// identifier followed to its string-literal initializer. Only for the positional verbs; the
// object-form verbs read their properties through matchObjectProperty.
function matchFirstArgString(call: CallExpression, expected: string): boolean {
  const arg = call.getArguments()[0];
  if (!arg) return false;
  return readNameLiteral(arg) === expected;
}

// Object-form property values are resolved via readNameOrRef, not the narrower
// readNameLiteral: some properties (applyExtension's `entity`, hook's `target`/`allOf`) accept an
// inline `{ name: "..." }` ref, not just a literal or identifier.
function matchObjectProperty(call: CallExpression, propName: string, expected: string): boolean {
  const obj = call.getArguments()[0]?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj) return false;
  const init = obj.getProperty(propName)?.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
  if (!init) return false;
  return readNameOrRef(init) === expected;
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
  const allOf = propInit
    ?.asKind(SyntaxKind.ObjectLiteralExpression)
    ?.getProperty("allOf")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  if (!allOf) return false;
  return readNameOrRef(allOf) === expectedEntity;
}
