// createMany / updateMany: every row runs the checks of create/update, all events go into the log
// with one append statement, and the batch commits or fails as a whole.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type { EntityId } from "@cosmicdrift/kumiko-types/identifiers";
import { asRawClient } from "../../db/query.ts";
import { createEntity, createTextField } from "../../engine/index.ts";
import { appendMany } from "../../event-store/append-many.ts";
import { VersionConflictError } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { generateId } from "../../utils/index.ts";
import { createEventStoreExecutor } from "../event-store-executor.ts";
import { buildEventMetadata } from "../event-store-executor-context.ts";
import { buildEntityTable } from "../table-builder.ts";
import { createTenantDb, type TenantDb } from "../tenant-db.ts";

const entity = createEntity({
  table: "read_es_many_items",
  fields: {
    title: createTextField({ required: true, personal: false, reason: "test_fixture" }),
    body: createTextField({ personal: false, reason: "test_fixture" }),
  },
});
const table = buildEntityTable("esManyItem", entity);

let testDb: TestDb;
let tdb: TenantDb;
const admin = TestUsers.admin;

type StoredEventRow = {
  readonly aggregate_id: string;
  readonly type: string;
  readonly version: number;
  readonly payload: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
};

async function eventsOf(aggregateId?: string): Promise<readonly StoredEventRow[]> {
  const client = asRawClient(testDb.db);
  return aggregateId === undefined
    ? client.unsafe<StoredEventRow>(
        `SELECT aggregate_id, type, version, payload, metadata FROM kumiko_events ORDER BY id`,
      )
    : client.unsafe<StoredEventRow>(
        `SELECT aggregate_id, type, version, payload, metadata FROM kumiko_events
         WHERE aggregate_id = $1 ORDER BY id`,
        [aggregateId],
      );
}

async function rowCount(): Promise<number> {
  const rows = await asRawClient(testDb.db).unsafe<{ count: string }>(
    `SELECT count(*)::text AS count FROM read_es_many_items`,
  );
  return Number(rows[0]?.count ?? 0);
}

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, entity, "esManyItem");
  tdb = createTenantDb({ db: testDb.db, tenantId: admin.tenantId });
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_es_many_items RESTART IDENTITY CASCADE`,
  );
});

describe("event-store-executor createMany / updateMany", () => {
  const crud = createEventStoreExecutor(table, entity, { entityName: "esManyItem" });

  async function seedItems(titles: readonly string[]): Promise<readonly EntityId[]> {
    const created = await crud.createMany(
      titles.map((title) => ({ title, body: `body of ${title}` })),
      admin,
      tdb,
    );
    if (!created.isSuccess) throw new Error("seed createMany failed");
    return created.data.map((saved) => saved.id);
  }

  test("createMany writes N rows and N created events with origin metadata", async () => {
    const result = await crud.createMany(
      [{ title: "a" }, { title: "b" }, { title: "c" }],
      admin,
      tdb,
    );
    if (!result.isSuccess) throw new Error("createMany failed");

    expect(result.data.map((saved) => saved.data["title"])).toEqual(["a", "b", "c"]);
    expect(result.data.every((saved) => saved.isNew)).toBe(true);
    expect(await rowCount()).toBe(3);

    const events = await eventsOf();
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event.type).toBe("esManyItem.created");
      expect(event.version).toBe(1);
      expect(typeof event.metadata["feature"]).toBe("string");
      expect(typeof event.metadata["handler"]).toBe("string");
    }
    for (const saved of result.data) expect(saved.data["version"]).toBe(1);
  });

  test("createMany with an explicit id of an existing stream fails as a whole", async () => {
    const [existingId] = await seedItems(["existing"]);
    if (existingId === undefined) throw new Error("no seeded id");
    const eventsBefore = await eventsOf();

    const result = await crud.createMany(
      [{ title: "fresh-1" }, { id: existingId, title: "collision" }, { title: "fresh-2" }],
      admin,
      tdb,
    );

    if (result.isSuccess) throw new Error("expected a failure");
    expect(result.error.code).toBe("version_conflict");
    expect(await rowCount()).toBe(1);
    expect(await eventsOf()).toHaveLength(eventsBefore.length);
  });

  test("updateMany with valid versions updates every row; previous holds only the changed keys", async () => {
    const ids = await seedItems(["one", "two"]);

    const result = await crud.updateMany(
      ids.map((id, index) => ({ id, version: 1, changes: { title: `renamed-${index}` } })),
      admin,
      tdb,
    );
    if (!result.isSuccess) throw new Error("updateMany failed");

    expect(result.data.map((saved) => saved.data["title"])).toEqual(["renamed-0", "renamed-1"]);
    for (const [index, id] of ids.entries()) {
      const events = await eventsOf(String(id));
      const updated = events[1];
      expect(updated?.type).toBe("esManyItem.updated");
      expect(updated?.version).toBe(2);
      expect(updated?.payload["changes"]).toEqual({ title: `renamed-${index}` });
      expect(updated?.payload["previous"]).toEqual({ title: ["one", "two"][index] });
    }
    expect(result.data.every((saved) => saved.data["version"] === 2)).toBe(true);
  });

  test("updateMany with one stale version fails for that id and leaves the other rows unchanged", async () => {
    const [first, second] = await seedItems(["first", "second"]);
    if (first === undefined || second === undefined) throw new Error("no seeded ids");
    const eventsBefore = await eventsOf();

    const result = await crud.updateMany(
      [
        { id: first, version: 1, changes: { title: "first-new" } },
        { id: second, version: 7, changes: { title: "second-new" } },
      ],
      admin,
      tdb,
    );

    if (result.isSuccess) throw new Error("expected a failure");
    expect(result.error.code).toBe("version_conflict");
    expect(JSON.stringify(result.error)).toContain(String(second));
    const rows = await asRawClient(testDb.db).unsafe<{ title: string }>(
      `SELECT title FROM read_es_many_items ORDER BY title`,
    );
    expect(rows.map((row) => row.title)).toEqual(["first", "second"]);
    expect(await eventsOf()).toHaveLength(eventsBefore.length);
  });

  test("updateMany with a duplicate id fails before anything is written", async () => {
    const [id] = await seedItems(["dup"]);
    if (id === undefined) throw new Error("no seeded id");
    const eventsBefore = await eventsOf();

    const result = await crud.updateMany(
      [
        { id, version: 1, changes: { title: "x" } },
        { id, version: 1, changes: { title: "y" } },
      ],
      admin,
      tdb,
    );

    if (result.isSuccess) throw new Error("expected a failure");
    expect(await eventsOf()).toHaveLength(eventsBefore.length);
    const rows = await asRawClient(testDb.db).unsafe<{ title: string }>(
      `SELECT title FROM read_es_many_items`,
    );
    expect(rows.map((row) => row.title)).toEqual(["dup"]);
  });
});

describe("appendMany", () => {
  const crud = createEventStoreExecutor(table, entity, { entityName: "esManyItem" });

  test("a stale expectedVersion throws VersionConflictError and writes none of the batch", async () => {
    const created = await crud.createMany([{ title: "stale" }, { title: "fine" }], admin, tdb);
    if (!created.isSuccess) throw new Error("createMany failed");
    const [stale, fine] = created.data.map((saved) => saved.id);
    if (stale === undefined || fine === undefined) throw new Error("no ids");
    const bumped = await crud.update(
      { id: stale, version: 1, changes: { title: "stale-v2" } },
      admin,
      tdb,
    );
    if (!bumped.isSuccess) throw new Error("update failed");

    const toAppend = (aggregateId: string, expectedVersion: number) => ({
      aggregateId,
      aggregateType: "esManyItem",
      tenantId: admin.tenantId,
      expectedVersion,
      type: "esManyItem.updated",
      payload: { changes: { title: "x" }, previous: {} },
      metadata: buildEventMetadata(admin),
    });

    const error = await appendMany(testDb.db, [
      toAppend(String(stale), 1),
      toAppend(String(fine), 1),
    ]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VersionConflictError);
    if (!(error instanceof VersionConflictError)) throw new Error("unreachable");
    expect(error.aggregateId).toBe(String(stale));
    expect(error.currentVersion).toBe(2);
    expect(await eventsOf(String(fine))).toHaveLength(1);
  });

  test("an unknown stream with a predecessor version conflicts at version 0", async () => {
    const unknownId = generateId();
    const error = await appendMany(testDb.db, [
      {
        aggregateId: unknownId,
        aggregateType: "esManyItem",
        tenantId: admin.tenantId,
        expectedVersion: 3,
        type: "esManyItem.updated",
        payload: {},
        metadata: buildEventMetadata(admin),
      },
    ]).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VersionConflictError);
    if (!(error instanceof VersionConflictError)) throw new Error("unreachable");
    expect(error.currentVersion).toBe(0);
    expect(await eventsOf(unknownId)).toHaveLength(0);
  });
});
