// Event payloads keep the microseconds of an instant, the live write stores milliseconds. A rebuild
// that bound the payload string unchanged wrote a different value and reported column drift.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { asRawClient } from "../../db/query.ts";
import {
  createEntity,
  createTextField,
  createTimestampField,
  defineFeature,
} from "../../engine/index.ts";
import { createRegistry } from "../../engine/registry.ts";
import { createArchivedStreamsTable } from "../../event-store/index.ts";
import { rebuildProjection } from "../../pipeline/index.ts";
import { createProjectionStateTable } from "../../pipeline/projection-state.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { createEventStoreExecutor } from "../event-store-executor.ts";
import { buildEntityTable } from "../table-builder.ts";
import { createTenantDb } from "../tenant-db.ts";
import { type BunTestDb, createTestDb } from "./query/bun-test-db.ts";

const deliveryEntity = createEntity({
  table: "read_precision_deliveries",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture" }),
    lastDeliveryAt: createTimestampField({}),
  },
});
const deliveryFeature = defineFeature("precision", (r) => {
  r.entity({ name: "delivery", ...deliveryEntity });
});
const deliveryTable = buildEntityTable("delivery", deliveryEntity);
const INSTANT_WITH_MICROSECONDS = "2026-10-24T17:13:19.104362Z";

let testDb: BunTestDb;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, deliveryEntity, "delivery");
  await createArchivedStreamsTable(testDb.db);
  await createProjectionStateTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

const storedDeliveryTimes = async () =>
  asRawClient(testDb.db).unsafe<{ last_delivery_at: string }>(
    `SELECT last_delivery_at::text FROM read_precision_deliveries`,
  );

describe("projection rebuild of a timestamptz column", () => {
  test("replays an instant with microseconds to the value the live write stored", async () => {
    const admin = TestUsers.admin;
    const tenantDb = createTenantDb({ db: testDb.db, tenantId: admin.tenantId });
    const crud = createEventStoreExecutor(deliveryTable, deliveryEntity, {
      entityName: "delivery",
    });
    const created = await crud.create({ name: "hook" }, admin, tenantDb);
    if (!created.isSuccess) throw new Error("create failed");
    const updated = await crud.update(
      {
        id: created.data.id,
        changes: { lastDeliveryAt: Temporal.Instant.from(INSTANT_WITH_MICROSECONDS) },
      },
      admin,
      tenantDb,
      { skipOptimisticLock: true },
    );
    expect(updated.isSuccess).toBe(true);
    const live = await storedDeliveryTimes();

    const result = await rebuildProjection("precision:projection:delivery-entity", {
      db: testDb.db,
      registry: createRegistry([deliveryFeature]),
    });

    expect(result.columnDriftCount).toBe(0);
    expect(await storedDeliveryTimes()).toEqual(live);
    expect(live[0]?.last_delivery_at).toContain("17:13:19.104+00");
  });
});
