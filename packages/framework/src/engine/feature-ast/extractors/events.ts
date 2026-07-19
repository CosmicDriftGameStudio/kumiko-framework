import type { CallExpression, Node, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { DefineEventPattern, NotificationPattern } from "../patterns";
import type { SourceLocation } from "../source-location";
import { sourceLocationFromNode } from "../source-location";
import {
  type ExtractOutput,
  fail,
  findFunctionLiteral,
  ok,
  readDataLiteralNode,
  readNameOrRef,
  readPropertyKey,
} from "./shared";

// Reads defineEvent's `migrations` option — either the array-of-steps shape
// used by hand-authored calls (`[{ fromVersion, toVersion, transform }]`,
// toVersion is redundant on-disk since it is always fromVersion + 1) or the
// keyed-object canonical shape the Designer renders (`{ "1": transform }`).
// Keyed by fromVersion (as a string) → the transform closure's location.
// Skips malformed entries rather than failing the whole defineEvent extract
// — same "best-effort, degrade gracefully" posture as readDataLiteralNode.
function extractEventMigrationsFromArray(
  arr: Node,
  sourceFile: SourceFile,
): Record<string, SourceLocation> {
  const result: Record<string, SourceLocation> = {};
  const arrLit = arr.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
  for (const el of arrLit.getElements()) {
    const obj = el.asKind(SyntaxKind.ObjectLiteralExpression);
    if (!obj) continue;
    const fromInit = obj
      .getProperty("fromVersion")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    const fromVersion = fromInit ? readDataLiteralNode(fromInit) : undefined;
    if (typeof fromVersion !== "number") continue;
    const transformInit = obj
      .getProperty("transform")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    const fn = transformInit ? findFunctionLiteral(transformInit) : undefined;
    if (!fn) continue;
    result[String(fromVersion)] = sourceLocationFromNode(fn, sourceFile);
  }
  return result;
}

function extractEventMigrationsFromKeyedObject(
  objLit: Node,
  sourceFile: SourceFile,
): Record<string, SourceLocation> {
  const result: Record<string, SourceLocation> = {};
  const obj = objLit.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  for (const prop of obj.getProperties()) {
    const propAssign = prop.asKind(SyntaxKind.PropertyAssignment);
    const initializer = propAssign?.getInitializer();
    const fn = initializer ? findFunctionLiteral(initializer) : undefined;
    if (!propAssign || !fn) continue;
    result[readPropertyKey(propAssign)] = sourceLocationFromNode(fn, sourceFile);
  }
  return result;
}

// Reads defineEvent's `migrations` option — either the array-of-steps shape
// used by hand-authored calls (`[{ fromVersion, toVersion, transform }]`,
// toVersion is redundant on-disk since it is always fromVersion + 1) or the
// keyed-object canonical shape the Designer renders (`{ "1": transform }`).
// Keyed by fromVersion (as a string) → the transform closure's location.
// Skips malformed entries rather than failing the whole defineEvent extract
// — same "best-effort, degrade gracefully" posture as readDataLiteralNode.
function extractEventMigrationsField(
  node: Node,
  sourceFile: SourceFile,
): Readonly<Record<string, SourceLocation>> | undefined {
  const result = node.asKind(SyntaxKind.ArrayLiteralExpression)
    ? extractEventMigrationsFromArray(node, sourceFile)
    : node.asKind(SyntaxKind.ObjectLiteralExpression)
      ? extractEventMigrationsFromKeyedObject(node, sourceFile)
      : undefined;
  return result && Object.keys(result).length > 0 ? result : undefined;
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
    const migrationsInit = obj
      .getProperty("migrations")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    const migrations = migrationsInit
      ? extractEventMigrationsField(migrationsInit, sourceFile)
      : undefined;
    return ok({
      kind: "defineEvent",
      source: sourceLocationFromNode(call, sourceFile),
      eventName: nameInit.getLiteralValue(),
      schemaSource: sourceLocationFromNode(schemaInit, sourceFile),
      ...(version !== undefined && { version }),
      ...(migrations !== undefined && { migrations }),
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
  let migrations: Readonly<Record<string, SourceLocation>> | undefined;
  const optionsArg = args[2];
  const optionsObj = optionsArg?.asKind(SyntaxKind.ObjectLiteralExpression);
  if (optionsObj) {
    const versionInit = optionsObj
      .getProperty("version")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (versionInit) {
      const v = readDataLiteralNode(versionInit);
      if (typeof v === "number") version = v;
    }
    const migrationsInit = optionsObj
      .getProperty("migrations")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer();
    if (migrationsInit) {
      migrations = extractEventMigrationsField(migrationsInit, sourceFile);
    }
  }
  return ok({
    kind: "defineEvent",
    source: sourceLocationFromNode(call, sourceFile),
    eventName: nameArg.getLiteralValue(),
    schemaSource: sourceLocationFromNode(schemaArg, sourceFile),
    ...(version !== undefined && { version }),
    ...(migrations !== undefined && { migrations }),
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
