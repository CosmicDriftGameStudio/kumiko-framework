import type {
  NavDefinition,
  RelationDefinition,
  WorkspaceDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import type {
  CallExpression,
  Node,
  ObjectLiteralElementLike,
  ObjectLiteralExpression,
  SourceFile,
  VariableDeclaration,
} from "ts-morph";
import { SyntaxKind } from "ts-morph";
import { describeUnknownFieldType, findUnknownEntityFieldTypes } from "../entity-field-types.ts";
import type {
  EntityPattern,
  EntityPatternDefinition,
  NavPattern,
  RelationPattern,
  WorkspacePattern,
} from "../patterns.ts";
import { sourceLocationFromNode } from "../source-location.ts";
import {
  findImportBindingForLocalName,
  findScopedVariableDeclaration,
  resolveExportedVariable,
  resolveModuleFile,
} from "./resolve-import.ts";
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
  readonly overridesName: boolean;
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
  if (properties.length !== 2) return undefined;
  const leadingSpread = properties[0]?.asKind(SyntaxKind.SpreadAssignment);
  const spread = leadingSpread ?? properties[1]?.asKind(SyntaxKind.SpreadAssignment);
  if (!spread) return undefined;
  const reference = readDataLiteralNode(spread.getExpression());
  if (!isRawRefSentinel(reference)) return undefined;
  const backingTableProperty = allProperties.find(isBackingTable);
  const backingTable = backingTableProperty ? readBackingTableRef(backingTableProperty) : undefined;
  // A backingTable that is not a plain reference cannot be re-rendered; fall back to the data reader.
  if (backingTableProperty && !backingTable) return undefined;
  return { definition: reference, backingTable, overridesName: leadingSpread !== undefined };
}

type EntityReference = {
  readonly definition: RawRefSentinel;
  readonly backingTable: RawRefSentinel | undefined;
  readonly entityName: string | undefined;
};

function findEntityDeclaration(
  identifier: Node,
  sourceFile: SourceFile,
): VariableDeclaration | undefined {
  const localName = identifier.getText();
  const local = findScopedVariableDeclaration(identifier, localName);
  if (local) return local;
  const binding = findImportBindingForLocalName(sourceFile, localName);
  if (!binding) return undefined;
  const target = resolveModuleFile(sourceFile, binding.moduleSpecifier);
  return target ? resolveExportedVariable(target, binding.importedName) : undefined;
}

function readCreateEntityCallName(call: CallExpression | undefined): string | undefined {
  if (call?.getExpression().getText() !== "createEntity") return undefined;
  const nameInitializer = call
    .getArguments()[0]
    ?.asKind(SyntaxKind.ObjectLiteralExpression)
    ?.getProperty("name")
    ?.asKind(SyntaxKind.PropertyAssignment)
    ?.getInitializer();
  return nameInitializer ? readNameLiteral(nameInitializer) : undefined;
}

// The `name` of the `createEntity({ name: "x", ... })` an identifier points at, in this file or an imported one.
function readCreateEntityName(identifier: Node, sourceFile: SourceFile): string | undefined {
  const declaration = findEntityDeclaration(identifier, sourceFile);
  const initializer = declaration?.getInitializer()?.asKind(SyntaxKind.CallExpression);
  if (!declaration || !initializer) return undefined;
  return (
    readCreateEntityCallName(initializer) ??
    readFactoryEntityName(initializer, declaration.getSourceFile(), 0)
  );
}

const MAX_ENTITY_FACTORY_DEPTH = 4;

// `const entity = createXEntity(opts)`: follow the factory's `return` chain (same file or imported)
// down to the `createEntity({ name, ... })` call. Only plain `return <call>` statements of the
// factory body count; anything else stays unreadable and surfaces as a parse error.
function readFactoryEntityName(
  call: CallExpression,
  sourceFile: SourceFile,
  depth: number,
): string | undefined {
  if (depth >= MAX_ENTITY_FACTORY_DEPTH) return undefined;
  const callee = call.getExpression().asKind(SyntaxKind.Identifier)?.getText();
  if (callee === undefined) return undefined;
  let factoryFile = sourceFile;
  let factory = sourceFile.getFunction(callee);
  if (!factory) {
    const binding = findImportBindingForLocalName(sourceFile, callee);
    const target = binding ? resolveModuleFile(sourceFile, binding.moduleSpecifier) : undefined;
    if (!binding || !target) return undefined;
    factoryFile = target;
    factory = target.getFunction(binding.importedName);
  }
  for (const statement of factory?.getStatements() ?? []) {
    const returned = statement.asKind(SyntaxKind.ReturnStatement)?.getExpression();
    const returnedCall = returned?.asKind(SyntaxKind.CallExpression);
    if (!returnedCall) continue;
    const name =
      readCreateEntityCallName(returnedCall) ??
      readFactoryEntityName(returnedCall, factoryFile, depth + 1);
    if (name !== undefined) return name;
  }
  return undefined;
}

// `r.entity(xEntity)` and `r.entity({ ...xEntity, backingTable })`: the entity carries its own name.
function readEntityReference(first: Node, sourceFile: SourceFile): EntityReference | undefined {
  const inlineCall = first.asKind(SyntaxKind.CallExpression);
  if (inlineCall?.getExpression().getText() === "createEntity") {
    return {
      definition: { __raw: inlineCall.getText() },
      backingTable: undefined,
      entityName: readCreateEntityCallName(inlineCall),
    };
  }
  const identifier = first.asKind(SyntaxKind.Identifier);
  if (identifier) {
    return {
      definition: { __raw: identifier.getText() },
      backingTable: undefined,
      entityName: readCreateEntityName(identifier, sourceFile),
    };
  }
  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (!obj || obj.getProperty("name") !== undefined) return undefined;
  const properties = obj.getProperties();
  const backingTableProperty = properties.find((property) => {
    const name =
      property.asKind(SyntaxKind.PropertyAssignment)?.getName() ??
      property.asKind(SyntaxKind.ShorthandPropertyAssignment)?.getName();
    return name === "backingTable";
  });
  const rest = properties.filter((property) => property !== backingTableProperty);
  const spreadTarget =
    rest.length === 1 ? rest[0]?.asKind(SyntaxKind.SpreadAssignment)?.getExpression() : undefined;
  const identifierTarget = spreadTarget?.asKind(SyntaxKind.Identifier);
  if (!identifierTarget) return undefined;
  const backingTable = backingTableProperty ? readBackingTableRef(backingTableProperty) : undefined;
  if (backingTableProperty && !backingTable) return undefined;
  return {
    definition: { __raw: identifierTarget.getText() },
    backingTable,
    entityName: readCreateEntityName(identifierTarget, sourceFile),
  };
}

function extractEntityFromReference(
  call: CallExpression,
  sourceFile: SourceFile,
  reference: EntityReference,
): ExtractOutput<EntityPattern> {
  if (reference.entityName === undefined) {
    return fail(
      "entity",
      sourceLocationFromNode(call, sourceFile),
      'the entity\'s name could not be read: declare it with createEntity({ name: "...", ... }) in the same file',
    );
  }
  // Same narrowing contract as the inline path: the reference stays opaque until render.
  const opaqueDefinition: Record<string, unknown> = reference.definition;
  return ok({
    kind: "entity",
    source: sourceLocationFromNode(call, sourceFile),
    entityName: reference.entityName,
    definition: opaqueDefinition as EntityPatternDefinition,
    ...(reference.backingTable && { backingTable: reference.backingTable }),
  });
}

function extractEntityFromObjectForm(
  call: CallExpression,
  sourceFile: SourceFile,
  obj: ObjectLiteralExpression,
): ExtractOutput<EntityPattern> {
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
    definition: defWithoutName as EntityPatternDefinition,
    ...(spreadOnly?.backingTable && { backingTable: spreadOnly.backingTable }),
    ...(spreadOnly?.overridesName && { overridesName: true }),
  });
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

  const reference = args.length === 1 ? readEntityReference(first, sourceFile) : undefined;
  if (reference) return extractEntityFromReference(call, sourceFile, reference);

  const obj = first.asKind(SyntaxKind.ObjectLiteralExpression);
  if (obj && args.length === 1) return extractEntityFromObjectForm(call, sourceFile, obj);

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
    definition: definition as EntityPatternDefinition,
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
