// ExportJob partial-UNIQUE-index integration test.
//
// Pins the database constraint used by the request-export handler:
// `UNIQUE(userId) WHERE status IN ('pending', 'running')`. Each user can
// have at most one active job; done/failed history is unlimited.
//
// Also tests a database round trip for the bigInt column (bytesWritten >2^31),
// which the pure unit test intentionally omits because it requires a real
// Postgres + Drizzle-customType codec path.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";

import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  resetTestTables,
  seedRowViaEventStore,
  updateRowViaEventStore,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createUserFeature } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import {
  ACTIVE_JOB_CONSTRAINT,
  EXPORT_JOB_STATUS,
  exportJobEntity,
  exportJobsTable,
} from "../schema/export-job.ts";

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
      createAuthFoundationFeature(),
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
  await resetTestTables(stack.db, [exportJobsTable, eventsTable]);
});

const NOW = () => getTemporal().Now.instant();

// The executor maps the projection's 23505 to unique_violation with the constraint name in
// the details. Pin the constraint name so the test checks only our idempotency constraint,
// not an unrelated unique violation such as a UUID collision on the id primary key.
async function expectUniqueViolation(
  promise: Promise<unknown>,
  expectedConstraint: string,
): Promise<void> {
  await expect(promise).rejects.toThrow(
    new RegExp(`failed: unique_violation .*"constraintName":"${expectedConstraint}"`),
  );
}

// Re-exported from the schema as the single source of truth, so renaming the
// constraint does not require a test edit.
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
  await seedRowViaEventStore(stack.db, exportJobsTable, values);
  return id;
}

describe("ExportJob :: Partial-UNIQUE-Index", () => {
  test("two pending jobs for the same user → DB rejects the second", async () => {
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending);

    await expectUniqueViolation(
      insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending),
      IDEMPOTENCY_CONSTRAINT,
    );

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(1);
  });

  test("pending + running for the same user → DB rejects running", async () => {
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending);

    // The other active status (running) is also blocked because the index covers
    // every status value in the WHERE set.
    await expectUniqueViolation(
      insertJob(ALICE_ID, EXPORT_JOB_STATUS.Running),
      IDEMPOTENCY_CONSTRAINT,
    );

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(1);
  });

  test("pending for User A + pending for User B → both allowed (per-user-scoped)", async () => {
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending);
    await insertJob(BOB_ID, EXPORT_JOB_STATUS.Pending);

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(2);
  });

  test("done + new pending for the same user → allowed (Done outside the index filter)", async () => {
    // Erster Job done (Audit-Historie)
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Done);
    // A second pending job for the same user represents a new request after
    // the successful download.
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending);

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(2);
  });

  test("failed + new pending for the same user → allowed (retry path)", async () => {
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Failed);
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending);

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(2);
  });

  test("two done jobs for the same user → allowed (audit history)", async () => {
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Done);
    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Done);

    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(2);
  });

  test("Lifecycle: pending → running blocks further pending inserts; after running → done, another pending insert is allowed", async () => {
    const runningJobId = await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Running);

    // A pending insert fails because a running job is also included in the index filter.
    await expectUniqueViolation(
      insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending),
      IDEMPOTENCY_CONSTRAINT,
    );

    // Once the job is done, the user may start another pending job.
    await updateRowViaEventStore(
      stack.db,
      { table: exportJobsTable, entity: exportJobEntity, entityName: "exportJob" },
      { id: runningJobId },
      { status: EXPORT_JOB_STATUS.Done },
      { tenantId: TENANT_SYSTEM as TenantId },
    );

    await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Pending);
    const rows = await selectMany(stack.db, exportJobsTable);
    expect(rows).toHaveLength(2);
  });
});

describe("ExportJob :: bigInt bytesWritten DB-Roundtrip", () => {
  test("bytesWritten >2^31 writes + reads back identically", async () => {
    const TWO_GB_PLUS = 3_000_000_000; // ~2.8 GB, well above the integer limit
    const id = await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Done, {
      bytesWritten: TWO_GB_PLUS,
    });

    const [row] = (await selectMany(stack.db, exportJobsTable, { id })) as Array<{
      bytesWritten: number;
    }>;

    expect(row?.bytesWritten).toBe(TWO_GB_PLUS);
  });

  test("bytesWritten 2^50 (~1 PB) writes + reads back identically", async () => {
    const ONE_PB_PLUS = 2 ** 50;
    const id = await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Done, {
      bytesWritten: ONE_PB_PLUS,
    });

    const [row] = (await selectMany(stack.db, exportJobsTable, { id })) as Array<{
      bytesWritten: number;
    }>;

    expect(row?.bytesWritten).toBe(ONE_PB_PLUS);
  });

  test("bytesWritten checked via raw SQL → DB column is actually BIGINT", async () => {
    const id = await insertJob(ALICE_ID, EXPORT_JOB_STATUS.Done, {
      bytesWritten: 1,
    });
    // The information_schema lookup pins the database type independently of the
    // JS driver mapping. If `case "bigInt"` is refactored back to `integer`, this
    // test fails even if the JS values still behave numerically.
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
