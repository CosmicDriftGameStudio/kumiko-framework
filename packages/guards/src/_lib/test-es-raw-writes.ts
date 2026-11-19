// Static detection of projection-only writes on event-sourced tables in tests. Without
// types the guard knows a table is event-sourced only when the file builds it itself
// (buildEntityTable), declares it (createEntity `table:`) or names it by its reserved read_
// prefix, directly or through a const in the file; imported tables and parameters stay invisible.
import type { CallExpression, ObjectLiteralExpression, SourceFile } from "ts-morph";
import { Node, SyntaxKind } from "ts-morph";
import { decodedLiteralText, mayContainEscapedLiteral } from "./escaped-literal";

export type RawWriteFinding = { readonly line: number; readonly message: string };

const EVENTS_TABLE_NAME = "eventsTable";
const EVENTS_TABLE_SQL_NAME = "kumiko_events";

export const SEED_ROW_MESSAGE =
  "seedRow on an event-sourced entity table writes the projection without its event: use seedRowViaEventStore, " +
  "or pass { projectionOnly: reason } for a deliberate event-less row";

export const RAW_SQL_MESSAGE =
  "raw INSERT/UPDATE/DELETE/TRUNCATE on an event-sourced table in a test: reset with resetTestTables(db, [table, eventsTable]), " +
  "change rows through the real command or updateRowViaEventStore/deleteRowViaEventStore; " +
  "a deliberate projection-only state goes through seedRow/updateRows/deleteRows with { projectionOnly: reason }";

export const EVENTS_TABLE_WRITE_MESSAGE =
  "direct row write on the events table in a test: append events through the real command, " +
  "seedRowViaEventStore or runSeedWritesAt, reset with resetEventStore or resetTestTables";

const WRITE_VERB = String.raw`(?:DELETE\s+FROM|UPDATE|INSERT\s+INTO|MERGE\s+INTO)\s+(?:ONLY\s+)?`;
const SCHEMA_PREFIX = String.raw`(?:"?\w+"?\.)?`;

// A row write (DELETE/UPDATE/INSERT/MERGE, ONLY and a schema allowed) or a COPY … FROM into
// the table matched by namePattern.
function tableWritePattern(namePattern: string): string {
  return String.raw`\b(?:${WRITE_VERB}${SCHEMA_PREFIX}"?${namePattern}(?!\w)|COPY\s+${SCHEMA_PREFIX}"?${namePattern}"?(?:\s*\([^)]*\))?\s+FROM\b)`;
}

// kumiko_events INSERT/UPDATE literals outside an apply are reported by the
// es-literal-writes-tests Biome plugin already.
const LITERAL_WRITE_RE = new RegExp(
  `${tableWritePattern(String.raw`read_\w+`)}|\\bDELETE\\s+FROM\\s+(?:ONLY\\s+)?${SCHEMA_PREFIX}"?kumiko_events\\b`,
  "i",
);
const EVENTS_TABLE_WRITE_RE = new RegExp(tableWritePattern(EVENTS_TABLE_SQL_NAME), "i");
const TEMPLATE_WRITE_RE = new RegExp(
  String.raw`\b${WRITE_VERB}${SCHEMA_PREFIX}"?\$\{\s*(\w+)(?:\.tableName)?\s*\}`,
  "gi",
);
const TRUNCATE_LIST_RE =
  /\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?([^;]*?)(?=\s+(?:RESTART|CONTINUE|CASCADE|RESTRICT)\b|;|$)/gi;
const TEMPLATE_BINDING_RE = /^\$\{\s*(\w+)(?:\.tableName)?\s*\}$/;

// Every write pattern starts like this; a literal's text is part of the file's, so a
// file without it has nothing to report.
const SQL_WRITE_START_RE = /\b(?:DELETE\s+FROM|UPDATE|INSERT\s+INTO|MERGE\s+INTO|COPY|TRUNCATE)\s/i;

// Row writers of the framework db layer and the testing helpers; clearTables/resetTestTables
// stay allowed because wiping eventsTable together with the projection is the sanctioned reset.
const EVENTS_TABLE_WRITERS: ReadonlySet<string> = new Set([
  "seedRow",
  "seedRows",
  "updateRows",
  "deleteRows",
  "insertOne",
  "insertMany",
  "updateMany",
  "deleteMany",
  "insert",
  "update",
  "delete",
]);

function entityTableBindings(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  if (!sourceFile.getFullText().includes("buildEntityTable")) return names;
  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (
      init &&
      Node.isCallExpression(init) &&
      init.getExpression().getText() === "buildEntityTable"
    ) {
      names.add(decl.getName());
    }
  }
  return names;
}

function stringConstantsOf(sourceFile: SourceFile): Map<string, string> {
  const constants = new Map<string, string>();
  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) {
      constants.set(decl.getName(), init.getLiteralText());
    }
  }
  return constants;
}

function stringValueOf(node: Node | undefined, constants: ReadonlyMap<string, string>) {
  if (node === undefined) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  return Node.isIdentifier(node) ? constants.get(node.getText()) : undefined;
}

// SQL names given as `table:` to createEntity in the file, inline or through a const.
function createdEntityTableNames(
  sourceFile: SourceFile,
  constants: ReadonlyMap<string, string>,
): Set<string> {
  const names = new Set<string>();
  if (!sourceFile.getFullText().includes("createEntity")) return names;
  const unmanaged = unmanagedEntityIdentifiers(sourceFile);
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (calleeName(call.getExpression()) !== "createEntity") continue;
    const binding = call.getParent();
    if (Node.isVariableDeclaration(binding) && unmanaged.has(binding.getName())) continue;
    const options = call.getArguments()[0];
    if (!options || !Node.isObjectLiteralExpression(options)) continue;
    const property = options.getProperty("table");
    const value = Node.isPropertyAssignment(property)
      ? stringValueOf(property.getInitializer(), constants)
      : Node.isShorthandPropertyAssignment(property)
        ? constants.get(property.getName())
        : undefined;
    if (value !== undefined) names.add(value);
  }
  return names;
}

// `deriveEntityTableMeta(entity, { source: "unmanaged" })` makes the entity's table a plain
// store without events, like defineUnmanagedTable.
function unmanagedEntityIdentifiers(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (calleeName(call.getExpression()) !== "deriveEntityTableMeta") continue;
    const [entity, options] = call.getArguments();
    if (!Node.isIdentifier(entity) || !Node.isObjectLiteralExpression(options)) continue;
    const source = options.getProperty("source");
    if (!Node.isPropertyAssignment(source)) continue;
    if (stringValueOf(source.getInitializer(), new Map()) === "unmanaged") {
      names.add(entity.getText());
    }
  }
  return names;
}

function isEntityTableName(name: string, entityTableNames: ReadonlySet<string>): boolean {
  return /^read_\w+$/i.test(name) || entityTableNames.has(name);
}

// `<entity table>.tableName` or `buildEntityTable(entity).tableName`.
function isEntityTableNameAccess(node: Node, builtTables: ReadonlySet<string>): boolean {
  if (!Node.isPropertyAccessExpression(node) || node.getName() !== "tableName") return false;
  const target = node.getExpression();
  if (Node.isIdentifier(target)) return builtTables.has(target.getText());
  return Node.isCallExpression(target) && target.getExpression().getText() === "buildEntityTable";
}

// Identifiers that stand for an entity table in template SQL: a table the file builds, or a
// const holding its name (a read_ literal, a createEntity `table:` value or `<table>.tableName`).
function entityTableIdentifiers(
  sourceFile: SourceFile,
  constants: ReadonlyMap<string, string>,
  entityTableNames: ReadonlySet<string>,
): Set<string> {
  const builtTables = entityTableBindings(sourceFile);
  const identifiers = new Set(builtTables);
  for (const [name, value] of constants) {
    if (isEntityTableName(value, entityTableNames)) identifiers.add(name);
  }
  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (init && isEntityTableNameAccess(init, builtTables)) identifiers.add(decl.getName());
  }
  return identifiers;
}

function eventsTableBindings(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>([EVENTS_TABLE_NAME]);
  for (const decl of sourceFile.getImportDeclarations()) {
    for (const spec of decl.getNamedImports()) {
      const alias = spec.getAliasNode();
      if (spec.getName() === EVENTS_TABLE_NAME && alias) names.add(alias.getText());
    }
  }
  return names;
}

type TableBindings = {
  readonly entityTables: ReadonlySet<string>;
  readonly entityTableNames: ReadonlySet<string>;
  readonly eventsTables: ReadonlySet<string>;
  // The file knows a projection table; wiping kumiko_events alone would orphan its rows.
  readonly declaresProjections: boolean;
};

function isEventSourcedBinding(name: string, bindings: TableBindings): boolean {
  return bindings.eventsTables.has(name) || bindings.entityTables.has(name);
}

function templateWritesEventSourcedTable(
  text: string,
  pattern: RegExp,
  bindings: TableBindings,
): boolean {
  for (const match of text.matchAll(pattern)) {
    if (isEventSourcedBinding(match[1] ?? "", bindings)) return true;
  }
  return false;
}

type TruncatedTable = "events" | "projection" | "other";

function classifyTruncatedTable(entry: string, bindings: TableBindings): TruncatedTable {
  // Raw literal text keeps the literal's own quotes next to the identifier quotes.
  const name = entry
    .replace(/["'`]/g, "")
    .trim()
    .replace(/^\w+\.(?=\S)/, "");
  const binding = TEMPLATE_BINDING_RE.exec(name)?.[1];
  if (binding !== undefined) {
    if (bindings.eventsTables.has(binding)) return "events";
    return bindings.entityTables.has(binding) ? "projection" : "other";
  }
  if (name.toLowerCase() === EVENTS_TABLE_SQL_NAME) return "events";
  return isEntityTableName(name, bindings.entityTableNames) ? "projection" : "other";
}

function writesNamedEntityTable(text: string, entityTableNames: ReadonlySet<string>): boolean {
  for (const name of entityTableNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(tableWritePattern(escaped), "i").test(text)) return true;
  }
  return false;
}

function truncatedKinds(text: string, bindings: TableBindings): TruncatedTable[][] {
  return [...text.matchAll(TRUNCATE_LIST_RE)].map((match) =>
    (match[1] ?? "").split(",").map((entry) => classifyTruncatedTable(entry, bindings)),
  );
}

// Truncating kumiko_events together with the projection is a reset, both stay consistent;
// truncating a projection alone leaves rows its events no longer produce, and truncating
// kumiko_events alone, like DELETE FROM kumiko_events, leaves the file's projection rows
// without events. A pure event-store test without any projection has nothing to orphan.
function truncatesWithoutReset(text: string, bindings: TableBindings): boolean {
  return truncatedKinds(text, bindings).some((kinds) => {
    const projection = kinds.includes("projection");
    const events = kinds.includes("events");
    return projection ? !events : events && bindings.declaresProjections;
  });
}

function writesEventsTable(node: Node, bindings: TableBindings): boolean {
  const text = decodedLiteralText(node);
  if (EVENTS_TABLE_WRITE_RE.test(text)) return true;
  if (truncatedKinds(text, bindings).some((kinds) => kinds.includes("events"))) return true;
  if (!Node.isTemplateExpression(node)) return false;
  for (const match of text.matchAll(TEMPLATE_WRITE_RE)) {
    if (bindings.eventsTables.has(match[1] ?? "")) return true;
  }
  return false;
}

function writesEventSourcedTable(node: Node, bindings: TableBindings): boolean {
  const text = decodedLiteralText(node);
  if (LITERAL_WRITE_RE.test(text)) return true;
  if (writesNamedEntityTable(text, bindings.entityTableNames)) return true;
  if (truncatesWithoutReset(text, bindings)) return true;
  return (
    Node.isTemplateExpression(node) &&
    templateWritesEventSourcedTable(text, TEMPLATE_WRITE_RE, bindings)
  );
}

// A projection's apply handler writing its own table is the event path itself; the events
// table is never part of that exemption.
function isInsideProjectionApply(node: Node): boolean {
  return node
    .getAncestors()
    .some(
      (ancestor) =>
        Node.isPropertyAssignment(ancestor) &&
        ancestor.getName() === "apply" &&
        Node.isObjectLiteralExpression(ancestor.getInitializer()),
    );
}

export function findRawSqlWrites(sourceFile: SourceFile): RawWriteFinding[] {
  const findings: RawWriteFinding[] = [];
  const text = sourceFile.getFullText();
  if (!SQL_WRITE_START_RE.test(text) && !mayContainEscapedLiteral(text)) return findings;
  const constants = stringConstantsOf(sourceFile);
  const entityTableNames = createdEntityTableNames(sourceFile, constants);
  const entityTables = entityTableIdentifiers(sourceFile, constants, entityTableNames);
  const bindings: TableBindings = {
    entityTables,
    entityTableNames,
    eventsTables: eventsTableBindings(sourceFile),
    declaresProjections:
      entityTables.size > 0 || entityTableNames.size > 0 || /\bread_\w+/i.test(text),
  };
  for (const kind of [
    SyntaxKind.StringLiteral,
    SyntaxKind.NoSubstitutionTemplateLiteral,
    SyntaxKind.TemplateExpression,
  ]) {
    for (const node of sourceFile.getDescendantsOfKind(kind)) {
      const reported = isInsideProjectionApply(node)
        ? writesEventsTable(node, bindings)
        : writesEventSourcedTable(node, bindings);
      if (reported) {
        findings.push({ line: node.getStartLineNumber(), message: RAW_SQL_MESSAGE });
      }
    }
  }
  return findings;
}

// An options object passed inline or through a const in the same file; one built any other
// way is not followed, so the call is reported.
function optionsObjectOf(arg: Node): ObjectLiteralExpression | undefined {
  if (Node.isObjectLiteralExpression(arg)) return arg;
  if (!Node.isIdentifier(arg)) return undefined;
  const decl = arg
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .find((candidate) => candidate.getName() === arg.getText());
  const init = decl?.getInitializer();
  return init && Node.isObjectLiteralExpression(init) ? init : undefined;
}

function isNonEmptyReason(value: Node | undefined): boolean {
  if (value === undefined) return false;
  if (Node.isStringLiteral(value) || Node.isNoSubstitutionTemplateLiteral(value)) {
    return value.getLiteralText().trim() !== "";
  }
  // A constant or expression: the helper rejects an empty reason at runtime.
  return true;
}

export function hasProjectionOnlyReason(call: CallExpression): boolean {
  return call.getArguments().some((arg) => {
    const property = optionsObjectOf(arg)?.getProperty("projectionOnly");
    if (Node.isShorthandPropertyAssignment(property)) return true;
    return Node.isPropertyAssignment(property) && isNonEmptyReason(property.getInitializer());
  });
}

export function findSeedRowOnEntityTables(
  sourceFile: SourceFile,
  isSeedRowCallee: (callee: Node) => boolean,
): RawWriteFinding[] {
  const entityTables = entityTableBindings(sourceFile);
  if (entityTables.size === 0) return [];
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => {
      const table = call.getArguments()[1];
      return (
        isSeedRowCallee(call.getExpression()) &&
        table !== undefined &&
        Node.isIdentifier(table) &&
        entityTables.has(table.getText()) &&
        !hasProjectionOnlyReason(call)
      );
    })
    .map((call) => ({ line: call.getStartLineNumber(), message: SEED_ROW_MESSAGE }));
}

function calleeName(callee: Node): string | undefined {
  if (Node.isIdentifier(callee)) return callee.getText();
  if (Node.isPropertyAccessExpression(callee)) return callee.getName();
  return undefined;
}

// Reported even with a projectionOnly reason: the event log is the source of truth, so
// there is no deliberate event-less state of it.
export function findEventsTableWrites(sourceFile: SourceFile): RawWriteFinding[] {
  const eventsTables = eventsTableBindings(sourceFile);
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter((call) => {
      const name = calleeName(call.getExpression());
      return (
        name !== undefined &&
        EVENTS_TABLE_WRITERS.has(name) &&
        call.getArguments().some((arg) => Node.isIdentifier(arg) && eventsTables.has(arg.getText()))
      );
    })
    .map((call) => ({ line: call.getStartLineNumber(), message: EVENTS_TABLE_WRITE_MESSAGE }));
}
