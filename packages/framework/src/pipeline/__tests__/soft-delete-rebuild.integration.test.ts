import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { selectMany } from "../../db/query.ts";
import { buildEntityTable } from "../../db/table-builder.ts";
import { createEntity, createTextField, defineFeature } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { rebuildProjection } from "../index.ts";

const itemEntity = createEntity({
  table: "read_soft_rebuild_items",
  fields: { label: createTextField({ personal: false, reason: "test_fixture", required: true }) },
  softDelete: true,
});
const itemTable = buildEntityTable("soft-item", itemEntity);

const softFeature = defineFeature("softrebuild", (r) => {
  r.entity({ name: "soft-item", ...itemEntity });
  const executor = createEventStoreExecutor(itemTable, itemEntity, { entityName: "soft-item" });
  const idPayload = z.object({ id: z.uuid() });

  r.writeHandler({
    name: "item:create",
    schema: z.object({ label: z.string() }),
    handler: async (event, ctx) => executor.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
  r.writeHandler({
    name: "item:delete",
    schema: idPayload,
    handler: async (event, ctx) => executor.delete(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
  r.writeHandler({
    name: "item:restore",
    schema: idPayload,
    handler: async (event, ctx) => executor.restore(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
});

const IMPLICIT_PROJECTION = "softrebuild:projection:soft-item-entity";
const admin = TestUsers.admin;
let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [softFeature] });
  await unsafeCreateEntityTable(stack.db, itemEntity, "soft-item");
});

afterAll(async () => {
  await stack.cleanup();
});

async function createItem(label: string): Promise<string> {
  const res = await stack.http.writeOk("softrebuild:write:item:create", { label }, admin);
  return (res["data"] as { id: string }).id;
}

async function rowOf(id: string): Promise<Record<string, unknown>> {
  const rows = (await selectMany(stack.db, itemTable, {})) as readonly Record<string, unknown>[];
  const row = rows.find((candidate) => candidate["id"] === id);
  if (row === undefined) throw new Error(`row ${id} missing`);
  return row;
}

async function rebuildEntityTable(): Promise<number> {
  const result = await rebuildProjection(IMPLICIT_PROJECTION, {
    db: stack.db,
    registry: stack.registry,
  });
  return result.eventsProcessed;
}

describe("soft-delete state after a projection rebuild", () => {
  test("a soft-deleted row keeps deletedAt, deletedById and version", async () => {
    const id = await createItem("deleted");
    await stack.http.writeOk("softrebuild:write:item:delete", { id }, admin);
    const before = await rowOf(id);
    expect(before["isDeleted"]).toBe(true);

    expect(await rebuildEntityTable()).toBeGreaterThanOrEqual(2);

    expect(await rowOf(id)).toEqual(before);
  });

  test("a restored row keeps its cleared deletion state and version", async () => {
    const id = await createItem("restored");
    await stack.http.writeOk("softrebuild:write:item:delete", { id }, admin);
    await stack.http.writeOk("softrebuild:write:item:restore", { id }, admin);
    const before = await rowOf(id);
    expect(before["isDeleted"]).toBe(false);
    expect(before["deletedAt"]).toBeNull();

    expect(await rebuildEntityTable()).toBeGreaterThanOrEqual(3);

    expect(await rowOf(id)).toEqual(before);
  });
});
