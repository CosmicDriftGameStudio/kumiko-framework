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

// Migration files comment out destructive ops (DROP TABLE/COLUMN) as
// `-- DESTRUCTIVE: <stmt>;  -- uncomment + ensure backup` so the real
// migrate-runner never executes them unattended. For replay purposes the
// snapshot represents the INTENDED end state, so a commented-out drop must
// still count as applied here — otherwise a table/column the snapshot
// already omits shows up as "unexpected" forever. splitSqlStatements (the
// real runner's splitter) strips `--`-comments outright, which would erase
// these markers before they ever reach applyStatement.
const DESTRUCTIVE_MARKER = /^--\s*DESTRUCTIVE:\s*(.+?;)/i;

function expandDestructiveMarkers(sqlText: string): string {
  return sqlText
    .split("\n")
    .map((line) => DESTRUCTIVE_MARKER.exec(line.trim())?.[1] ?? line)
    .join("\n");
}

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

// Identifiers in hand-written migrations aren't always quoted (the generator
// always quotes, but the header explicitly invites hand-editing) — optional
// quotes so `CREATE TABLE foo (...)` parses the same as `CREATE TABLE "foo" (...)`.
const IDENT = `"?([^"\\s(;,.]+)"?`;

function parseColumnNames(body: string): Set<string> {
  const columns = new Set<string>();
  for (const part of splitTopLevel(body)) {
    const trimmed = part.trim();
    if (/^(CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE|LIKE)\b/i.test(trimmed)) continue; // table-constraint or LIKE clause, not a column
    const match = trimmed.match(new RegExp(`^${IDENT}`));
    if (match?.[1] !== undefined) columns.add(match[1]);
  }
  return columns;
}

// Clauses that can appear inside an ALTER TABLE body which do NOT change the
// table/column shape this replay tracks (presence only, not types/
// constraints/RLS/ownership) — recognized explicitly so they don't fall
// through to the fail-loud check as "unparsed". Deliberately does NOT
// include RENAME TO / RENAME COLUMN: those DO change identity in a way this
// replay can't track, so they must keep failing loud.
const SHAPE_NEUTRAL_ALTER_CLAUSE_RE = new RegExp(
  [
    `ALTER COLUMN\\s+${IDENT}\\s+TYPE\\b`, // #1085 int/bigint-catchup fixes
    `ALTER COLUMN\\s+${IDENT}\\s+(SET|DROP)\\s+NOT NULL\\b`,
    `ALTER COLUMN\\s+${IDENT}\\s+(SET DEFAULT\\b|DROP DEFAULT\\b)`,
    `(ADD|DROP)\\s+CONSTRAINT\\s+${IDENT}`,
    `\\b(ENABLE|DISABLE)\\s+ROW LEVEL SECURITY\\b`,
    `^OWNER TO\\b`,
  ].join("|"),
  "gi",
);

function applyStatement(
  schema: Map<string, { columns: Set<string> }>,
  statement: string,
  context: { readonly file: string },
): void {
  const create = statement.match(
    new RegExp(`^CREATE TABLE\\s+(IF NOT EXISTS\\s+)?${IDENT}\\s*\\(([\\s\\S]*)\\);?\\s*$`, "i"),
  );
  if (create?.[2] !== undefined && create[3] !== undefined) {
    const hasIfNotExists = create[1] !== undefined;
    // A real Postgres CREATE TABLE IF NOT EXISTS is a no-op when the table
    // already exists — treating it as an overwrite here loses any columns
    // an earlier ALTER TABLE added in between (0001 CREATE, 0002 ALTER ADD
    // COLUMN, 0003 an accidental copy-paste of 0001) and reports a false
    // column-drift for exactly the copy-paste bug this replay exists to
    // catch. A bare CREATE TABLE (no IF NOT EXISTS) still overwrites — the
    // explicit recreate path (migrate-generator.ts) always DROPs first, so
    // reaching a second CREATE for the same name there is itself already
    // the bug the replay should surface via the resulting drift.
    if (!(hasIfNotExists && schema.has(create[2]))) {
      schema.set(create[2], { columns: parseColumnNames(create[3]) });
    }
    // skip: CREATE TABLE fully handled above, no other clause can also match
    return;
  }

  const dropTable = statement.match(new RegExp(`^DROP TABLE\\s+(?:IF EXISTS\\s+)?${IDENT}`, "i"));
  if (dropTable?.[1] !== undefined) {
    schema.delete(dropTable[1]);
    // skip: DROP TABLE fully handled above, no other clause can also match
    return;
  }

  // A single ALTER TABLE statement can carry multiple comma-separated
  // ADD/DROP COLUMN clauses (e.g. migration 0007_fix-secrets-table-columns'
  // three-column fix in one statement) — matchAll over the whole body
  // instead of matching only the first clause, in statement order so an
  // add-then-drop of the same column (unusual, but not impossible) resolves
  // correctly.
  const alterTable = statement.match(
    new RegExp(`^ALTER TABLE\\s+${IDENT}\\s+([\\s\\S]*?);?\\s*$`, "i"),
  );
  const alterTableName = alterTable?.[1];
  const alterBody = alterTable?.[2];
  if (alterTableName !== undefined && alterBody !== undefined) {
    const table = schema.get(alterTableName) ?? { columns: new Set<string>() };
    schema.set(alterTableName, table);
    const clauseRe = new RegExp(
      `(ADD|DROP)\\s+COLUMN\\s+(?:IF (?:NOT )?EXISTS\\s+)?${IDENT}`,
      "gi",
    );
    let matchedAClause = false;
    for (const [, verb, name] of alterBody.matchAll(clauseRe)) {
      if (verb === undefined || name === undefined) continue;
      matchedAClause = true;
      if (verb.toUpperCase() === "ADD") table.columns.add(name);
      else table.columns.delete(name);
    }
    // Shape-neutral clauses (ALTER COLUMN TYPE, SET/DROP NOT NULL, SET/DROP
    // DEFAULT, ADD/DROP CONSTRAINT, ENABLE/DISABLE ROW LEVEL SECURITY, OWNER
    // TO) — none add/remove/rename a column, so this replay (which only
    // tracks column presence) correctly has nothing to do for them.
    if (alterBody.match(SHAPE_NEUTRAL_ALTER_CLAUSE_RE)) matchedAClause = true;
    // An ALTER TABLE that matched the outer "ALTER TABLE <name> <body>" shape
    // but whose body contains no recognized clause (e.g. RENAME TO/RENAME
    // COLUMN, which DO change identity) would otherwise silently no-op here
    // — fall through to the fail-loud check below instead of returning, so
    // it's reported rather than vanishing.
    // skip: at least one recognized clause matched — this ALTER TABLE is
    // fully handled, nothing left to do.
    if (matchedAClause) return;
  }
  // else: CREATE INDEX and everything else don't change the table/column
  // shape this replay tracks — but a statement that clearly INTENDED to
  // touch a table's shape (starts with CREATE/ALTER/DROP TABLE) and matched
  // none of the recognized patterns above must fail loud, not vanish
  // silently. Concretely this is RENAME TO / RENAME COLUMN (identity change
  // this replay can't track) or genuinely unparsed hand-written DDL — either
  // way a misleading missing-table/column-drift report is worse than
  // pointing at the actual unparsed statement.
  if (/^(CREATE|ALTER|DROP)\s+TABLE\b/i.test(statement)) {
    const prefix = statement.slice(0, 200).replace(/\s+/g, " ").trim();
    throw new Error(
      `replayMigrationsDir: unparsed table-DDL statement in ${context.file} — ` +
        `starts with CREATE/ALTER/DROP TABLE but matched none of the replay's ` +
        `recognized patterns (CREATE TABLE, DROP TABLE, ALTER TABLE ADD/DROP ` +
        `COLUMN, ALTER COLUMN ... TYPE, SET/DROP NOT NULL, SET/DROP DEFAULT, ` +
        `ADD/DROP CONSTRAINT, ENABLE/DISABLE ROW LEVEL SECURITY, OWNER TO — ` +
        `optionally-quoted identifiers). Likely RENAME TO/RENAME COLUMN (real ` +
        `identity change, not trackable here) or genuinely unparsed hand-written ` +
        `DDL. Statement: ${prefix}${statement.length > 200 ? "…" : ""}`,
    );
  }
}

// Reads `<migrationsDir>/*.sql` in sequence order and replays every
// CREATE/ALTER/DROP TABLE statement to reconstruct the resulting schema.
// Reuses the real runner's file-discovery + statement-splitting
// (loadMigrationsFromDir) instead of a second copy, so any future change to
// sub-directory handling, numeric sort order, or the .sql filter can't
// silently drift between the runner and this replay (#1522/9).
export function replayMigrationsDir(migrationsDir: string): ReplayedSchema {
  const schema = new Map<string, { columns: Set<string> }>();
  const migrations = loadMigrationsFromDir(migrationsDir, expandDestructiveMarkers);
  for (const migration of migrations) {
    for (const statement of migration.statements) {
      applyStatement(schema, statement, { file: migration.id });
    }
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
