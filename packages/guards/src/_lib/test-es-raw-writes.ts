// Static detection of projection-only writes on event-sourced tables in tests. Without
// types the guard knows a table is event-sourced only when the file builds it itself
// (buildEntityTable) or names it by its reserved read_ prefix; imported tables in
// template SQL stay invisible.
import type { SourceFile } from "ts-morph";
import { Node, SyntaxKind } from "ts-morph";

export type RawWriteFinding = { readonly line: number; readonly message: string };

const EVENTS_TABLE_NAME = "eventsTable";

export const SEED_ROW_MESSAGE =
  "seedRow on an event-sourced entity table writes the projection without its event: use seedRowViaEventStore";

export const RAW_SQL_MESSAGE =
  "raw DELETE/UPDATE on an event-sourced table in a test: reset with resetTestTables(db, [table, eventsTable]), " +
  "change rows through the real command or updateRowViaEventStore/deleteRowViaEventStore";

// kumiko_events UPDATEs are reported by the test-es-fixtures guard already.
const LITERAL_WRITE_RE =
  /\b(?:DELETE\s+FROM\s+"?(?:read_\w+|kumiko_events)|UPDATE\s+"?read_\w+)\b/i;
const TEMPLATE_WRITE_RE = /\b(?:DELETE\s+FROM|UPDATE)\s+"?\$\{\s*(\w+)(?:\.tableName)?\s*\}/gi;

// Both write patterns start like this; a literal's text is part of the file's, so a
// file without it has nothing to report.
const SQL_WRITE_START_RE = /\b(?:DELETE\s+FROM|UPDATE)\s/i;

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

function isEventSourcedBinding(name: string, entityTables: ReadonlySet<string>): boolean {
  return name === EVENTS_TABLE_NAME || entityTables.has(name);
}

function writesEventSourcedTable(node: Node, entityTables: ReadonlySet<string>): boolean {
  const text = node.getText();
  if (LITERAL_WRITE_RE.test(text)) return true;
  if (!Node.isTemplateExpression(node)) return false;
  for (const match of text.matchAll(TEMPLATE_WRITE_RE)) {
    if (isEventSourcedBinding(match[1] ?? "", entityTables)) return true;
  }
  return false;
}

export function findRawSqlWrites(sourceFile: SourceFile): RawWriteFinding[] {
  const findings: RawWriteFinding[] = [];
  if (!SQL_WRITE_START_RE.test(sourceFile.getFullText())) return findings;
  const entityTables = entityTableBindings(sourceFile);
  for (const kind of [
    SyntaxKind.StringLiteral,
    SyntaxKind.NoSubstitutionTemplateLiteral,
    SyntaxKind.TemplateExpression,
  ]) {
    for (const node of sourceFile.getDescendantsOfKind(kind)) {
      if (writesEventSourcedTable(node, entityTables)) {
        findings.push({ line: node.getStartLineNumber(), message: RAW_SQL_MESSAGE });
      }
    }
  }
  return findings;
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
        entityTables.has(table.getText())
      );
    })
    .map((call) => ({ line: call.getStartLineNumber(), message: SEED_ROW_MESSAGE }));
}
