// A historical `<entity>.updated` event may carry a field that has since been
// removed from the entity and its table. Replaying it during a projection
// rebuild must drop the unknown column instead of failing the whole rebuild.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createEntity, createTextField, defineFeature } from "../../engine/index.js";
import { append } from "../../event-store/index.js";
import { createProjectionStateTable, rebuildProjection } from "../../pipeline/index.js";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { createEventStoreExecutor } from "../event-store-executor.js";
import { asRawClient } from "../query.js";
import { buildEntityTable } from "../table-builder.js";
import { createTenantDb, type TenantDb } from "../tenant-db.js";

const noteEntity = createEntity({
  table: "read_removed_column_notes",
  fields: {
    title: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const noteTable = buildEntityTable("removed-note", noteEntity);

const feature = defineFeature("removedcol", (r) => {
  r.entity("removed-note", noteEntity);
});

const admin = TestUsers.admin;
const PROJECTION = "removedcol:projection:removed-note-entity";
const AGGREGATE_ID = "00000000-0000-4000-8000-0000000000aa";

let stack: TestStack;
let tdb: TenantDb;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, noteEntity, "removed-note");
  await createProjectionStateTable(stack.db);
  tdb = createTenantDb(stack.db, admin.tenantId);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(
    `TRUNCATE kumiko_events, read_removed_column_notes, kumiko_projections RESTART IDENTITY CASCADE`,
  );
});

async function appendHistoricalEvents(): Promise<void> {
  await append(stack.db, {
    aggregateId: AGGREGATE_ID,
    aggregateType: "removed-note",
    tenantId: admin.tenantId,
    expectedVersion: 0,
    type: "removed-note.created",
    payload: { title: "old", legacyNote: "legacy" },
    metadata: { userId: admin.id },
  });
  await append(stack.db, {
    aggregateId: AGGREGATE_ID,
    aggregateType: "removed-note",
    tenantId: admin.tenantId,
    expectedVersion: 1,
    type: "removed-note.updated",
    payload: {
      changes: { title: "new", legacyNote: "gone" },
      previous: { title: "old", legacyNote: "legacy" },
    },
    metadata: { userId: admin.id },
  });
}

async function readRow(): Promise<{ title: string; version: number } | undefined> {
  const rows = (await asRawClient(stack.db).unsafe(
    `SELECT title, version FROM read_removed_column_notes WHERE id = $1::uuid`,
    [AGGREGATE_ID],
  )) as ReadonlyArray<{ title: string; version: number }>;
  return rows[0];
}

describe("applyEntityEvent — event field no longer on the entity", () => {
  test("rebuild replays created + updated events that carry a removed field", async () => {
    await appendHistoricalEvents();

    const result = await rebuildProjection(PROJECTION, { db: stack.db, registry: stack.registry });

    expect(result.eventsProcessed).toBe(2);
    expect(await readRow()).toMatchObject({ title: "new", version: 2 });
  });

  test("rebuild replays an updated event whose changes only hold removed fields", async () => {
    await append(stack.db, {
      aggregateId: AGGREGATE_ID,
      aggregateType: "removed-note",
      tenantId: admin.tenantId,
      expectedVersion: 0,
      type: "removed-note.created",
      payload: { title: "old" },
      metadata: { userId: admin.id },
    });
    await append(stack.db, {
      aggregateId: AGGREGATE_ID,
      aggregateType: "removed-note",
      tenantId: admin.tenantId,
      expectedVersion: 1,
      type: "removed-note.updated",
      payload: { changes: { legacyNote: "x" }, previous: {} },
      metadata: { userId: admin.id },
    });

    const result = await rebuildProjection(PROJECTION, { db: stack.db, registry: stack.registry });

    expect(result.eventsProcessed).toBe(2);
    expect(await readRow()).toMatchObject({ title: "old", version: 2 });
  });

  test("live update after the rebuild still works", async () => {
    await appendHistoricalEvents();
    await rebuildProjection(PROJECTION, { db: stack.db, registry: stack.registry });

    const executor = createEventStoreExecutor(noteTable, noteEntity, {
      entityName: "removed-note",
    });
    const updated = await executor.update(
      { id: AGGREGATE_ID, version: 2, changes: { title: "live" } },
      admin,
      tdb,
    );

    expect(updated.isSuccess).toBe(true);
    expect(await readRow()).toMatchObject({ title: "live", version: 3 });
  });
});
