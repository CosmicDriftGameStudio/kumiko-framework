import type {
  CallExpression,
  ObjectLiteralElementLike,
  ObjectLiteralExpression,
  SourceFile,
} from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { EntityDefinition } from "../../types/fields.ts";
import type { NavDefinition } from "../../types/nav.ts";
import type { RelationDefinition } from "../../types/relations.ts";
import type { WorkspaceDefinition } from "../../types/workspace.ts";
import { describeUnknownFieldType, findUnknownEntityFieldTypes } from "../entity-field-types.ts";
import type { EntityPattern, NavPattern, RelationPattern, WorkspacePattern } from "../patterns.ts";
import { sourceLocationFromNode } from "../source-location.ts";
import {
  type ExtractOutput,
  fail,
  isPlainObject,
  isRawRefSentinel,
  ok,
  type RawRefSentinel,
  readDataLiteralNode,
  readNameLiteral,
  readNameOrRef,
} from "./shared.ts";

type SpreadOnlyEntity = {
  readonly definition: RawRefSentinel;
  readonly backingTable: RawRefSentinel | undefined;
};

function readBackingTableRef(property: ObjectLiteralElementLike): RawRefSentinel | undefined {
  const initializer =
    property.asKind(SyntaxKind.PropertyAssignment)?.getInitializer() ??
    property.asKind(SyntaxKind.ShorthandPropertyAssignment)?.getNameNode();
  const reference = initializer ? readDataLiteralNode(initializer) : undefined;
  return isRawRefSentinel(reference) ? reference : undefined;
}

// `{ name: "x", ...xEntity }` — the definition is a reference the parser cannot
// inline, so it is kept as a raw-ref sentinel and re-rendered as the same spread.
// `backingTable` is runtime wiring (a table identifier), not part of the
// definition data, so it is carried next to the definition and skipped by the shape check.
function readSpreadOnlyDefinition(obj: ObjectLiteralExpression): SpreadOnlyEntity | undefined {
  const isBackingTable = (property: ObjectLiteralElementLike): boolean => {
    const name =
      property.asKind(SyntaxKind.PropertyAssignment)?.getName() ??
      property.asKind(SyntaxKind.ShorthandPropertyAssignment)?.getName();
    return name === "backingTable";
  };
  const allProperties = obj.getProperties();
  const properties = allProperties.filter((property) => !isBackingTable(property));
  const spread =
    properties.length === 2 ? properties[1]?.asKind(SyntaxKind.SpreadAssignment) : undefined;
  if (!spread) return undefined;
  const reference = readDataLiteralNode(spread.getExpression());
  if (!isRawRefSentinel(reference)) return undefined;
  const backingTableProperty = allProperties.find(isBackingTable);
  const backingTable = backingTableProperty ? readBackingTableRef(backingTableProperty) : undefined;
  // A backingTable that is not a plain reference cannot be re-rendered; fall back to the data reader.
  if (backingTableProperty && !backingTable) return undefined;
  return { definition: reference, backingTable };
}

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
    const spreadOnly = readSpreadOnlyDefinition(obj);
    const definition = spreadOnly?.definition ?? readDataLiteralNode(obj);
    if (!isPlainObject(definition)) {
      return fail(
        "entity",
        sourceLocationFromNode(call, sourceFile),
        "definition could not be read as a plain object (contains functions or identifiers)",
      );
    }
    const { name: _name, ...defWithoutName } = definition;
    const unknownTypes = findUnknownEntityFieldTypes(defWithoutName);
    const firstUnknown = unknownTypes[0];
    if (firstUnknown) {
      return fail(
        "entity",
        sourceLocationFromNode(call, sourceFile),
        `definition.fields.${firstUnknown.fieldName}.type: ${describeUnknownFieldType(firstUnknown)}`,
      );
    }
    return ok({
      kind: "entity",
      source: sourceLocationFromNode(call, sourceFile),
      entityName: nameInit.getLiteralValue(),
      // Field-type membership is checked above; the cast is the extractor's
      // existing narrowing contract (readDataLiteralNode returns unknown).
      definition: defWithoutName as EntityDefinition,
      ...(spreadOnly?.backingTable && { backingTable: spreadOnly.backingTable }),
    });
  }

  const entityName = readNameLiteral(first);
  if (entityName === undefined) {
    return fail(
      "entity",
      sourceLocationFromNode(call, sourceFile),
      "first argument must be a string literal name, or an identifier resolving to one (or use the object form)",
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
  const unknownTypes = findUnknownEntityFieldTypes(definition);
  const firstUnknown = unknownTypes[0];
  if (firstUnknown) {
    return fail(
      "entity",
      sourceLocationFromNode(call, sourceFile),
      `definition.fields.${firstUnknown.fieldName}.type: ${describeUnknownFieldType(firstUnknown)}`,
    );
  }
  return ok({
    kind: "entity",
    source: sourceLocationFromNode(call, sourceFile),
    entityName,
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
  const relationNameArg = args[1];
  const relationName = relationNameArg && readNameLiteral(relationNameArg);
  if (!relationName) {
    return fail(
      "relation",
      sourceLocationFromNode(call, sourceFile),
      "second argument must be a string literal relation name, or an identifier resolving to one",
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
    relationName,
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
