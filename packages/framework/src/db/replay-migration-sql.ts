// Build-time, DB-free replay: reads the checked-in `kumiko/migrations/*.sql`
// files in sequence order and reconstructs the table/column shape they
// actually produce — then that gets diffed against `.snapshot.json`.
//
// Catches the class of bug where a migration file's *content* silently
// drifts from what its filename/snapshot-entry claims (e.g. a copy-paste
// from an earlier migration): `kumiko schema validate`'s other checks only
// compare ENTITY_METAS ↔ snapshot, never the committed SQL bytes against
// either. Reuses `loadMigrationsFromDir`'s statement-splitting so the replay
// sees exactly what the real runner would execute.

import type { Snapshot } from "./migrate-generator";
import { loadMigrationsFromDir } from "./migrate-runner";

export type ReplayedTable = {
  readonly columns: ReadonlySet<string>;
};

export type ReplayedSchema = ReadonlyMap<string, ReplayedTable>;

// Splits a parenthesized column-list body on top-level commas — depth-aware
// so commas inside `numeric(10,2)` or `DEFAULT gen_random_uuid()` don't
// fracture a column definition.
function splitTopLevel(body: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) parts.push(current);
  return parts;
}

function parseColumnNames(body: string): Set<string> {
  const columns = new Set<string>();
  for (const part of splitTopLevel(body)) {
    const trimmed = part.trim();
    if (/^CONSTRAINT\b/i.test(trimmed)) continue; // composite-PK line, not a column
    const match = trimmed.match(/^"([^"]+)"/);
    if (match?.[1] !== undefined) columns.add(match[1]);
  }
  return columns;
}

function applyStatement(schema: Map<string, { columns: Set<string> }>, statement: string): void {
  const create = statement.match(
    /^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"([^"]+)"\s*\(([\s\S]*)\);?\s*$/i,
  );
  const createTableName = create?.[1];
  const createBody = create?.[2];

  const addColumn = statement.match(/^ALTER TABLE\s+"([^"]+)"\s+ADD COLUMN\s+"([^"]+)"/i);
  const addColumnTable = addColumn?.[1];
  const addColumnName = addColumn?.[2];

  const dropTable = statement.match(/^DROP TABLE\s+(?:IF EXISTS\s+)?"([^"]+)"/i);
  const dropTableName = dropTable?.[1];

  const dropColumn = statement.match(/^ALTER TABLE\s+"([^"]+)"\s+DROP COLUMN\s+"([^"]+)"/i);
  const dropColumnTable = dropColumn?.[1];
  const dropColumnName = dropColumn?.[2];

  if (createTableName !== undefined && createBody !== undefined) {
    schema.set(createTableName, { columns: parseColumnNames(createBody) });
  } else if (addColumnTable !== undefined && addColumnName !== undefined) {
    const table = schema.get(addColumnTable);
    if (table) table.columns.add(addColumnName);
    else schema.set(addColumnTable, { columns: new Set([addColumnName]) });
  } else if (dropTableName !== undefined) {
    schema.delete(dropTableName);
  } else if (dropColumnTable !== undefined && dropColumnName !== undefined) {
    schema.get(dropColumnTable)?.columns.delete(dropColumnName);
  }
  // else: CREATE INDEX, ALTER COLUMN (TYPE/DEFAULT/NOT NULL) and everything
  // else don't change the table/column shape this replay tracks.
}

// Reads `<migrationsDir>/*.sql` in sequence order and replays every
// CREATE/ALTER/DROP TABLE statement to reconstruct the resulting schema.
export function replayMigrationsDir(migrationsDir: string): ReplayedSchema {
  const schema = new Map<string, { columns: Set<string> }>();
  for (const migration of loadMigrationsFromDir(migrationsDir)) {
    for (const statement of migration.statements) applyStatement(schema, statement);
  }
  return schema;
}

export type ReplayMismatch = {
  readonly tableName: string;
  readonly kind: "missing-table" | "unexpected-table" | "column-drift";
  readonly detail: string;
};

// Compares what the migration files actually produce (`replayed`) against
// what `.snapshot.json` claims (`snapshot`) — the check that would have
// caught kumiko-studio's 0016 misgeneration (snapshot correct, SQL wrong).
export function diffReplayAgainstSnapshot(
  replayed: ReplayedSchema,
  snapshot: Snapshot,
): readonly ReplayMismatch[] {
  const mismatches: ReplayMismatch[] = [];
  const snapshotTableNames = new Set(snapshot.tables.map((t) => t.tableName));

  for (const meta of snapshot.tables) {
    const table = replayed.get(meta.tableName);
    if (!table) {
      mismatches.push({
        tableName: meta.tableName,
        kind: "missing-table",
        detail: `snapshot expects "${meta.tableName}" but no migration file creates it`,
      });
      continue;
    }
    const expected = new Set(meta.columns.map((c) => c.name));
    const missing = [...expected].filter((c) => !table.columns.has(c));
    const extra = [...table.columns].filter((c) => !expected.has(c));
    if (missing.length > 0 || extra.length > 0) {
      const parts: string[] = [];
      if (missing.length > 0) parts.push(`missing columns: ${missing.join(", ")}`);
      if (extra.length > 0) parts.push(`unexpected columns: ${extra.join(", ")}`);
      mismatches.push({
        tableName: meta.tableName,
        kind: "column-drift",
        detail: parts.join("; "),
      });
    }
  }

  for (const tableName of replayed.keys()) {
    if (!snapshotTableNames.has(tableName)) {
      mismatches.push({
        tableName,
        kind: "unexpected-table",
        detail: `migrations create "${tableName}" but .snapshot.json has no entry for it`,
      });
    }
  }

  return mismatches;
}
