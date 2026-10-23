// Migration runner: applies checked-in SQL files to a database.
// Replaces `drizzle-kit migrate` as a runtime component.
//
// **NO-MAGIC-ON-DATA core principle** (see drizzle-replacement.md):
//   - The runner reads ONLY checked-in `<dir>/*.sql` files.
//   - It does not reach back to EntityDefinition at runtime.
//   - It does not auto-apply on app boot — a deploy script or init container
//     invokes `kumiko migrate apply` as a separate step.
//   - Schema drift is detected fail-loudly through checksum mismatches.
//
// Tracking table: `_kumiko_migrations(id, applied_at, checksum)`. `id` is the
// filename without the `.sql` suffix. The checksum is the sha256 hash of the
// file content at apply time. If an already-applied file is edited, the next
// apply fails with a clear error (production databases contain the old SQL —
// editing it makes production state inconsistent with committed state).

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { DbConnection, DbRunner } from "./connection.ts";
import { applyRowLevelSecurityScope } from "./queries/rls-scope.ts";
import {
  asRawClient,
  hasBegin,
  type RawClient,
  type RawClientWithBegin,
  type ReservedClient,
} from "./query.ts";
import { SYSTEM_ROW_LEVEL_SECURITY_SCOPE } from "./row-level-security-scope.ts";

export type Migration = {
  readonly id: string; // filename without .sql
  readonly checksum: string; // sha256 hex of the file content
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

// Advisory-lock key (random 32-bit integer, stable). Prevents two Pods
// booting at the same time from both running migrate apply (the second
// blocks until the first finishes).
export const MIGRATION_ADVISORY_LOCK_KEY = 0x6b756d69; // "kumi" in ASCII

const MIGRATIONS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS "_kumiko_migrations" (
  "id" text PRIMARY KEY NOT NULL,
  "checksum" text NOT NULL,
  "applied_at" timestamptz NOT NULL DEFAULT now()
)
`.trim();

// Plain `;`-split breaks on `;` inside comments/string literals.
type SqlScanState = "normal" | "lineComment" | "blockComment" | "singleQuote" | "doubleQuote";

export function splitSqlStatements(sqlText: string): readonly string[] {
  const statements: string[] = [];
  let current = "";
  let state: SqlScanState = "normal";
  let blockCommentDepth = 0;

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
      // Postgres nests block comments — track depth so the first `*/` does
      // not leave trailing comment text in the statement.
      if (ch === "/" && next === "*") {
        blockCommentDepth++;
        i++;
        continue;
      }
      if (ch === "*" && next === "/") {
        i++;
        blockCommentDepth--;
        if (blockCommentDepth === 0) {
          state = "normal";
          // Keep a space so `a/*x*/AS` does not become `aAS`.
          current += " ";
        }
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
      blockCommentDepth = 1;
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
    if (ch === "$") {
      const opening = /^\$([A-Za-z_]\w*)?\$/.exec(sqlText.slice(i))?.[0];
      if (opening !== undefined) {
        // Body is copied verbatim: `;` and quotes inside a DO/function body belong to it.
        const closeAt = sqlText.indexOf(opening, i + opening.length);
        if (closeAt === -1) {
          throw new Error(
            `splitSqlStatements: unterminated dollar-quoted body ${opening} — migration SQL is malformed, refusing to split`,
          );
        }
        current += sqlText.slice(i, closeAt + opening.length);
        i = closeAt + opening.length - 1;
        continue;
      }
    }
    if (ch === ";") {
      statements.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (state === "blockComment" || state === "singleQuote" || state === "doubleQuote") {
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
// without a second, drifting copy of this file-discovery logic.
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

// Raw file texts in migration order, comments intact (loadMigrationsFromDir
// strips them) — the retired-table scan reads them for DESTRUCTIVE markers.
export function readMigrationSqlTexts(dir: string): readonly string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(dir, file), "utf8"));
}

// Stricter than asRawClient on purpose: a direct handle must also offer
// begin(), because runMigrations wraps every file in a transaction. Handles
// without it fall through to the drizzle wrappers and otherwise fail here,
// before any SQL runs, with the migrate-runner message.
function migrationClient(db: DbRunner): RawClientWithBegin {
  for (const candidate of [
    db,
    propertyOf(db, "$client"),
    propertyOf(propertyOf(db, "session"), "client"),
  ]) {
    if (typeof propertyOf(candidate, "unsafe") !== "function") continue;
    const client = asRawClient(candidate);
    if (hasBegin(client)) return client;
  }
  throw new Error(
    "migrate-runner: db argument has no .unsafe() and .begin() (need a Bun.SQL pool or a DbConnection)",
  );
}

// Raw-SQL via Bun.SQL .unsafe().
async function executeRaw(db: DbRunner, sqlText: string): Promise<void> {
  await migrationClient(db).unsafe(sqlText);
}

async function reserveConnection(db: DbRunner): Promise<ReservedClient> {
  const client = migrationClient(db);
  if (typeof client.reserve !== "function") {
    throw new Error("migrate-runner: db argument has no .reserve() (need a Bun.SQL pool)");
  }
  return client.reserve();
}

export async function fetchAppliedMigrations(
  db: DbConnection,
): Promise<readonly AppliedMigration[]> {
  return fetchAppliedFrom(migrationClient(db));
}

async function fetchAppliedFrom(
  client: Pick<RawClient, "unsafe">,
): Promise<readonly AppliedMigration[]> {
  const result = await client.unsafe<Record<string, unknown>>(
    `SELECT id, checksum FROM "_kumiko_migrations" ORDER BY id`,
  );
  const rows = Array.isArray(result) ? result : [];
  const applied: AppliedMigration[] = [];
  for (const row of rows) {
    const { id, checksum } = row;
    if (typeof id === "string" && typeof checksum === "string") applied.push({ id, checksum });
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

// Applies pending migrations. Idempotent: already-applied migrations are
// skipped via the _kumiko_migrations lookup. Checksum mismatches fail loudly.
// The advisory lock prevents concurrent-apply races.
export async function runMigrations(
  db: DbConnection,
  migrations: readonly Migration[],
): Promise<ApplyResult> {
  // Session-level advisory lock and per-migration BEGIN/COMMIT must share one
  // session. Pool calls may land on different connections (the pool round-robins),
  // which would leave the lock held on a session nobody unlocks.
  const conn = await reserveConnection(db);
  try {
    // Server pools cap statement_timeout; a migration (backfill, index build) must not hit it.
    await conn.unsafe("SET statement_timeout = 0");
    await conn.unsafe(MIGRATIONS_TABLE_DDL);
    await conn.unsafe(`SELECT pg_advisory_lock(${MIGRATION_ADVISORY_LOCK_KEY})`);
    try {
      const applied = new Map(
        (await fetchAppliedFrom(conn)).map((a) => [a.id, a.checksum] as const),
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
        // Applies the file content and INSERT tracking row in one transaction. If a
        // statement fails, the rollback includes the tracking row, so no partial
        // apply remains stuck in the books.
        await conn.unsafe("BEGIN");
        try {
          // Transaction-local, so the next migration's BEGIN starts clean; migrations rewrite every tenant's rows.
          await applyRowLevelSecurityScope(conn, SYSTEM_ROW_LEVEL_SECURITY_SCOPE);
          for (const stmt of m.statements) {
            await conn.unsafe(stmt);
          }
          await conn.unsafe(`INSERT INTO "_kumiko_migrations" ("id", "checksum") VALUES ($1, $2)`, [
            m.id,
            m.checksum,
          ]);
          await conn.unsafe("COMMIT");
        } catch (e) {
          // A failed ROLLBACK means the session is gone (its lock and tx with it); keep the migration error.
          await conn.unsafe("ROLLBACK").catch(() => undefined);
          throw e;
        }
        appliedIds.push(m.id);
      }

      return { applied: appliedIds, skipped: skippedIds };
    } finally {
      // A dropped session already released its lock; failing here would mask the migration error.
      await conn
        .unsafe(`SELECT pg_advisory_unlock(${MIGRATION_ADVISORY_LOCK_KEY})`)
        .catch(() => undefined);
    }
  } finally {
    // A dead connection fails RESET; the pool drops it, so the migration's own outcome wins.
    await conn.unsafe("RESET statement_timeout").catch(() => undefined);
    await conn.release();
  }
}

// Convenience: loads and runs migrations in one call. Used by the
// `kumiko migrate apply` CLI command and by test setup helpers.
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
  const client = migrationClient(db);
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
