// tenant-handover's `claim` moving a fileRef's OWN event history + its share
// of the tenant-storage-usage counters (item 4): before this, moveFileRefs
// only flipped the file_refs row's tenant_id, so the fileRef aggregate's
// events in kumiko_events stayed under the source tenant — a later write
// against the moved fileRef couldn't load its stream, and a projection
// rebuild put the row back into the source tenant. See ../move-entity-graph.ts
// and framework/src/files/storage-tracking.ts for the fix.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  asRawClient,
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createSystemUser,
  createTextField,
  defineFeature,
  type EntityDefinition,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createFilesFeature,
  fileRefEntity,
  fileRefsTable,
  filesStorageTrackingFeature,
  tenantStorageUsageTable,
} from "@cosmicdrift/kumiko-framework/files";
import { rebuildProjection } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { signTenantHandoverGrant } from "../grant";
import { createTenantHandoverFeature } from "../index";

const CLAIM = "tenant-handover:write:claim";
const SECRET = "tenant-handover-storage-usage-secret";
// files feature -> r.entity("fileRef", ...) -> implicit projection name
// (registry-validate.ts's buildImplicitProjections naming convention).
const FILE_REF_PROJECTION = "files:projection:file-ref-entity";

const runEntity: EntityDefinition = createEntity({
  table: "handover_storage_run",
  idType: "uuid",
  transferable: true,
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
  },
});

const handoverStorageFixturesFeature = defineFeature("handover-storage-fixtures", (r) => {
  r.entity("run", runEntity);
});

const runTable = buildEntityTable("run", runEntity);
const runCrud = createEventStoreExecutor(runTable, runEntity, { entityName: "run" });

const fileRefCrud = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

let stack: TestStack;

const SOURCE_TENANT = testTenantId(4);
let nextUserId = 1000;

function destinationUser(tenantN: number) {
  return createTestUser({ id: nextUserId++, tenantId: testTenantId(tenantN), roles: ["User"] });
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createTenantHandoverFeature({ grantSecret: SECRET }),
      handoverStorageFixturesFeature,
      createFilesFeature(),
      filesStorageTrackingFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, runEntity, "run");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  stack.events.reset();
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, kumiko_snapshots, kumiko_event_consumers, handover_storage_run, file_refs, read_tenant_storage_usage RESTART IDENTITY CASCADE`,
  );
  await stack.eventDispatcher?.ensureRegistered();
});

async function seedRun(tenantId: TenantId, name: string): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await runCrud.create({ name }, user, db);
  if (!result.isSuccess) throw new Error(`seedRun failed: ${result.error.message}`);
  return String(result.data.id);
}

async function attachFile(tenantId: TenantId, entityId: string, size: number): Promise<string> {
  const user = createSystemUser(tenantId);
  const db = createTenantDb(stack.db, tenantId, "system");
  const result = await fileRefCrud.create(
    {
      storageKey: `${tenantId}/run/${entityId}/photo/x.jpg`,
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      size,
      entityType: "run",
      entityId,
      fieldName: "photo",
    },
    user,
    db,
  );
  if (!result.isSuccess) throw new Error(`attachFile failed: ${result.error.message}`);
  return String(result.data.id);
}

function grantFor(rowId: string): string {
  return signTenantHandoverGrant({
    entityType: "run",
    rowId,
    sourceTenantId: SOURCE_TENANT,
    ttlMinutes: 30,
    secret: SECRET,
  }).token;
}

async function usageFor(tenantId: string): Promise<{ totalBytes: number; fileCount: number }> {
  const [row] = await selectMany(stack.db, tenantStorageUsageTable, { tenantId });
  return row
    ? { totalBytes: Number(row["totalBytes"]) ?? 0, fileCount: Number(row["fileCount"]) ?? 0 }
    : { totalBytes: 0, fileCount: 0 };
}

describe("tenant-handover :: claim moves fileRef event history + storage usage", () => {
  test("moves the fileRef aggregate's own event history and storage-usage counters, leaving the moved fileRef writable and rebuild-stable", async () => {
    const runId = await seedRun(SOURCE_TENANT, "my run");
    const FILE_SIZE = 42;
    const fileId = await attachFile(SOURCE_TENANT, runId, FILE_SIZE);

    // Let the dispatcher apply fileRef.created before the claim, so the
    // counters this test asserts on are the MSP's real applied state, not
    // just the write-tx's own effect.
    await stack.eventDispatcher?.runOnce();
    expect(await usageFor(SOURCE_TENANT)).toEqual({ totalBytes: FILE_SIZE, fileCount: 1 });

    const dest = destinationUser(1);
    const data = await stack.http.writeOk<{ movedEntities: Record<string, number> }>(
      CLAIM,
      { token: grantFor(runId), entityType: "run" },
      dest,
    );
    expect(data.movedEntities).toEqual({ run: 1, fileRef: 1 });

    // Let the dispatcher settle again — the transfer already moved the
    // counters synchronously inside the claim's own transaction, so this
    // pass must be a no-op, not a double-apply.
    await stack.eventDispatcher?.runOnce();

    expect(await usageFor(SOURCE_TENANT)).toEqual({ totalBytes: 0, fileCount: 0 });
    expect(await usageFor(dest.tenantId)).toEqual({ totalBytes: FILE_SIZE, fileCount: 1 });

    // The fileRef aggregate's OWN event history moved too — a write against
    // it in the destination tenant must succeed (it couldn't load its
    // stream before this fix).
    const deleteUser = createSystemUser(dest.tenantId as TenantId);
    const deleteDb = createTenantDb(stack.db, dest.tenantId as TenantId, "system");
    const deleteResult = await fileRefCrud.delete({ id: fileId }, deleteUser, deleteDb);
    expect(deleteResult.isSuccess).toBe(true);

    // A projection rebuild must not resurrect the row under the source
    // tenant — before the fix, the fileRef.created event still carried the
    // source tenant_id and the rebuild would put file_refs.tenant_id back.
    await rebuildProjection(FILE_REF_PROJECTION, { db: stack.db, registry: stack.registry });

    const rows = await asRawClient(stack.db).unsafe(
      `SELECT tenant_id AS "tenantId", is_deleted AS "isDeleted" FROM file_refs WHERE id = $1`,
      [fileId],
    );
    const row = (rows as Array<{ tenantId: string; isDeleted: boolean }>)[0];
    expect(row?.tenantId).toBe(dest.tenantId);
    expect(row?.isDeleted).toBe(true);

    // Independently of the read-model rebuild above, the dispatcher applies
    // the pending fileRef.deleted event against the tenant-storage-usage MSP.
    await stack.eventDispatcher?.runOnce();
    expect(await usageFor(dest.tenantId)).toEqual({ totalBytes: 0, fileCount: 0 });
  });
});
