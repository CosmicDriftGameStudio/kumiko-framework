import { describe, expect, test } from "bun:test";
import { InternalError } from "../../errors/index.ts";
import { testTenantId } from "../../seeding/seed-users.ts";
import type { DbRunner } from "../connection.ts";
import { defineUnmanagedTable } from "../entity-table-meta.ts";
import {
  acknowledgeConventionCrossTenant,
  createTenantDb,
  createUncheckedSystemDb,
  withUnsafeRawGrant,
} from "../tenant-db.ts";
import { tenantDbRunner, tenantDbWriteRunner } from "../tenant-db-runner.ts";

const noteTable = defineUnmanagedTable({
  tableName: "writes_denied_notes",
  columns: [
    { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
    { name: "tenant_id", pgType: "uuid", notNull: true },
    { name: "title", pgType: "text", notNull: true },
  ],
});
const tenantId = testTenantId(1);
const writesDeniedReason = "without an open transaction";

const queries: string[] = [];
function recordingRunner(): DbRunner {
  return {
    unsafe: async (sqlText: string) => {
      queries.push(sqlText);
      return [];
    },
  } as unknown as DbRunner;
}

function deniedDb() {
  return createTenantDb({
    db: recordingRunner(),
    tenantId,
    mode: "tenant",
    grants: {
      writesDeniedReason,
    },
  });
}

describe("TenantDb with writesDeniedReason", () => {
  test("insertOne, updateMany and deleteMany reject without touching the connection", async () => {
    queries.length = 0;
    const db = deniedDb();

    await expect(db.insertOne(noteTable, { title: "a" })).rejects.toThrow(InternalError);
    await expect(db.updateMany(noteTable, { title: "b" }, { id: "x" })).rejects.toThrow(
      /ctx\.db\.updateMany: writes are not available without an open transaction/,
    );
    await expect(db.deleteMany(noteTable, { id: "x" })).rejects.toThrow(
      /ctx\.db\.deleteMany: writes are not available/,
    );
    expect(queries).toEqual([]);
  });

  test("reads still reach the connection", async () => {
    queries.length = 0;
    await deniedDb().selectMany(noteTable, {});
    expect(queries.length).toBe(1);
  });

  test("the runner-based write door is closed, the read door stays open", () => {
    const db = deniedDb();
    expect(() => tenantDbWriteRunner(db, "ctx.db executor create")).toThrow(
      /ctx\.db executor create: writes are not available/,
    );
    expect(tenantDbRunner(db)).toBeDefined();
  });

  test("rebound instances stay denied: unsafeRaw grant, cross-tenant acknowledge, system acknowledge", () => {
    const db = deniedDb();
    const regranted = withUnsafeRawGrant(db, { reason: "test grant" });
    const acknowledged = acknowledgeConventionCrossTenant(db, "test reason");
    const systemAcknowledged = createUncheckedSystemDb(
      db,
      undefined,
      () => {},
    ).acknowledgeCrossTenant("test reason");

    const systemMatched = createUncheckedSystemDb(db, undefined, () => {}).assertTenantMatch(
      tenantId,
    );

    for (const rebound of [regranted, acknowledged, systemAcknowledged, systemMatched]) {
      expect(() => tenantDbWriteRunner(rebound, "write")).toThrow(/writes are not available/);
    }
  });

  test("a TenantDb without the grant keeps its write runner", () => {
    const db = createTenantDb({ db: recordingRunner(), tenantId });
    expect(tenantDbWriteRunner(db, "write")).toBe(tenantDbRunner(db));
  });
});
