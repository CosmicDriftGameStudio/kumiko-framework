import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EntityTableMeta } from "../entity-table-meta";
import { snapshotFromMetas } from "../migrate-generator";
import { diffReplayAgainstSnapshot, replayMigrationsDir } from "../replay-migration-sql";

function tmpMigrationsDir(): string {
  return mkdtempSync(join(tmpdir(), "replay-migration-sql-"));
}

function write(dir: string, filename: string, sql: string): void {
  writeFileSync(join(dir, filename), sql);
}

function meta(tableName: string, columns: EntityTableMeta["columns"]): EntityTableMeta {
  return { tableName, source: "managed", indexes: [], columns };
}

describe("replayMigrationsDir", () => {
  test("reconstructs table+column shape from CREATE TABLE", () => {
    const dir = tmpMigrationsDir();
    try {
      write(
        dir,
        "0001_init.sql",
        `CREATE TABLE IF NOT EXISTS "read_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "stripe_customer_id" text
);
CREATE INDEX IF NOT EXISTS "read_accounts_tenant_id_idx" ON "read_accounts" ("tenant_id");`,
      );
      const replayed = replayMigrationsDir(dir);
      expect([...replayed.keys()]).toEqual(["read_accounts"]);
      expect([...(replayed.get("read_accounts")?.columns ?? [])].sort()).toEqual([
        "id",
        "stripe_customer_id",
        "tenant_id",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ADD COLUMN extends an already-created table across files", () => {
    const dir = tmpMigrationsDir();
    try {
      write(dir, "0001_init.sql", `CREATE TABLE IF NOT EXISTS "read_a" ("id" uuid PRIMARY KEY);`);
      write(dir, "0002_add-col.sql", `ALTER TABLE "read_a" ADD COLUMN "title" text;`);
      const replayed = replayMigrationsDir(dir);
      expect([...(replayed.get("read_a")?.columns ?? [])].sort()).toEqual(["id", "title"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Hand-edited migrations legitimately add "IF NOT EXISTS"/"IF EXISTS" to
  // ADD/DROP COLUMN (the generator itself never emits it, but app authors
  // are explicitly allowed to hand-edit before committing — see the header
  // comment every generated migration carries).
  test("ADD COLUMN IF NOT EXISTS (hand-edited) still extends the table", () => {
    const dir = tmpMigrationsDir();
    try {
      write(dir, "0001_init.sql", `CREATE TABLE IF NOT EXISTS "read_a" ("id" uuid PRIMARY KEY);`);
      write(dir, "0002_add-col.sql", `ALTER TABLE "read_a" ADD COLUMN IF NOT EXISTS "title" text;`);
      const replayed = replayMigrationsDir(dir);
      expect([...(replayed.get("read_a")?.columns ?? [])].sort()).toEqual(["id", "title"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Regression: publicstatus#0007_fix-secrets-table-columns adds three
  // columns in ONE statement (comma-separated ADD COLUMN clauses) — the
  // replay used to only pick up the first, reporting "metadata" and
  // "last_rotated_at" as missing even though the migration creates them.
  test("multiple ADD COLUMN clauses in a single ALTER TABLE statement all extend the table", () => {
    const dir = tmpMigrationsDir();
    try {
      write(dir, "0001_init.sql", `CREATE TABLE IF NOT EXISTS "read_a" ("id" uuid PRIMARY KEY);`);
      write(
        dir,
        "0002_add-cols.sql",
        `ALTER TABLE "read_a"
  ADD COLUMN IF NOT EXISTS "envelope" jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  ADD COLUMN IF NOT EXISTS "last_rotated_at" timestamp with time zone DEFAULT now() NOT NULL;`,
      );
      const replayed = replayMigrationsDir(dir);
      expect([...(replayed.get("read_a")?.columns ?? [])].sort()).toEqual([
        "envelope",
        "id",
        "last_rotated_at",
        "metadata",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("mixed ADD + DROP COLUMN clauses in one statement apply in order", () => {
    const dir = tmpMigrationsDir();
    try {
      write(
        dir,
        "0001_init.sql",
        `CREATE TABLE IF NOT EXISTS "read_a" ("id" uuid PRIMARY KEY, "legacy" text);`,
      );
      write(
        dir,
        "0002_migrate-cols.sql",
        `ALTER TABLE "read_a" DROP COLUMN IF EXISTS "legacy", ADD COLUMN IF NOT EXISTS "title" text;`,
      );
      const replayed = replayMigrationsDir(dir);
      expect([...(replayed.get("read_a")?.columns ?? [])].sort()).toEqual(["id", "title"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("DROP COLUMN IF EXISTS (hand-edited) still removes the column", () => {
    const dir = tmpMigrationsDir();
    try {
      write(
        dir,
        "0001_init.sql",
        `CREATE TABLE IF NOT EXISTS "read_a" ("id" uuid PRIMARY KEY, "title" text);`,
      );
      write(dir, "0002_drop-col.sql", `ALTER TABLE "read_a" DROP COLUMN IF EXISTS "title";`);
      const replayed = replayMigrationsDir(dir);
      expect([...(replayed.get("read_a")?.columns ?? [])]).toEqual(["id"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("commented-out destructive DROP TABLE is not replayed", () => {
    const dir = tmpMigrationsDir();
    try {
      write(dir, "0001_init.sql", `CREATE TABLE IF NOT EXISTS "read_a" ("id" uuid PRIMARY KEY);`);
      write(
        dir,
        "0002_drop.sql",
        `-- DESTRUCTIVE: DROP TABLE IF EXISTS "read_a";  -- uncomment + ensure backup`,
      );
      const replayed = replayMigrationsDir(dir);
      expect([...replayed.keys()]).toEqual(["read_a"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("diffReplayAgainstSnapshot", () => {
  test("clean: replayed schema matches snapshot exactly", () => {
    const dir = tmpMigrationsDir();
    try {
      write(
        dir,
        "0001_init.sql",
        `CREATE TABLE IF NOT EXISTS "read_a" ("id" uuid PRIMARY KEY, "title" text);`,
      );
      const snapshot = snapshotFromMetas([
        meta("read_a", [
          { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
          { name: "title", pgType: "text", notNull: false },
        ]),
      ]);
      const mismatches = diffReplayAgainstSnapshot(replayMigrationsDir(dir), snapshot);
      expect(mismatches).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Reproduces the kumiko-studio 0016 incident: the snapshot correctly
  // records store_api_tokens, but the migration file that's supposed to
  // create it is an accidental copy of an earlier file (creates read_accounts
  // again instead) — CI must fail loud instead of shipping a table that only
  // ever exists on paper.
  test("misgenerated migration: snapshot expects a table no file actually creates", () => {
    const dir = tmpMigrationsDir();
    try {
      write(
        dir,
        "0001_account-entity.sql",
        `CREATE TABLE IF NOT EXISTS "read_accounts" ("id" uuid PRIMARY KEY, "stripe_customer_id" text);`,
      );
      write(
        dir,
        "0002_add-personal-access-tokens.sql",
        // bug: this should create store_api_tokens, but it's a copy of 0001
        `CREATE TABLE IF NOT EXISTS "read_accounts" ("id" uuid PRIMARY KEY, "stripe_customer_id" text);`,
      );
      const snapshot = snapshotFromMetas([
        meta("read_accounts", [
          { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
          { name: "stripe_customer_id", pgType: "text", notNull: false },
        ]),
        meta("store_api_tokens", [
          { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
          { name: "token_hash", pgType: "text", notNull: true },
        ]),
      ]);
      const mismatches = diffReplayAgainstSnapshot(replayMigrationsDir(dir), snapshot);
      expect(mismatches).toEqual([
        {
          tableName: "store_api_tokens",
          kind: "missing-table",
          detail: 'snapshot expects "store_api_tokens" but no migration file creates it',
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("column drift: migration creates a table with the wrong columns", () => {
    const dir = tmpMigrationsDir();
    try {
      write(dir, "0001_init.sql", `CREATE TABLE IF NOT EXISTS "read_a" ("id" uuid PRIMARY KEY);`);
      const snapshot = snapshotFromMetas([
        meta("read_a", [
          { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
          { name: "title", pgType: "text", notNull: false },
        ]),
      ]);
      const mismatches = diffReplayAgainstSnapshot(replayMigrationsDir(dir), snapshot);
      expect(mismatches).toEqual([
        { tableName: "read_a", kind: "column-drift", detail: "missing columns: title" },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("unexpected table: migrations create a table the snapshot doesn't know about", () => {
    const dir = tmpMigrationsDir();
    try {
      write(dir, "0001_init.sql", `CREATE TABLE IF NOT EXISTS "orphan" ("id" uuid PRIMARY KEY);`);
      const mismatches = diffReplayAgainstSnapshot(replayMigrationsDir(dir), snapshotFromMetas([]));
      expect(mismatches).toEqual([
        {
          tableName: "orphan",
          kind: "unexpected-table",
          detail: 'migrations create "orphan" but .snapshot.json has no entry for it',
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
