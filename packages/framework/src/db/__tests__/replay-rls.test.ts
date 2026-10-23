import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EntityTableMeta } from "../entity-table-meta.ts";
import { generateMigration } from "../migrate-generator.ts";
import { diffReplayAgainstSnapshot, replayMigrationsDir } from "../replay-migration-sql.ts";

function tenantTable(tableName: string): EntityTableMeta {
  return {
    tableName,
    source: "unmanaged",
    indexes: [],
    columns: [
      { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
      { name: "tenant_id", pgType: "uuid", notNull: true },
    ],
  };
}

function replaySql(...files: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "replay-rls-"));
  try {
    files.forEach((sql, index) => {
      writeFileSync(join(dir, `${String(index + 1).padStart(4, "0")}_step.sql`), sql);
    });
    return replayMigrationsDir(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CREATE_T = `CREATE TABLE IF NOT EXISTS "t" ("id" uuid PRIMARY KEY, "tenant_id" uuid NOT NULL);`;

describe("replay of row level security statements", () => {
  test("tracks CREATE and DROP POLICY", () => {
    const state = replaySql(
      `${CREATE_T}
CREATE POLICY "a" ON "t" AS PERMISSIVE FOR ALL TO PUBLIC USING (true);
CREATE POLICY "b" ON public."t" FOR SELECT USING (true);
DROP POLICY IF EXISTS "a" ON "t";
DROP POLICY IF EXISTS "never_existed" ON "t";`,
    ).get("t")?.rowLevelSecurity;
    expect([...(state?.policies.keys() ?? [])]).toEqual(["b"]);
  });

  test("tracks ENABLE, FORCE and their negations in statement order", () => {
    const flags = (sql: string) => {
      const state = replaySql(`${CREATE_T}\n${sql}`).get("t")?.rowLevelSecurity;
      return { enabled: state?.enabled, forced: state?.forced };
    };
    expect(flags(`ALTER TABLE "t" ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY;`)).toEqual({
      enabled: true,
      forced: true,
    });
    expect(
      flags(`ALTER TABLE "t" ENABLE ROW LEVEL SECURITY;
ALTER TABLE ONLY "t" FORCE ROW LEVEL SECURITY;
ALTER TABLE "t" NO FORCE ROW LEVEL SECURITY;`),
    ).toEqual({ enabled: true, forced: false });
    expect(
      flags(`ALTER TABLE "t" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "t" DISABLE ROW LEVEL SECURITY;`),
    ).toEqual({ enabled: false, forced: false });
  });

  test("renames policies and follows table renames", () => {
    const replayed = replaySql(
      `${CREATE_T}
CREATE POLICY "a" ON "t" USING (true);
ALTER POLICY "a" ON "t" RENAME TO "b";
ALTER TABLE "t" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "t" RENAME TO "u";`,
    );
    expect(replayed.has("t")).toBe(false);
    const state = replayed.get("u")?.rowLevelSecurity;
    expect([...(state?.policies.keys() ?? [])]).toEqual(["b"]);
    expect(state?.enabled).toBe(true);
  });

  test("a rename keeps the definition, ALTER POLICY without RENAME discards it", () => {
    const policies = (sql: string) =>
      replaySql(`${CREATE_T}\nCREATE POLICY "a" ON "t" USING (true);\n${sql}`).get("t")
        ?.rowLevelSecurity?.policies;
    expect(policies(`ALTER POLICY "a" ON "t" RENAME TO "b";`)?.get("b")).toBe("USING (true)");
    expect(policies(`ALTER POLICY "a" ON "t" USING (false);`)?.has("a")).toBe(true);
    expect(policies(`ALTER POLICY "a" ON "t" USING (false);`)?.get("a")).toBeUndefined();
  });

  test("a policy inside a DO block fails loud", () => {
    expect(() =>
      replaySql(`${CREATE_T}\nDO $$ BEGIN CREATE POLICY "a" ON "t" USING (true); END $$;`),
    ).toThrow(/DO block/);
    expect(() =>
      replaySql(`${CREATE_T}\nDO $$ BEGIN ALTER TABLE "t" enable row level security; END $$;`),
    ).toThrow(/DO block/);
  });

  test("state disappears with DROP TABLE", () => {
    const replayed = replaySql(
      `${CREATE_T}\nCREATE POLICY "a" ON "t" USING (true);\nDROP TABLE "t";\n${CREATE_T}`,
    );
    expect(replayed.get("t")?.rowLevelSecurity).toBeUndefined();
  });

  test("ignores policies on tables the replay does not know", () => {
    const replayed = replaySql(`CREATE POLICY "a" ON "framework_table" USING (true);`);
    expect(replayed.size).toBe(0);
  });

  test("fails loud on a policy statement it cannot parse", () => {
    expect(() => replaySql(`${CREATE_T}\nCREATE POLICY ON "t" USING (true);`)).toThrow(
      /unparsed policy statement/,
    );
  });

  test("fails loud when DROP POLICY without IF EXISTS hits an unknown policy", () => {
    expect(() => replaySql(`${CREATE_T}\nDROP POLICY "ghost" ON "t";`)).toThrow(/0001_step.*ghost/);
  });
});

describe("row-level-security-drift against the snapshot", () => {
  function generateInitial() {
    return generateMigration({
      metas: [tenantTable("store_items")],
      prevSnapshot: null,
      name: "init",
      sequenceNumber: 1,
      rowLevelSecurity: "on",
    });
  }

  function mismatchesFor(sql: string, snapshot: ReturnType<typeof generateInitial>["snapshot"]) {
    const dir = mkdtempSync(join(tmpdir(), "replay-rls-e2e-"));
    try {
      writeFileSync(join(dir, "0001_init.sql"), sql);
      return diffReplayAgainstSnapshot(replayMigrationsDir(dir), snapshot);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("the generated migration replays without mismatches", () => {
    const { sqlContent, snapshot } = generateInitial();
    expect(mismatchesFor(sqlContent, snapshot)).toEqual([]);
  });

  test("a migration missing one CREATE POLICY line reports drift", () => {
    const { sqlContent, snapshot } = generateInitial();
    const withoutPolicy = sqlContent
      .split("\n")
      .filter((line) => !line.startsWith(`CREATE POLICY "kumiko_system_tenant_read"`))
      .join("\n");
    const mismatches = mismatchesFor(withoutPolicy, snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({
      tableName: "store_items",
      kind: "row-level-security-drift",
    });
    expect(mismatches[0]?.detail).toContain("missing policy: kumiko_system_tenant_read");
  });

  test("a migration without FORCE reports drift", () => {
    const { sqlContent, snapshot } = generateInitial();
    const withoutForce = sqlContent
      .split("\n")
      .filter((line) => !line.includes("FORCE ROW LEVEL SECURITY"))
      .join("\n");
    expect(mismatchesFor(withoutForce, snapshot)[0]?.detail).toContain("not forced");
  });

  test("a hand-edited generated policy reports drift", () => {
    const { sqlContent, snapshot } = generateInitial();
    const handEdited = sqlContent.replace(
      /(CREATE POLICY "kumiko_tenant_isolation" ON "store_items" AS PERMISSIVE FOR ALL TO PUBLIC )USING \(.*?\) WITH CHECK \(.*?\);/,
      "$1USING (true) WITH CHECK (true);",
    );
    expect(handEdited).not.toBe(sqlContent);
    const mismatches = mismatchesFor(handEdited, snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.detail).toContain("policy kumiko_tenant_isolation deviates");
  });

  test("an ALTER POLICY on a generated policy reports drift", () => {
    const { sqlContent, snapshot } = generateInitial();
    const altered = `${sqlContent}\nALTER POLICY "kumiko_tenant_isolation" ON "store_items" USING (true);\n`;
    expect(mismatchesFor(altered, snapshot)[0]?.detail).toContain("deviates");
  });

  test("an extra policy reports drift", () => {
    const { sqlContent, snapshot } = generateInitial();
    const extra = `${sqlContent}\nCREATE POLICY "extra" ON "store_items" USING (true);\n`;
    expect(mismatchesFor(extra, snapshot)[0]?.detail).toContain("unexpected policies: extra");
  });

  test("RLS in migrations without a snapshot spec reports drift", () => {
    const { sqlContent } = generateInitial();
    const plain = generateMigration({
      metas: [tenantTable("store_items")],
      prevSnapshot: null,
      name: "init",
      sequenceNumber: 1,
    });
    const mismatches = mismatchesFor(sqlContent, plain.snapshot);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatchObject({
      tableName: "store_items",
      kind: "row-level-security-drift",
    });
    expect(mismatches[0]?.detail).toContain("no row level security spec");
  });

  test("a spec for another table does not excuse RLS on this one", () => {
    const { sqlContent } = generateInitial();
    const snapshot = generateMigration({
      metas: [tenantTable("store_items"), tenantTable("store_other")],
      prevSnapshot: null,
      name: "init",
      sequenceNumber: 1,
    }).snapshot;
    const withOtherSpec = {
      ...snapshot,
      rowLevelSecurity: { store_other: { policies: [] } },
    };
    const itemsMismatches = mismatchesFor(sqlContent, withOtherSpec).filter(
      (m) => m.tableName === "store_items",
    );
    expect(itemsMismatches[0]?.detail).toContain("no row level security spec");
  });

  test("snapshots without rowLevelSecurity produce no RLS mismatches", () => {
    const plain = generateMigration({
      metas: [tenantTable("store_items")],
      prevSnapshot: null,
      name: "init",
      sequenceNumber: 1,
    });
    expect(mismatchesFor(plain.sqlContent, plain.snapshot)).toEqual([]);
  });
});
