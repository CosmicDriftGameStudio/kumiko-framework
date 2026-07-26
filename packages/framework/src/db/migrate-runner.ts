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

import type { DbConnection, DbRunner } from "./connection";

// Adapter: extract raw postgres-js client from drizzle DbConnection,
// or use Bun.sql instance directly. Either way `.unsafe()` is the
// runtime call.
function rawClient(db: DbRunner): {
  unsafe: (sql: string, params?: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
  begin: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
} {
  const dbAny = db as unknown as Record<string, unknown>;
  if (typeof dbAny["unsafe"] === "function" && typeof dbAny["begin"] === "function") {
    return dbAny as never;
  }
  const $client = dbAny["$client"];
  if ($client && typeof ($client as Record<string, unknown>)["unsafe"] === "function") {
    return $client as never;
  }
  const session = dbAny["session"] as Record<string, unknown> | undefined;
  const sessionClient = session?.["client"];
  if (sessionClient && typeof (sessionClient as Record<string, unknown>)["unsafe"] === "function") {
    return sessionClient as never;
  }
  throw new Error(
    "migrate-runner: db argument has no .unsafe() (need Bun.SQL or drizzle DbConnection)",
  );
}

export type Migration = {
  readonly id: string; // filename ohne .sql
  readonly checksum: string; // sha256-hex vom File-Content
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

// Plain `;`-split breaks on `;` inside comments/string literals (#1542).
type SqlScanState = "normal" | "lineComment" | "blockComment" | "singleQuote" | "doubleQuote";

export function splitSqlStatements(sqlText: string): readonly string[] {
  const statements: string[] = [];
  let current = "";
  let state: SqlScanState = "normal";

  for (let i = 0; i < sqlText.length; i++) {
    const ch = sqlText.charAt(i);
    const next = sqlText.charAt(i + 1);

    if (state === "lineComment") {
      if (ch === "\n") {
        state = "normal";
        current += ch;
      }
      continue;
    }
    if (state === "blockComment") {
      if (ch === "*" && next === "/") {
        state = "normal";
        i++;
        // Keep a space so `a/*x*/AS` does not become `aAS`.
        current += " ";
      }
      continue;
    }
    if (state === "singleQuote") {
      current += ch;
      if (ch === "'") {
        if (next === "'") {
          current += next;
          i++;
        } else {
          state = "normal";
        }
      }
      continue;
    }
    if (state === "doubleQuote") {
      current += ch;
      if (ch === '"') {
        if (next === '"') {
          current += next;
          i++;
        } else {
          state = "normal";
        }
      }
      continue;
    }

    // state === "normal"
    if (ch === "-" && next === "-") {
      state = "lineComment";
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      state = "blockComment";
      i++;
      continue;
    }
    if (ch === "'") {
      state = "singleQuote";
      current += ch;
      continue;
    }
    if (ch === '"') {
      state = "doubleQuote";
      current += ch;
      continue;
    }
    if (ch === ";") {
      statements.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (state === "blockComment" || state === "singleQuote" || state === "doubleQuote") {
    // Does not track dollar-quoted (`$$...$$`) bodies — none of this repo's
    // migrations use them; add that state if one ever does.
    throw new Error(
      `splitSqlStatements: unterminated ${state} — migration SQL is malformed, refusing to split`,
    );
  }
  statements.push(current);

  return statements
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => `${s};`);
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// Reads <dir>/*.sql, sorted lexically (e.g. 0001_init.sql, 0002_add_locale.sql),
// returns Migration[] with id + checksum + statements. `preprocess` is an
// optional hook applied to each file's raw content before splitting/hashing
// — used by replayMigrationsDir to expand its DESTRUCTIVE-marker comments
// without a second, drifting copy of this file-discovery logic (#1522/9).
export function loadMigrationsFromDir(
  dir: string,
  preprocess?: (sql: string) => string,
): readonly Migration[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.map((file) => {
    const raw = readFileSync(join(dir, file), "utf8");
    const content = preprocess ? preprocess(raw) : raw;
    return {
      id: file.replace(/\.sql$/, ""),
      checksum: sha256Hex(content),
      statements: splitSqlStatements(content),
    };
  });
}

// Raw-SQL via postgres-js or Bun.sql .unsafe() — same shape for both.
async function executeRaw(db: DbRunner, sqlText: string): Promise<void> {
  await rawClient(db).unsafe(sqlText);
}

export async function fetchAppliedMigrations(
  db: DbConnection,
): Promise<readonly AppliedMigration[]> {
  const result = await rawClient(db).unsafe(
    `SELECT id, checksum FROM "_kumiko_migrations" ORDER BY id`,
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
  constructor(
    public readonly migrationId: string,
    public readonly expected: string,
    public readonly actual: string,
  ) {
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
      const client = rawClient(db);
      await client.begin(async (tx) => {
        const txClient = tx as { unsafe: (s: string, p?: readonly unknown[]) => Promise<unknown> };
        for (const stmt of m.statements) {
          await txClient.unsafe(stmt);
        }
        await txClient.unsafe(
          `INSERT INTO "_kumiko_migrations" ("id", "checksum") VALUES ($1, $2)`,
          [m.id, m.checksum],
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
export async function runMigrationsFromDir(db: DbConnection, dir: string): Promise<ApplyResult> {
  const migrations = loadMigrationsFromDir(dir);
  return runMigrations(db, migrations);
}

export type BaselineResult = {
  readonly marked: readonly string[];
  readonly alreadyTracked: readonly string[];
};

// Marks migrations as applied in `_kumiko_migrations` WITHOUT executing their
// SQL. For adopting an existing DB whose tables already exist — e.g. the
// cutover from the legacy drizzle-kit system, where re-running 0001_init would
// hit CREATE-TABLE conflicts. Idempotent: already-tracked ids are left as-is.
export async function baselineMigrations(
  db: DbConnection,
  migrations: readonly Migration[],
): Promise<BaselineResult> {
  await executeRaw(db, MIGRATIONS_TABLE_DDL);
  const applied = new Set((await fetchAppliedMigrations(db)).map((a) => a.id));
  const marked: string[] = [];
  const alreadyTracked: string[] = [];
  const client = rawClient(db);
  for (const m of migrations) {
    if (applied.has(m.id)) {
      alreadyTracked.push(m.id);
      continue;
    }
    await client.unsafe(
      `INSERT INTO "_kumiko_migrations" ("id", "checksum") VALUES ($1, $2) ON CONFLICT ("id") DO NOTHING`,
      [m.id, m.checksum],
    );
    marked.push(m.id);
  }
  return { marked, alreadyTracked };
}
