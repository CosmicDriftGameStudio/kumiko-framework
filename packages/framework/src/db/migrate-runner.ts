// Migrate-Runner: applied checked-in SQL-Files gegen eine DB.
// Ersatz für `drizzle-kit migrate` als Runtime-Komponente.
//
// **NO-MAGIC-ON-DATA Kernprinzip** (siehe drizzle-replacement.md):
//   - Runner liest NUR checked-in `<dir>/*.sql` Files
//   - Kein Reach-back zu EntityDefinition zur Runtime
//   - Kein Auto-Apply-on-App-Boot — Deploy-Skript oder Init-Container ruft
//     `kumiko migrate apply` als eigenen Schritt
//   - Schema-Drift wird durch Checksum-Mismatch fail-loud detektiert
//
// Tracking-Table `_kumiko_migrations(id, applied_at, checksum)`. id = filename
// ohne .sql-Endung. Checksum = sha256 vom File-Content beim Apply. Wenn ein
// schon-appliedes File nachträglich editiert wird, schlägt der nächste Apply
// fehl mit klarer Fehlermeldung (production-DBs haben das alte SQL drin —
// edit nachträglich = production-state inkonsistent mit committed-state).

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";
import type { DbConnection, DbRunner } from "./connection";

export type Migration = {
  readonly id: string;          // filename ohne .sql
  readonly checksum: string;    // sha256-hex vom File-Content
  readonly statements: readonly string[];
};

export type AppliedMigration = {
  readonly id: string;
  readonly checksum: string;
};

export type ApplyResult = {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
};

// Advisory-lock key (random 32-bit int, stable). Verhindert dass zwei
// gleichzeitig bootende Pods beide migrate apply laufen lassen (zweiter
// blockiert bis erster fertig).
const ADVISORY_LOCK_KEY = 0x6b756d69; // "kumi" in ASCII

const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS "_kumiko_migrations" (
  "id" text PRIMARY KEY NOT NULL,
  "checksum" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now()
)
`.trim();

// Splittet SQL-File-Text in einzelne Statements. Pragma: simpler `;`-Split,
// reicht weil unsere generierten SQL-Files keine eingebetteten `;` in String-
// Literalen haben. App-Author der hand-editiert + tricky SQL einfügt sollte
// das wissen — sonst pg-Parser einziehen.
export function splitSqlStatements(sqlText: string): readonly string[] {
  return sqlText
    .split(";")
    .map((s) => s.replace(/--[^\n]*/g, "").trim())
    .filter((s) => s.length > 0)
    .map((s) => `${s};`);
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// Liest <dir>/*.sql, sortiert lex (z.B. 0001_init.sql, 0002_add_locale.sql),
// returnt Migration[] mit id + checksum + statements.
export function loadMigrationsFromDir(dir: string): readonly Migration[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((file) => {
    const content = readFileSync(join(dir, file), "utf8");
    return {
      id: file.replace(/\.sql$/, ""),
      checksum: sha256Hex(content),
      statements: splitSqlStatements(content),
    };
  });
}

// Drizzle's db.execute(sql.raw(...)) ist die portable API für raw SQL —
// funktioniert sowohl auf DbConnection als auch auf DbTx (transaction-handle).
// Phase 4: wenn Drizzle wegfällt, hier auf Bun.sql.unsafe() umstellen.
async function executeRaw(db: DbRunner, sqlText: string): Promise<void> {
  await db.execute(sql.raw(sqlText));
}

async function fetchAppliedMigrations(db: DbConnection): Promise<readonly AppliedMigration[]> {
  const result = await db.execute(
    sql.raw(`SELECT id, checksum FROM "_kumiko_migrations" ORDER BY id`),
  );
  const rows = Array.isArray(result) ? result : [];
  const applied: AppliedMigration[] = [];
  for (const row of rows) {
    if (
      typeof row === "object" &&
      row !== null &&
      typeof (row as { id?: unknown }).id === "string" &&
      typeof (row as { checksum?: unknown }).checksum === "string"
    ) {
      applied.push({
        id: (row as { id: string }).id,
        checksum: (row as { checksum: string }).checksum,
      });
    }
  }
  return applied;
}

export class MigrationChecksumMismatchError extends Error {
  constructor(public readonly migrationId: string, public readonly expected: string, public readonly actual: string) {
    super(
      `Migration "${migrationId}" was edited after being applied. ` +
        `DB has checksum ${expected.slice(0, 12)}…, file has ${actual.slice(0, 12)}…. ` +
        `Production-DBs already ran the original SQL — editing applied migrations ` +
        `causes schema-drift. Write a NEW migration file instead (NNNN+1_<change>.sql).`,
    );
    this.name = "MigrationChecksumMismatchError";
  }
}

// Apply pending migrations. Idempotent: schon applied migrations werden via
// _kumiko_migrations-Lookup übersprungen. Checksum-Mismatch wirft fail-loud.
// Advisory-Lock verhindert concurrent-apply-races.
export async function runMigrations(
  db: DbConnection,
  migrations: readonly Migration[],
): Promise<ApplyResult> {
  await executeRaw(db, MIGRATIONS_TABLE_DDL);
  await executeRaw(db, `SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`);
  try {
    const applied = new Map(
      (await fetchAppliedMigrations(db)).map((a) => [a.id, a.checksum] as const),
    );

    const appliedIds: string[] = [];
    const skippedIds: string[] = [];

    for (const m of migrations) {
      const prevChecksum = applied.get(m.id);
      if (prevChecksum !== undefined) {
        if (prevChecksum !== m.checksum) {
          throw new MigrationChecksumMismatchError(m.id, prevChecksum, m.checksum);
        }
        skippedIds.push(m.id);
        continue;
      }
      // Apply file content + INSERT tracking-row in einer TX. Wenn ein
      // Statement bricht, Rollback inkl. Tracking-Row → kein partial-apply
      // stuck in den books.
      await db.transaction(async (tx) => {
        for (const stmt of m.statements) {
          await executeRaw(tx, stmt);
        }
        await tx.execute(
          sql`INSERT INTO "_kumiko_migrations" ("id", "checksum") VALUES (${m.id}, ${m.checksum})`,
        );
      });
      appliedIds.push(m.id);
    }

    return { applied: appliedIds, skipped: skippedIds };
  } finally {
    await executeRaw(db, `SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
  }
}

// Convenience: load + run in einem Call. Wird vom `kumiko migrate apply`
// CLI-Command + von Test-Setup-Helfern verwendet.
export async function runMigrationsFromDir(
  db: DbConnection,
  dir: string,
): Promise<ApplyResult> {
  const migrations = loadMigrationsFromDir(dir);
  return runMigrations(db, migrations);
}
