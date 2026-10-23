// A persistent dev database that already rebuilt a projection as superuser must stay rebuildable for the application role.

import { expect, test } from "bun:test";
import { testDatabaseUrl } from "@cosmicdrift/kumiko-testing/helpers";
import { createTestDb } from "@cosmicdrift/kumiko-testing/stack";
import { generateId } from "../../utils/index.ts";
import { createDbConnection } from "../connection.ts";
import { dropDatabaseIfExists } from "../queries/test-stack.ts";
import { asRawClient } from "../query.ts";

test("adopting a persistent database hands the rebuild schema and its tables to the application role", async () => {
  const dbName = `kumiko_persist_${generateId().slice(-8)}`;
  const superuserRun = await createTestDb({ persistent: true, dbName });
  await asRawClient(superuserRun.db).unsafe(
    `CREATE SCHEMA kumiko_rebuild; CREATE TABLE kumiko_rebuild.leftover (id integer)`,
  );
  await superuserRun.cleanup();

  const applicationRun = await createTestDb({ persistent: true, dbName, applicationRole: true });
  try {
    const raw = asRawClient(applicationRun.db);
    await raw.unsafe(`DROP TABLE kumiko_rebuild.leftover`);
    await raw.unsafe(`CREATE TABLE kumiko_rebuild.created_by_application_role (id integer)`);
    const owners = await raw.unsafe<{ owner: string }>(
      `SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = 'kumiko_rebuild'`,
    );
    expect(owners.map((row) => row.owner)).toEqual(["kumiko_app"]);
  } finally {
    await applicationRun.cleanup();
    const admin = createDbConnection({
      url: testDatabaseUrl().replace(/\/[^/]+$/, "/postgres"),
      maxConnections: 1,
    });
    try {
      await dropDatabaseIfExists(admin.db, dbName);
    } finally {
      await admin.close();
    }
  }
});
