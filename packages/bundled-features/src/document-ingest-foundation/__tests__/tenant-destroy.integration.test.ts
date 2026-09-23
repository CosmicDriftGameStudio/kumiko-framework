// Drives the real tenant-lifecycle destruction sweep: a direct hook call with a raw DbRunner
// hides the TenantDb shape the "app-data" stage actually passes.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { append, loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables, updateRows } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { tenantMembershipEntity } from "../../tenant";
import { TenantHandlers } from "../../tenant/constants";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import {
  TENANT_AGGREGATE_TYPE,
  TENANT_DESTRUCTION_STARTED_EVENT_QN,
} from "../../tenant-lifecycle/constants";
import { runTenantDestructionSweep } from "../../tenant-lifecycle/run-tenant-destroy";
import { documentExtractEntity, documentExtractsTable } from "../entity";
import { documentIngestFoundationFeature } from "../feature";
import { writeIngestPages } from "../pages";

const SET_PROFILE = "compliance-profiles:write:set-profile";

const documentExtractCrud = createEventStoreExecutor(documentExtractsTable, documentExtractEntity, {
  entityName: "document-extract",
});

let stack: TestStack;
let db: DbConnection;

const tenantA = TestUsers.admin;
const tenantB = TestUsers.otherTenant;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      documentIngestFoundationFeature,
    ],
  });
  db = stack.db;

  await unsafeCreateEntityTable(db, tenantEntity);
  await unsafeCreateEntityTable(db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(db, tenantMembershipEntity);
  await unsafeCreateEntityTable(db, documentExtractEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  stack.events.reset();
  await resetTestTables(db, [tenantTable, tenantComplianceProfileTable]);
  await stack.db.unsafe?.(
    `TRUNCATE kumiko_events, read_document_extracts RESTART IDENTITY CASCADE`,
  );
});

async function seedTenant(user: typeof tenantA): Promise<void> {
  await stack.http.writeOk(
    TenantHandlers.create,
    { id: user.tenantId, key: `t-${user.tenantId}`, name: "Tenant" },
    TestUsers.systemAdmin,
  );
  await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, user);
}

async function seedDocumentExtract(tenantId: TenantId, fileRefId: string): Promise<string> {
  const user = createSystemUser(tenantId);
  const tdb = createTenantDb(db, tenantId);
  const result = await documentExtractCrud.create(
    {
      fileRefId,
      storageKey: `s3://bucket/${fileRefId}`,
      pages: writeIngestPages([{ pageNumber: 1, text: "invoice text" }]),
      meta: { provider: "test", ms: 1, needsOcr: false, pagesParsed: 1, totalPages: 1 },
    },
    user,
    tdb,
  );
  if (!result.isSuccess) throw new Error(`seed failed: ${result.error.message}`);
  return String(result.data.id);
}

// Sidesteps the `request-destruction` write handler (needs user/auth/sessions
// features wired) by seeding the same "destroying" state it would produce —
// same pattern as files-tenant-data's hooks.integration.test.ts.
async function seedDestroyingTenant(tenantId: TenantId): Promise<void> {
  const now = getTemporal().Now.instant();
  await updateRows(
    db,
    tenantTable,
    { status: "destroying", destroyStartedAt: now },
    { id: tenantId },
  );
  await append(db, {
    aggregateId: tenantId,
    aggregateType: TENANT_AGGREGATE_TYPE,
    tenantId,
    expectedVersion: (await loadAggregate(db, tenantId, tenantId)).at(-1)?.version ?? 0,
    type: TENANT_DESTRUCTION_STARTED_EVENT_QN,
    payload: { startedAt: now.toString() },
    metadata: { userId: "system", requestId: "test:destruction-started" },
  });
}

async function driveDestructionToCompletion(tenantId: TenantId): Promise<string> {
  const farFuture = getTemporal()
    .Now.instant()
    .add({ hours: 24 * 3650 });
  let status = "";
  for (let i = 0; i < 20; i++) {
    await runTenantDestructionSweep({ db: stack.db, registry: stack.registry, now: farFuture });
    const rows = await selectMany(db, tenantTable, { id: tenantId });
    status = String(rows[0]?.["status"]);
    if (status === "destroyed" || status === "destroyFailed") break;
  }
  return status;
}

describe("document-ingest-foundation :: tenant destroy (#3196)", () => {
  test("purges documentExtract rows for the destroyed tenant, leaving another tenant's row untouched", async () => {
    await seedTenant(tenantA);
    await seedTenant(tenantB);

    const idA = await seedDocumentExtract(tenantA.tenantId, "file-a");
    await seedDocumentExtract(tenantB.tenantId, "file-b");

    await seedDestroyingTenant(tenantA.tenantId);

    const finalStatus = await driveDestructionToCompletion(tenantA.tenantId);
    expect(finalStatus).toBe("destroyed");

    const rowsA = await selectMany(db, documentExtractsTable, { tenantId: tenantA.tenantId });
    expect(rowsA).toHaveLength(0);

    const rowsB = await selectMany(db, documentExtractsTable, { tenantId: tenantB.tenantId });
    expect(rowsB).toHaveLength(1);

    // Proves this went through the executor (rebuild-safe forget), not a raw
    // deleteMany — the forgotten row's aggregate carries a `.forgotten` event.
    const events = await loadAggregate(db, idA, tenantA.tenantId);
    expect(events.some((e) => e.type === "document-extract.forgotten")).toBe(true);
  });
});
