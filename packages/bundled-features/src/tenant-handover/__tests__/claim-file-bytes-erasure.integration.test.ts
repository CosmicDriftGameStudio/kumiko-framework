// A claim moves the fileRef row to the destination tenant, but its storageKey keeps the source
// tenant's prefix. The destination tenant's erasure jobs run with a FileContext bound to the
// destination tenant and must still delete those bytes (original and derivatives).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  asRawClient,
  buildEntityTable,
  createEventStoreExecutor,
  createTenantDb,
} from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createImageField,
  createSystemUser,
  createTextField,
  defineFeature,
  type EntityDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { runSeedWritesAt, SEED_MODE_ENV } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createFilesFeature,
  createInMemoryFileProvider,
  deriveKey,
  fileRefEntity,
  fileRefsTable,
} from "@cosmicdrift/kumiko-framework/files";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createDataRetentionFeature } from "../../data-retention/feature.js";
import { signTenantHandoverGrant } from "../grant.js";
import { createTenantHandoverFeature } from "../index.js";

const CLAIM = "tenant-handover:write:claim";
const RETENTION_CLEANUP_JOB = "data-retention:job:retention-cleanup";
const SOFT_DELETE_CLEANUP_JOB = "soft-delete:job:cleanup";
const SECRET = "handover-erasure-test-secret-0123456789";
const DERIVATIVE_SUFFIX = "thumb-0123456789abcdef";
const SOURCE_TENANT = testTenantId(5);
const DEST_TENANT = testTenantId(6);

const carEntity: EntityDefinition = createEntity({
  table: "handover_erasure_car",
  idType: "uuid",
  transferable: true,
  fields: {
    name: createTextField({ required: true, personal: false, reason: "technical_reference" }),
    photo: createImageField(),
  },
  retention: { keepFor: "30d", strategy: "hardDelete" },
});

const fixturesFeature = defineFeature("handover-erasure-fixtures", (r) => {
  r.entity({ name: "car", ...carEntity });
});

const carCrud = createEventStoreExecutor(buildEntityTable("car", carEntity), carEntity, {
  entityName: "car",
});
const fileRefCrud = createEventStoreExecutor(fileRefsTable, fileRefEntity, {
  entityName: "fileRef",
});

const provider = createInMemoryFileProvider();
const previousSeedMode = process.env[SEED_MODE_ENV];
let stack: TestStack;
let nextUserId = 2000;

beforeAll(async () => {
  // Seed mode back-dates the writes so the rows lie past the grace period and the retention.
  process.env[SEED_MODE_ENV] = "1";
  stack = await setupTestStack({
    features: [
      createTenantHandoverFeature({ grantSecret: SECRET }),
      fixturesFeature,
      createFilesFeature(),
      createDataRetentionFeature(),
    ],
    files: { storageProvider: provider },
    jobs: { consumerLane: "worker", getActiveTenantIds: async () => [DEST_TENANT] },
  });
  await unsafeCreateEntityTable(stack.db, carEntity, "car");
});

afterAll(async () => {
  await stack.cleanup();
  if (previousSeedMode === undefined) delete process.env[SEED_MODE_ENV];
  else process.env[SEED_MODE_ENV] = previousSeedMode;
});

beforeEach(async () => {
  stack.events.reset();
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, kumiko_snapshots, kumiko_event_consumers, handover_erasure_car, file_refs RESTART IDENTITY CASCADE`,
  );
  await stack.eventDispatcher?.ensureRegistered();
});

type SeededCar = {
  readonly carId: string;
  readonly fileId: string;
  readonly storageKey: string;
  readonly derivativeKey: string;
};

// A car in the source tenant with a photo whose bytes (original and one derivative) carry the
// source tenant's key prefix.
async function seedCarWithPhoto(): Promise<SeededCar> {
  const user = createSystemUser(SOURCE_TENANT);
  const db = createTenantDb({ db: stack.db, tenantId: SOURCE_TENANT, mode: "system" });
  const car = await carCrud.create({ name: "my car" }, user, db);
  if (!car.isSuccess) throw new Error(`car create failed: ${car.error.message}`);
  const carId = String(car.data.id);
  const storageKey = `${SOURCE_TENANT}/car/${carId}/photo/front.jpg`;
  const derivativeKey = deriveKey(storageKey, DERIVATIVE_SUFFIX);
  await provider.write(storageKey, new Uint8Array([1, 2, 3]), "image/jpeg");
  await provider.write(derivativeKey, new Uint8Array([4, 5]), "image/jpeg");
  const fileRef = await fileRefCrud.create(
    {
      storageKey,
      fileName: "front.jpg",
      mimeType: "image/jpeg",
      size: 3,
      entityType: "car",
      entityId: carId,
      fieldName: "photo",
    },
    user,
    db,
  );
  if (!fileRef.isSuccess) throw new Error(`fileRef create failed: ${fileRef.error.message}`);
  const fileId = String(fileRef.data.id);
  const linked = await carCrud.update({ id: carId, changes: { photo: fileId } }, user, db, {
    skipOptimisticLock: true,
  });
  if (!linked.isSuccess) throw new Error(`photo link failed: ${linked.error.message}`);
  return { carId, fileId, storageKey, derivativeKey };
}

async function claimToDestination(carId: string): Promise<void> {
  const grant = signTenantHandoverGrant({
    entityType: "car",
    rowId: carId,
    sourceTenantId: SOURCE_TENANT,
    ttlMinutes: 30,
    secret: SECRET,
  });
  const dest = createTestUser({ id: nextUserId++, tenantId: DEST_TENANT, roles: ["User"] });
  const data = await stack.http.writeOk<{ movedEntities: Record<string, number> }>(
    CLAIM,
    { token: grant.token, entityType: "car" },
    dest,
  );
  expect(data.movedEntities).toEqual({ car: 1, fileRef: 1 });
}

async function fileRefTenant(id: string): Promise<string | undefined> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT tenant_id AS "tenantId" FROM file_refs WHERE id = $1`,
    [id],
  )) as Array<{ tenantId: string }>;
  return rows[0]?.tenantId;
}

async function runJob(name: string): Promise<void> {
  const jobRunner = stack.jobRunner;
  if (!jobRunner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");
  await jobRunner.dispatch(name, {});
  await stack.drainJobs();
}

function daysAgo(days: number): Temporal.Instant {
  return Temporal.Now.instant().subtract({ hours: days * 24 });
}

describe("tenant-handover :: erasure of a claimed file's bytes", () => {
  test("soft-delete cleanup in the destination tenant deletes bytes under the source prefix", async () => {
    // Every event of the fileRef stream is back-dated, in ascending time.
    const car = await runSeedWritesAt(daysAgo(410), seedCarWithPhoto);
    await runSeedWritesAt(daysAgo(405), () => claimToDestination(car.carId));
    expect(await fileRefTenant(car.fileId)).toBe(DEST_TENANT);

    const owner = createTestUser({ id: nextUserId++, tenantId: DEST_TENANT, roles: ["Admin"] });
    const token = await stack.jwt.sign(owner);
    await runSeedWritesAt(daysAgo(400), async () => {
      const deleted = await stack.app.request(`/api/files/${car.fileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(deleted.status).toBe(200);
    });

    await runJob(SOFT_DELETE_CLEANUP_JOB);

    expect(provider.keys()).not.toContain(car.storageKey);
    expect(provider.keys()).not.toContain(car.derivativeKey);
    expect(await fileRefTenant(car.fileId)).toBeUndefined();
  });

  test("hardDelete retention in the destination tenant deletes bytes under the source prefix", async () => {
    const car = await runSeedWritesAt(daysAgo(60), seedCarWithPhoto);
    await claimToDestination(car.carId);

    await runJob(RETENTION_CLEANUP_JOB);

    expect(provider.keys()).not.toContain(car.storageKey);
    expect(provider.keys()).not.toContain(car.derivativeKey);
    expect(await fileRefTenant(car.fileId)).toBeUndefined();
    const cars = await asRawClient(stack.db).unsafe(
      `SELECT id FROM handover_erasure_car WHERE id = $1`,
      [car.carId],
    );
    expect(cars).toHaveLength(0);
  });
});
