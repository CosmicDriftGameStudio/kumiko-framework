// Pure SQL fragments of a schema diff: column/index change shapes and their
// reviewer-facing rendering. Kept free of the diff logic so migrate-generator
// can import it without a cycle.

import type { ColumnMeta } from "./entity-table-meta.ts";
import { quoteIdent } from "./sql-identifier.ts";

export type ColumnChange = {
  readonly name: string;
  readonly nullabilityChanged?: { readonly from: boolean; readonly to: boolean };
  readonly defaultChanged?: { readonly from: string | undefined; readonly to: string | undefined };
  readonly typeChanged?: { readonly from: string; readonly to: string };
};

export type IndexChange = {
  readonly name: string;
  readonly columnsChanged?: { readonly from: readonly string[]; readonly to: readonly string[] };
  readonly uniqueChanged?: { readonly from: boolean; readonly to: boolean };
  readonly whereSqlChanged?: { readonly from: string | undefined; readonly to: string | undefined };
  readonly needsManualWhereChanged?: { readonly from: boolean; readonly to: boolean };
};

function renderColumnInline(col: ColumnMeta): string {
  const parts: string[] = [quoteIdent(col.name), col.pgType];
  if (col.defaultSql !== undefined) parts.push(`DEFAULT ${col.defaultSql}`);
  if (col.notNull) parts.push("NOT NULL");
  return parts.join(" ");
}

export function renderAddColumn(tableName: string, col: ColumnMeta): string {
  return `ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN ${renderColumnInline(col)};`;
}

export function renderColumnChange(tableName: string, change: ColumnChange): readonly string[] {
  const out: string[] = [];
  const col = quoteIdent(change.name);
  const tbl = quoteIdent(tableName);
  if (change.nullabilityChanged) {
    const op = change.nullabilityChanged.to ? "SET NOT NULL" : "DROP NOT NULL";
    out.push(`ALTER TABLE ${tbl} ALTER COLUMN ${col} ${op};`);
  }
  if (change.defaultChanged) {
    if (change.defaultChanged.to !== undefined) {
      out.push(`ALTER TABLE ${tbl} ALTER COLUMN ${col} SET DEFAULT ${change.defaultChanged.to};`);
    } else {
      out.push(`ALTER TABLE ${tbl} ALTER COLUMN ${col} DROP DEFAULT;`);
    }
  }
  if (change.typeChanged) {
    const { from, to } = change.typeChanged;
    // timestamptz → date: PG's implicit ::date cast (what a bare ALTER ...
    // TYPE without USING falls back to) reads the session TimeZone, so the
    // same row migrates to a different calendar day depending on who/where
    // runs it. Anchor explicitly at UTC instead of trusting the session.
    if ((from === "timestamptz" || from === "timestamptz(3)") && to === "date") {
      out.push(
        `-- ${from} → date: explicit UTC anchor — a bare cast would use the session TimeZone (non-deterministic).`,
      );
      out.push(
        `ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE date USING (${col} AT TIME ZONE 'UTC')::date;`,
      );
    } else if (from === "date" && (to === "timestamptz" || to === "timestamptz(3)")) {
      // Same non-determinism, reversed: a bare `date → timestamptz` cast
      // interprets the calendar date at session-TimeZone midnight. Anchor
      // explicitly at UTC midnight instead.
      out.push(
        `-- date → ${to}: explicit UTC anchor — a bare cast would use the session TimeZone (non-deterministic).`,
      );
      out.push(
        `ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE ${to} USING (${col}::timestamp AT TIME ZONE 'UTC');`,
      );
    } else {
      // pg ALTER TYPE often needs a USING clause for non-implicitly-castable
      // type changes. Emitted as a reviewer comment + raw cast — the app
      // author has to confirm it's intended.
      out.push(`-- WARN: column-type-change ${from} → ${to}. Review USING-clause if needed.`);
      out.push(`ALTER TABLE ${tbl} ALTER COLUMN ${col} TYPE ${to};`);
    }
  }
  return out;
}

// Collapses whitespace so a multi-line whereSql (e.g. a two-condition
// drizzle sql`…` predicate) can't inject a newline into this `--` comment
// line and escape into the executable body of the generated migration.
export function toSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function whereSqlEqual(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return toSingleLine(a) === toSingleLine(b);
}

export function describeIndexChange(change: IndexChange): string {
  const parts: string[] = [];
  if (change.columnsChanged) {
    parts.push(
      `columns (${change.columnsChanged.from.join(", ")}) → (${change.columnsChanged.to.join(", ")})`,
    );
  }
  if (change.uniqueChanged) {
    parts.push(`unique ${change.uniqueChanged.from} → ${change.uniqueChanged.to}`);
  }
  if (change.whereSqlChanged) {
    const from =
      change.whereSqlChanged.from !== undefined
        ? toSingleLine(change.whereSqlChanged.from)
        : "<none>";
    const to =
      change.whereSqlChanged.to !== undefined ? toSingleLine(change.whereSqlChanged.to) : "<none>";
    parts.push(`where ${from} → ${to}`);
  }
  if (change.needsManualWhereChanged) {
    parts.push(
      `needs-manual-where ${change.needsManualWhereChanged.from} → ${change.needsManualWhereChanged.to}`,
    );
  }
  return parts.join("; ");
}
