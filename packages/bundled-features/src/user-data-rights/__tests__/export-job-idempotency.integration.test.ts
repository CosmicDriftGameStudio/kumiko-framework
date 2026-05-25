// ExportJob Partial-UNIQUE-Index Integration-Test (S2.U3 Atom 1b).
//
// Pinst die DB-Constraint die Atom-2's request-export-Handler nutzt:
// `UNIQUE(userId) WHERE status IN ('pending', 'running')`. Pro User
// kann es maximal EINEN aktiven Job geben — done/failed-Historie ist
// unbeschraenkt.
//
// Plus DB-Roundtrip-Test fuer bigInt-Spalte (bytesWritten >2^31), der
// in Atom 1a's pure unit-Test absichtlich ausgelassen wurde weil er
// reale Postgres + Drizzle-customType-Codec-Path braucht.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  asRawClient,
  insertOne,
  selectMany,
  updateMany,
} from "@cosmicdrift/kumiko-framework/bun-db";
import { extractPgError } from "@cosmicdrift/kumiko-framework/db";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature } from "../../data-retention";
import { createUserFeature } from "../../user";
import { createSessionsFeature } from "../../sessions";
import { createUserDataRightsFeature } from "../feature";
import {
  ACTIVE_JOB_CONSTRAINT,
  EXPORT_JOB_STATUS,
  exportJobEntity,
  exportJobsTable,
} from "../schema/export-job";

let stack: TestStack;

const TENANT_SYSTEM = "00000000-0000-4000-8000-000000000001";
const ALICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const BOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createUserFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createSessionsFeature(),

      createUserDataRightsFeature(),
    ],
  });

  await unsafeCreateEntityTable(stack.db, exportJobEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [exportJobsTable]);
});

const NOW = () => getTemporal().Now.instant();

// postgres-js wirft PostgresError direkt; Drizzle wrappt in .cause.
// extractPgError normalisiert beide Shapes. Constraint-Name pinnen damit
// der Test nur unsere Idempotency-Constraint pinst, nicht zufaellig eine
// andere unique-violation (z.B. UUID-Kollision auf id-PK).
async function expectUniqueViolation(
  promise: Promise<unknown>,
  expectedConstraint: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeDefined();
  const pg = extractPgError(caught);
  expect(pg?.code).toBe("23505");
  expect(pg?.constraint_name).toBe(expectedConstraint);
}

// Re-Export aus dem Schema — Single source of truth, Rename hier
// braeuche kein Test-Edit.
const IDEMPOTENCY_CONSTRAINT = ACTIVE_JOB_CONSTRAINT;

async function insertJob(
  userId: string,
  status: string,
  overrides: { bytesWritten?: number } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  const values: Record<string, unknown> = {
    id,
    tenantId: TENANT_SYSTEM,
    userId,
    requestedFromTenantId: TENANT_SYSTEM,
    status,
    requestedAt: NOW(),
  };
  if (overrides.bytesWritten !== undefined) {
    values["bytesWritten"] = overrides.bytesWritten;
  }
  await insertOne(stack.db, exportJobsTable, values);
  return id;
}

describe("ExportJob :: Partial-UNIQUE-Index", () => {
  test("zwei pending-Jobs fuer denselben User → DB lehnt zweiten ab", async () => {
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending);

    await expectUniqueViolation(
      insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending),
      IDEMPOTENCY_CONSTRAINT,
    );

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(1);
  });

  test("pending + running fuer denselben User → DB lehnt running ab", async () => {
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending);

    // Zweiter "aktiver" Status (running) ist auch gesperrt — der Index
    // greift fuer alle Status-Werte im WHERE-Set.
    await expectUniqueViolation(
      insertJob(ALICE_ID, EXPORT_JOB_STATUS.Running),
      IDEMPOTENCY_CONSTRAINT,
    );

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(1);
  });

  test("pending fuer User A + pending fuer User B → beide erlaubt (per-User-scoped)", async () => {
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending);
    await insertJob(BOB_ID, EXPORT_JOB_STATUS.Pending);

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(2);
  });

  test("done + neuer pending fuer denselben User → erlaubt (Done ausserhalb des Index-Filters)", async () => {
    // Erster Job done (Audit-Historie)
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Done);
    // Zweiter pending-Job fuer denselben User — neue Anfrage nach
    // erfolgreichem Download
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending);

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(2);
  });

  test("failed + neuer pending fuer denselben User → erlaubt (Retry-Pfad)", async () => {
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Failed);
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending);

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(2);
  });

  test("zwei done-Jobs fuer denselben User → erlaubt (Audit-Historie)", async () => {
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Done);
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Done);

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(2);
  });

  test("Lifecycle: pending → running blockt weitere pending-Inserts; nach running → done wieder erlaubt", async () => {
    // Alice pending insert
    const aliceJobId = await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending);
    // Worker pickt auf — Status flip
    await updateMany(
      stack.db,
      exportJobsTable,
      { status: EXPORT_JOB_STATUS.Running },
      { id: aliceJobId },
    );

    // Zweiter pending-Insert fuer Alice → faellt weiter, weil bestehender
    // Job in running auch im Index-Filter ist.
    await expectUniqueViolation(
      insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending),
      IDEMPOTENCY_CONSTRAINT,
    );

    // Aber wenn der running-Job fertig wird (done), darf User wieder pending starten
    await updateMany(
      stack.db,
      exportJobsTable,
      { status: EXPORT_JOB_STATUS.Done },
      { id: aliceJobId },
    );

    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending);
    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(2);
  });
});

describe("ExportJob :: bigInt bytesWritten DB-Roundtrip", () => {
  test("bytesWritten >2^31 schreibt + liest identisch zurueck", async () => {
    const TWO_GB_PLUS = 3_000_000_000; // ~2.8 GB, weit ueber integer-Cap
    const id = await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Done, {
      bytesWritten: TWO_GB_PLUS,
    });

    const [row] = (await selectMany(stack.db, exportJobsTable, { id })) as Array<{
      bytesWritten: number;
    }>;

    expect(row?.bytesWritten).toBe(TWO_GB_PLUS);
  });

  test("bytesWritten 2^50 (~1 PB) schreibt + liest identisch zurueck", async () => {
    const ONE_PB_PLUS = 2 ** 50;
    const id = await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Done, {
      bytesWritten: ONE_PB_PLUS,
    });

    const [row] = (await selectMany(stack.db, exportJobsTable, { id })) as Array<{
      bytesWritten: number;
    }>;

    expect(row?.bytesWritten).toBe(ONE_PB_PLUS);
  });

  test("bytesWritten als raw-SQL geprueft → DB-Spalte ist tatsaechlich BIGINT", async () => {
    const id = await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Done, {
      bytesWritten: 1,
    });
    // information_schema-Lookup pinst den DB-Typ unabhaengig vom JS-
    // Driver-Mapping — wenn jemand `case "bigInt"` zu `integer` zurueck-
    // refactored, faellt dieser Test um obwohl die JS-Werte sich
    // numerisch verhalten.
    const result = await asRawClient(stack.db).unsafe(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'read_export_jobs' AND column_name = 'bytes_written'
    `);
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-execute typing
    const rows = ((result as any).rows ?? result) as Array<{ data_type: string }>;
    expect(rows[0]?.data_type).toBe("bigint");
    void id;
  });
});
