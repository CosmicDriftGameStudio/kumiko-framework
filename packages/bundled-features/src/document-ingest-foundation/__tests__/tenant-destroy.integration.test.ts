// Drives the real tenant-lifecycle destruction sweep: a direct hook call with a raw DbRunner
// hides the TenantDb shape the "app-data" stage actually passes.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createEventStoreExecutor, createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import { TenantHandlers } from "../../tenant/constants.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantMembershipEntity } from "../../tenant/index.js";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.js";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.js";
import {
  driveDestructionToCompletion,
  seedDestroyingTenant,
} from "../../tenant-lifecycle/testing.js";
import { documentExtractEntity, documentExtractsTable } from "../entity.js";
import { documentIngestFoundationFeature } from "../feature.js";
import { writeIngestPages } from "../pages.js";

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
  await asRawClient(stack.db).unsafe(
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

describe("document-ingest-foundation :: tenant destroy (#3196)", () => {
  test("purges documentExtract rows for the destroyed tenant, leaving another tenant's row untouched", async () => {
    await seedTenant(tenantA);
    await seedTenant(tenantB);

    const idA = await seedDocumentExtract(tenantA.tenantId, "file-a");
    await seedDocumentExtract(tenantB.tenantId, "file-b");

    await seedDestroyingTenant(db, tenantA.tenantId);

    const finalStatus = await driveDestructionToCompletion(stack, db, tenantA.tenantId);
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
