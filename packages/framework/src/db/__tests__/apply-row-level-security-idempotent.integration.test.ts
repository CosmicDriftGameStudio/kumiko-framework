// A push of a table that already carries the kumiko policies takes no lock and runs no DDL.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import { applyTableRowLevelSecurity } from "../queries/ddl.ts";
import { readRowLevelSecurityState } from "../queries/rls-catalog.ts";
import { asRawClient, transaction } from "../query.ts";
import { unsafePushTables } from "../table-push.ts";

const meta = defineUnmanagedTable({
  tableName: "store_idempotent_push",
  columns: [
    {
      name: "id",
      pgType: "uuid",
      notNull: true,
      primaryKey: true,
      defaultSql: "gen_random_uuid()",
    },
    { name: "tenant_id", pgType: "uuid", notNull: true },
  ],
});

let testDb: TestDb;
const raw = () => asRawClient(testDb.db);

const ddlStatementsSince = async () =>
  (await raw().unsafe<{ n: number }>(`SELECT count(*)::int AS n FROM ddl_log`))[0]?.n ?? 0;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafePushTables(testDb.db, { live: meta }, undefined, { rowLevelSecurity: "on" });
  await raw().unsafe(`CREATE TABLE ddl_log (tag text)`);
  await raw().unsafe(`CREATE FUNCTION log_ddl() RETURNS event_trigger LANGUAGE plpgsql AS $$
    BEGIN INSERT INTO ddl_log SELECT command_tag FROM pg_event_trigger_ddl_commands(); END $$`);
  await raw().unsafe(
    `CREATE EVENT TRIGGER log_ddl_end ON ddl_command_end EXECUTE FUNCTION log_ddl()`,
  );
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("applyTableRowLevelSecurity on an already applied table", () => {
  test("neither waits for a lock held on the table nor runs DDL", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held!: () => void;
    const heldSignal = new Promise<void>((resolve) => {
      held = resolve;
    });
    const holder = transaction(testDb.outsideTransactionDb, async (tx) => {
      await asRawClient(tx).unsafe(`LOCK TABLE "store_idempotent_push" IN ACCESS EXCLUSIVE MODE`);
      held();
      await released;
    });
    try {
      await heldSignal;
      const outcome = await Promise.race([
        applyTableRowLevelSecurity(testDb.db, meta).then(() => "done"),
        Bun.sleep(1500).then(() => "blocked"),
      ]);
      expect(outcome).toBe("done");
    } finally {
      release();
      await holder;
    }
    expect(await ddlStatementsSince()).toBe(0);
  });

  test("a table that lost FORCE is fixed on the next push", async () => {
    await raw().unsafe(`ALTER TABLE "store_idempotent_push" NO FORCE ROW LEVEL SECURITY`);
    expect(await readRowLevelSecurityState(testDb.db, "public", meta.tableName)).toMatchObject({
      forced: false,
    });

    await applyTableRowLevelSecurity(testDb.db, meta);

    expect(await readRowLevelSecurityState(testDb.db, "public", meta.tableName)).toMatchObject({
      enabled: true,
      forced: true,
    });
  });
});
