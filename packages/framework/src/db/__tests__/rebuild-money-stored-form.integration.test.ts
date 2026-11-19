// Before the minor-unit API change the executor already converted at the boundary and appended the
// flat column form: `<name>` an integer in minor units plus `<name>Currency`. A rebuild must read
// such an event as it is, without scaling it again.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import {
  createEntity,
  createMoneyField,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { createRegistry } from "../../engine/registry.ts";
import { append, createArchivedStreamsTable } from "../../event-store/index.ts";
import { rebuildProjection } from "../../pipeline/index.ts";
import { createProjectionStateTable } from "../../pipeline/projection-state.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { generateId } from "../../utils/index.ts";
import { createEventStoreExecutor } from "../event-store-executor.ts";
import { entityEventName } from "../event-store-executor-context.ts";
import { buildEntityTable } from "../table-builder.ts";
import { createTenantDb } from "../tenant-db.ts";
import { type BunTestDb, createTestDb } from "./query/bun-test-db.ts";

const depositEntity = createEntity({
  name: "deposit",
  table: "read_money_form_deposits",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture" }),
    amount: createMoneyField({}),
  },
});
const depositFeature = defineFeature("moneyform", (r) => {
  r.entity(depositEntity);
});
const depositTable = buildEntityTable(depositEntity);

let testDb: BunTestDb;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, depositEntity, "deposit");
  await createArchivedStreamsTable(testDb.db);
  await createProjectionStateTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

describe("projection rebuild of a money field stored in the previous release's event form", () => {
  test("a created event with 45000 + EUR rebuilds to 450.00 EUR", async () => {
    const admin = TestUsers.admin;
    const id = generateId();
    await append(testDb.db, {
      aggregateId: id,
      aggregateType: "deposit",
      tenantId: admin.tenantId,
      expectedVersion: 0,
      type: entityEventName("deposit", "created"),
      payload: { label: "Kaution", amount: 45000, amountCurrency: "EUR" },
      metadata: { userId: String(admin.id) },
    });

    const result = await rebuildProjection("moneyform:projection:deposit-entity", {
      db: testDb.db,
      registry: createRegistry([depositFeature]),
    });
    expect(result.columnDriftCount).toBe(0);

    const crud = createEventStoreExecutor(depositTable, depositEntity, { entityName: "deposit" });
    const row = await crud.detail(
      { id },
      admin,
      createTenantDb({ db: testDb.db, tenantId: admin.tenantId }),
    );
    expect(row?.["amount"]).toEqual({ amount: 45000, currency: "EUR" });
  });
});
