import type { CallExpression, SourceFile } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { EntityDefinition } from "../../types/fields";
import type { NavDefinition } from "../../types/nav";
import type { RelationDefinition } from "../../types/relations";
import type { WorkspaceDefinition } from "../../types/workspace";
import type { EntityPattern, NavPattern, RelationPattern, WorkspacePattern } from "../patterns";
import { sourceLocationFromNode } from "../source-location";
import {
  type ExtractOutput,
  fail,
  isPlainObject,
  ok,
  readDataLiteralNode,
  readNameOrRef,
} from "./shared";

export function extractEntity(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<EntityPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "entity",
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
        "entity",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const definition = readDataLiteralNode(obj);
    if (!isPlainObject(definition)) {
      return fail(
        "entity",
        sourceLocationFromNode(call, sourceFile),
        "definition could not be read as a plain object (contains functions or identifiers)",
      );
    }
    const { name: _name, ...defWithoutName } = definition;
    return ok({
      kind: "entity",
      source: sourceLocationFromNode(call, sourceFile),
      entityName: nameInit.getLiteralValue(),
      definition: defWithoutName as EntityDefinition,
    });
  }

  const nameArg = first.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "entity",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal name (or use the object form)",
    );
  }
  const defArg = args[1];
  if (!defArg) {
    return fail(
      "entity",
      sourceLocationFromNode(call, sourceFile),
      "expected a definition object as second argument",
    );
  }
  const definition = readDataLiteralNode(defArg);
  if (!isPlainObject(definition)) {
    return fail(
      "entity",
      sourceLocationFromNode(call, sourceFile),
      "definition could not be read as a plain object (contains functions or identifiers)",
    );
  }
  return ok({
    kind: "entity",
    source: sourceLocationFromNode(call, sourceFile),
    entityName: nameArg.getLiteralValue(),
    definition: definition as EntityDefinition,
  });
}

export function extractRelation(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<RelationPattern> {
  const args = call.getArguments();
  const first = args[0];
  if (!first) {
    return fail(
      "relation",
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
        "relation",
        sourceLocationFromNode(call, sourceFile),
        "object form requires an `entity` property",
      );
    }
    const entityName = readNameOrRef(entityInit);
    if (!entityName) {
      return fail(
        "relation",
        sourceLocationFromNode(call, sourceFile),
        '`entity` must be a string literal or `{ name: "..." }` ref',
      );
    }
    const nameInit = obj
      .getProperty("name")
      ?.asKind(SyntaxKind.PropertyAssignment)
      ?.getInitializer()
      ?.asKind(SyntaxKind.StringLiteral);
    if (!nameInit) {
      return fail(
        "relation",
        sourceLocationFromNode(call, sourceFile),
        "object form requires a string-literal `name` property",
      );
    }
    const definition = readDataLiteralNode(obj);
    if (!isPlainObject(definition)) {
      return fail(
        "relation",
        sourceLocationFromNode(call, sourceFile),
        "definition could not be read as a plain object",
      );
    }
    const { entity: _e, name: _n, ...defWithoutCarriers } = definition;
    return ok({
      kind: "relation",
      source: sourceLocationFromNode(call, sourceFile),
      entityName,
      relationName: nameInit.getLiteralValue(),
      definition: defWithoutCarriers as RelationDefinition,
    });
  }

  const entityName = readNameOrRef(first);
  if (!entityName) {
    return fail(
      "relation",
      sourceLocationFromNode(call, sourceFile),
      'first argument must be a string literal or an inline { name: "..." } object (or use the object form)',
    );
  }
  const nameArg = args[1]?.asKind(SyntaxKind.StringLiteral);
  if (!nameArg) {
    return fail(
      "relation",
      sourceLocationFromNode(call, sourceFile),
      "second argument must be a string literal relation name",
    );
  }
  const defArg = args[2];
  if (!defArg) {
    return fail(
      "relation",
      sourceLocationFromNode(call, sourceFile),
      "expected a definition object as third argument",
    );
  }
  const definition = readDataLiteralNode(defArg);
  if (!isPlainObject(definition)) {
    return fail(
      "relation",
      sourceLocationFromNode(call, sourceFile),
      "definition could not be read as a plain object",
    );
  }
  return ok({
    kind: "relation",
    source: sourceLocationFromNode(call, sourceFile),
    entityName,
    relationName: nameArg.getLiteralValue(),
    definition: definition as RelationDefinition,
  });
}

export function extractNav(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<NavPattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "nav",
      sourceLocationFromNode(call, sourceFile),
      "expected a NavDefinition object as first argument",
    );
  }
  const definition = readDataLiteralNode(arg);
  if (!isPlainObject(definition)) {
    return fail(
      "nav",
      sourceLocationFromNode(call, sourceFile),
      "definition could not be read as a plain object",
    );
  }
  return ok({
    kind: "nav",
    source: sourceLocationFromNode(call, sourceFile),
    definition: definition as NavDefinition,
  });
}

export function extractWorkspace(
  call: CallExpression,
  sourceFile: SourceFile,
): ExtractOutput<WorkspacePattern> {
  const arg = call.getArguments()[0];
  if (!arg) {
    return fail(
      "workspace",
      sourceLocationFromNode(call, sourceFile),
      "expected a WorkspaceDefinition object as first argument",
    );
  }
  const definition = readDataLiteralNode(arg);
  if (!isPlainObject(definition)) {
    return fail(
      "workspace",
      sourceLocationFromNode(call, sourceFile),
      "definition could not be read as a plain object",
    );
  }
  return ok({
    kind: "workspace",
    source: sourceLocationFromNode(call, sourceFile),
    definition: definition as WorkspaceDefinition,
  });
}
