import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EntityTableMeta } from "../entity-table-meta.ts";
import { snapshotFromMetas } from "../migrate-generator.ts";
import { diffReplayAgainstSnapshot, replayMigrationsDir } from "../replay-migration-sql.ts";

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

  // The real migrate-runner never executes a DESTRUCTIVE marker (it's a
  // commented-out suggestion an operator uncomments deliberately) — but the
  // snapshot already reflects the post-drop state as the intended end state,
  // so replay must count the marker as applied or "unexpected-table"/
  // "unexpected columns" fires forever against a table the snapshot
  // correctly omits.
  // CREATE TABLE IF NOT EXISTS is a no-op in real Postgres when
  // the table already exists — treating it as an overwrite here silently
  // discards whatever an in-between ALTER TABLE added, exactly the
  // copy-paste-migration class this replay exists to catch.
  test("CREATE TABLE IF NOT EXISTS for an already-created table is a no-op, not an overwrite", () => {
    const dir = tmpMigrationsDir();
    try {
      write(dir, "0001_init.sql", `CREATE TABLE IF NOT EXISTS "read_a" ("id" uuid PRIMARY KEY);`);
      write(dir, "0002_add-col.sql", `ALTER TABLE "read_a" ADD COLUMN "title" text;`);
      // Accidental copy-paste of 0001 — same CREATE TABLE IF NOT EXISTS text.
      write(
        dir,
        "0003_copy-paste.sql",
        `CREATE TABLE IF NOT EXISTS "read_a" ("id" uuid PRIMARY KEY);`,
      );
      const replayed = replayMigrationsDir(dir);
      expect([...(replayed.get("read_a")?.columns ?? [])].sort()).toEqual(["id", "title"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("commented-out destructive DROP TABLE is replayed as applied", () => {
    const dir = tmpMigrationsDir();
    try {
      write(dir, "0001_init.sql", `CREATE TABLE IF NOT EXISTS "read_a" ("id" uuid PRIMARY KEY);`);
      write(
        dir,
        "0002_drop.sql",
        `-- DESTRUCTIVE: DROP TABLE IF EXISTS "read_a";  -- uncomment + ensure backup`,
      );
      const replayed = replayMigrationsDir(dir);
      expect([...replayed.keys()]).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("commented-out destructive DROP COLUMN is replayed as applied", () => {
    const dir = tmpMigrationsDir();
    try {
      write(
        dir,
        "0001_init.sql",
        `CREATE TABLE IF NOT EXISTS "read_a" ("id" uuid PRIMARY KEY, "legacy" text);`,
      );
      write(
        dir,
        "0002_drop-col.sql",
        `-- DESTRUCTIVE: ALTER TABLE "read_a" DROP COLUMN "legacy";  -- uncomment + ensure backup`,
      );
      const replayed = replayMigrationsDir(dir);
      expect([...(replayed.get("read_a")?.columns ?? [])]).toEqual(["id"]);
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

  test("kumiko-framework#1473: an unparsed ALTER TABLE statement fails loud instead of vanishing", () => {
    const dir = tmpMigrationsDir();
    try {
      write(
        dir,
        "0001_init.sql",
        `CREATE TABLE IF NOT EXISTS "widgets" ("id" uuid PRIMARY KEY);
ALTER TABLE "widgets" SET SCHEMA "other";`,
      );
      expect(() => replayMigrationsDir(dir)).toThrow(/unparsed table-DDL statement/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("kumiko-framework#1535: an unquoted CREATE TABLE identifier parses instead of failing loud", () => {
    // Was "fails loud" — but real committed migrations do this
    // (publicstatus's 0014_marketing-waitlist.sql), and the old behavior
    // turned an already-graceful missing-table report into a hard abort.
    // Unquoted identifiers must parse like quoted ones.
    const dir = tmpMigrationsDir();
    try {
      write(dir, "0001_init.sql", `CREATE TABLE widgets ("id" uuid PRIMARY KEY);`);
      const replayed = replayMigrationsDir(dir);
      expect([...replayed.keys()]).toEqual(["widgets"]);
      expect([...(replayed.get("widgets")?.columns ?? [])]).toEqual(["id"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("schema-qualified CREATE TABLE (public.widgets) fails loud — IDENT rejects '.'", () => {
    const dir = tmpMigrationsDir();
    try {
      write(dir, "0001_init.sql", "CREATE TABLE public.widgets (id uuid PRIMARY KEY);\n");
      expect(() => replayMigrationsDir(dir)).toThrow(/unparsed table-DDL statement/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("kumiko-framework#1535: a bare table-level PRIMARY KEY/UNIQUE clause isn't parsed as a column", () => {
    const dir = tmpMigrationsDir();
    try {
      write(
        dir,
        "0001_init.sql",
        `CREATE TABLE widgets (id uuid, sku text, name text, UNIQUE (sku), PRIMARY KEY (id));`,
      );
      const replayed = replayMigrationsDir(dir);
      expect([...(replayed.get("widgets")?.columns ?? [])].sort()).toEqual(["id", "name", "sku"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("kumiko-framework#1535: shape-neutral ALTER COLUMN/CONSTRAINT clauses don't fail loud", () => {
    // Regression for the false-positive class: these are all real,
    // committed, shape-neutral DDL shapes (kumiko-studio's
    // 0002_file_refs_soft_delete.sql, publicstatus's
    // 0020_add-monitor-checks.sql) that must recognize
    // instead of throwing "unparsed table-DDL statement".
    const dir = tmpMigrationsDir();
    try {
      write(
        dir,
        "0001_init.sql",
        `CREATE TABLE IF NOT EXISTS "widgets" ("id" uuid PRIMARY KEY, "title" text);
ALTER TABLE "widgets" ALTER COLUMN "title" SET NOT NULL;
ALTER TABLE "widgets" ALTER COLUMN "title" SET DEFAULT 'untitled';
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_title_check" CHECK (length("title") > 0);
ALTER TABLE "widgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "widgets" OWNER TO app_user;`,
      );
      const replayed = replayMigrationsDir(dir);
      expect([...(replayed.get("widgets")?.columns ?? [])].sort()).toEqual(["id", "title"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ALTER TABLE ONLY / IF EXISTS / public. change the named table and create no phantom table", () => {
    const dir = tmpMigrationsDir();
    try {
      write(
        dir,
        "0001_init.sql",
        `CREATE TABLE IF NOT EXISTS "widgets" ("id" uuid PRIMARY KEY);
ALTER TABLE ONLY "widgets" ADD COLUMN "a" text;
ALTER TABLE IF EXISTS "widgets" ADD COLUMN "b" text;
ALTER TABLE public."widgets" ADD COLUMN "c" text;
ALTER TABLE IF EXISTS ONLY public.widgets ADD COLUMN "d" text;`,
      );
      const replayed = replayMigrationsDir(dir);
      expect([...replayed.keys()]).toEqual(["widgets"]);
      expect([...(replayed.get("widgets")?.columns ?? [])].sort()).toEqual([
        "a",
        "b",
        "c",
        "d",
        "id",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("FORCE / NO FORCE ROW LEVEL SECURITY is shape-neutral (fw#2907)", () => {
    const dir = tmpMigrationsDir();
    try {
      write(
        dir,
        "0001_init.sql",
        `CREATE TABLE IF NOT EXISTS "widgets" ("id" uuid PRIMARY KEY, "title" text);
ALTER TABLE "widgets" FORCE ROW LEVEL SECURITY;
ALTER TABLE widgets NO FORCE ROW LEVEL SECURITY;`,
      );
      const replayed = replayMigrationsDir(dir);
      expect([...(replayed.get("widgets")?.columns ?? [])].sort()).toEqual(["id", "title"]);
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

describe("replayMigrationsDir: RENAME, CREATE TABLE AS, DO blocks", () => {
  function replayOf(files: Record<string, string>) {
    const dir = tmpMigrationsDir();
    try {
      for (const [name, sql] of Object.entries(files)) write(dir, name, sql);
      return replayMigrationsDir(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const widgets = `CREATE TABLE "widgets" ("id" uuid PRIMARY KEY, "title" text);`;

  test("ALTER TABLE RENAME TO moves the table with its columns", () => {
    const replayed = replayOf({
      "0001_init.sql": widgets,
      "0002_rename.sql": `ALTER TABLE "widgets" RENAME TO "gadgets";`,
    });
    expect([...replayed.keys()]).toEqual(["gadgets"]);
    expect([...(replayed.get("gadgets")?.columns ?? [])].sort()).toEqual(["id", "title"]);
  });

  test("RENAME COLUMN (with and without the COLUMN keyword) renames in place", () => {
    const replayed = replayOf({
      "0001_init.sql": widgets,
      "0002_rename.sql": `ALTER TABLE "widgets" RENAME COLUMN "title" TO "name";
ALTER TABLE "widgets" RENAME "name" TO "label";`,
    });
    expect([...(replayed.get("widgets")?.columns ?? [])].sort()).toEqual(["id", "label"]);
  });

  test("RENAME CONSTRAINT does not change the shape", () => {
    const replayed = replayOf({
      "0001_init.sql": widgets,
      "0002_rename.sql": `ALTER TABLE "widgets" RENAME CONSTRAINT "a" TO "b";`,
    });
    expect([...(replayed.get("widgets")?.columns ?? [])].sort()).toEqual(["id", "title"]);
  });

  test("CREATE TABLE AS takes columns from aliases and plain references", () => {
    const replayed = replayOf({
      "0001_init.sql": widgets,
      "0002_copy.sql": `CREATE TABLE "widgets_archive" AS SELECT w."id", w.title AS caption, count(*) AS total FROM "widgets" w GROUP BY 1, 2;`,
    });
    expect([...(replayed.get("widgets_archive")?.columns ?? [])].sort()).toEqual([
      "caption",
      "id",
      "total",
    ]);
  });

  test("CREATE TABLE AS SELECT * copies the columns of a known source table", () => {
    const replayed = replayOf({
      "0001_init.sql": widgets,
      "0002_copy.sql": `CREATE TABLE "widgets_copy" AS SELECT * FROM "widgets";`,
    });
    expect([...(replayed.get("widgets_copy")?.columns ?? [])].sort()).toEqual(["id", "title"]);
    expect(replayed.get("widgets_copy")?.columnsUnknown).toBeUndefined();
  });

  test("CREATE TABLE AS SELECT * from an unknown source only tracks the table", () => {
    const replayed = replayOf({
      "0001_copy.sql": `CREATE TABLE "mystery" AS SELECT * FROM "external_source";`,
    });
    expect(replayed.get("mystery")?.columnsUnknown).toBe(true);
  });

  test("CREATE TABLE AS with an explicit column list uses that list", () => {
    const replayed = replayOf({
      "0001_copy.sql": `CREATE TABLE "pairs" ("a", "b") AS SELECT 1, 2;`,
    });
    expect([...(replayed.get("pairs")?.columns ?? [])].sort()).toEqual(["a", "b"]);
  });

  test("DO block: guarded ADD COLUMN is applied as the intended end state", () => {
    const replayed = replayOf({
      "0001_init.sql": widgets,
      "0002_guarded.sql": `DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name = 'widgets' AND column_name = 'color'
  ) THEN
    ALTER TABLE "widgets" ADD COLUMN "color" text;
  END IF;
END
$$;`,
    });
    expect([...(replayed.get("widgets")?.columns ?? [])].sort()).toEqual(["color", "id", "title"]);
  });

  test("DO block without table DDL is a no-op, and following statements still apply", () => {
    const replayed = replayOf({
      "0001_init.sql": widgets,
      "0002_data.sql": `DO $tag$ BEGIN UPDATE "widgets" SET title = 'x'; END $tag$;
ALTER TABLE "widgets" ADD COLUMN "after_do" text;`,
    });
    expect([...(replayed.get("widgets")?.columns ?? [])].sort()).toEqual([
      "after_do",
      "id",
      "title",
    ]);
  });

  test("DO block with an alphanumeric dollar tag is applied", () => {
    const replayed = replayOf({
      "0001_init.sql": widgets,
      "0002_guarded.sql": `DO $do1$ BEGIN ALTER TABLE "widgets" ADD COLUMN "color" text; END $do1$;`,
    });
    expect([...(replayed.get("widgets")?.columns ?? [])].sort()).toEqual(["color", "id", "title"]);
  });

  test("DO block with a single-quoted body fails loudly instead of being ignored", () => {
    expect(() =>
      replayOf({
        "0001_init.sql": widgets,
        "0002_quoted.sql": `DO 'BEGIN ALTER TABLE widgets ADD COLUMN color text; END';`,
      }),
    ).toThrow(/0002_quoted: DO block/);
  });

  test("a snapshot comparison skips column drift for a table with unknown columns", () => {
    const replayed = replayOf({
      "0001_copy.sql": `CREATE TABLE "mystery" AS SELECT * FROM "external_source";`,
    });
    const snapshot = snapshotFromMetas([
      meta("mystery", [{ name: "id", pgType: "uuid", notNull: true }]),
    ]);
    expect(diffReplayAgainstSnapshot(replayed, snapshot)).toEqual([]);
  });
});
