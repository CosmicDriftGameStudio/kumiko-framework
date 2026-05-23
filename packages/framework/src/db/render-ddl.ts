// Pure renderer: EntityTableMeta → SQL DDL statements.
// Wird vom Migrate-Generator (Phase 2 — CLI-Tool `kumiko migrate generate`)
// genutzt um initial-SQL-Files zu schreiben. Output ist Start-Form für
// User-Review — App-Author darf das SQL danach hand-editieren (extra-Index,
// partial-Index, BRIN, custom-clauses) bevor committed wird.
//
// NO-MAGIC-ON-DATA: dieser Renderer wird NIE zur App-Runtime aufgerufen.
// Nur Build-Step. Runner liest checked-in SQL, nicht Renderer-Output.

import type { ColumnMeta, EntityTableMeta, IndexMeta } from "./entity-table-meta";

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function renderColumn(col: ColumnMeta): string {
  const parts: string[] = [quoteIdent(col.name), col.pgType];
  if (col.primaryKey) parts.push("PRIMARY KEY");
  if (col.defaultSql !== undefined) parts.push(`DEFAULT ${col.defaultSql}`);
  if (col.notNull && !col.primaryKey) parts.push("NOT NULL");
  return parts.join(" ");
}

function renderIndex(tableName: string, idx: IndexMeta): string {
  const kind = idx.unique === true ? "UNIQUE INDEX" : "INDEX";
  const colList = idx.columns.map(quoteIdent).join(", ");
  if (idx.needsManualWhere === true) {
    return [
      `-- WARN: partial-index "${idx.name}" needs a WHERE clause that the`,
      `--       generator can't render (entity uses drizzle sql\`…\` AST).`,
      `--       Add the WHERE manually before applying:`,
      `-- CREATE ${kind} IF NOT EXISTS ${quoteIdent(idx.name)} ON ${quoteIdent(tableName)} (${colList}) WHERE <your-condition>;`,
    ].join("\n");
  }
  const where = idx.whereSql !== undefined ? ` WHERE ${idx.whereSql}` : "";
  return `CREATE ${kind} IF NOT EXISTS ${quoteIdent(idx.name)} ON ${quoteIdent(tableName)} (${colList})${where};`;
}

export function renderTableDdl(meta: EntityTableMeta): readonly string[] {
  const colLines = meta.columns.map(renderColumn);
  const lines: string[] = [...colLines];
  if (meta.compositePrimaryKey !== undefined) {
    const pkCols = meta.compositePrimaryKey.columns.map(quoteIdent).join(",");
    lines.push(`CONSTRAINT ${quoteIdent(meta.compositePrimaryKey.name)} PRIMARY KEY(${pkCols})`);
  }
  const create = `CREATE TABLE IF NOT EXISTS ${quoteIdent(meta.tableName)} (\n  ${lines.join(",\n  ")}\n);`;
  const indexes = meta.indexes.map((idx) => renderIndex(meta.tableName, idx));
  return [create, ...indexes];
}

export function renderTablesDdl(metas: readonly EntityTableMeta[]): readonly string[] {
  const stmts: string[] = [];
  for (const m of metas) stmts.push(...renderTableDdl(m));
  return stmts;
}
