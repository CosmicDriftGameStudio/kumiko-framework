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
import {
  createEntity,
  createRegistry,
  createTextField,
  defineFeature,
} from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { createCascadeDeleteHook } from "../cascade-handler.ts";
import { rebuildProjection } from "../index.ts";

const parentEntity = createEntity({
  table: "read_cascade_rb_parents",
  fields: { name: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const cascadeChildEntity = createEntity({
  table: "read_cascade_rb_cascade_children",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
    parentId: createTextField({ personal: false, reason: "test_fixture" }),
  },
});
const setNullChildEntity = createEntity({
  table: "read_cascade_rb_setnull_children",
  fields: {
    name: createTextField({ personal: false, reason: "test_fixture", required: true }),
    parentId: createTextField({ personal: false, reason: "test_fixture" }),
  },
});
const parentTable = buildEntityTable("rb-parent", parentEntity);
const cascadeChildTable = buildEntityTable("rb-cascade-child", cascadeChildEntity);
const setNullChildTable = buildEntityTable("rb-setnull-child", setNullChildEntity);

const feature = defineFeature("cascaderb", (r) => {
  r.entity({ name: "rb-parent", ...parentEntity });
  r.entity({ name: "rb-cascade-child", ...cascadeChildEntity });
  r.entity({ name: "rb-setnull-child", ...setNullChildEntity });

  r.relation("rb-parent", "cascadeChildren", {
    type: "hasMany",
    target: "rb-cascade-child",
    foreignKey: "parentId",
    onDelete: "cascade",
  });
  r.relation("rb-parent", "setNullChildren", {
    type: "hasMany",
    target: "rb-setnull-child",
    foreignKey: "parentId",
    onDelete: "setNull",
  });

  const parentExecutor = createEventStoreExecutor(parentTable, parentEntity, {
    entityName: "rb-parent",
  });
  const cascadeExecutor = createEventStoreExecutor(cascadeChildTable, cascadeChildEntity, {
    entityName: "rb-cascade-child",
  });
  const setNullExecutor = createEventStoreExecutor(setNullChildTable, setNullChildEntity, {
    entityName: "rb-setnull-child",
  });
  const childSchema = z.object({ name: z.string(), parentId: z.string() });

  r.writeHandler({
    name: "parent:create",
    schema: z.object({ name: z.string() }),
    handler: async (event, ctx) => parentExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
  r.writeHandler({
    name: "parent:delete",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) => parentExecutor.delete(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
    agent: { risk: "high" },
  });
  r.writeHandler({
    name: "cascadechild:create",
    schema: childSchema,
    handler: async (event, ctx) => cascadeExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
  r.writeHandler({
    name: "setnullchild:create",
    schema: childSchema,
    handler: async (event, ctx) => setNullExecutor.create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
});

const CASCADE_CHILD_PROJECTION = "cascaderb:projection:rb-cascade-child-entity";
const SETNULL_CHILD_PROJECTION = "cascaderb:projection:rb-setnull-child-entity";
const admin = TestUsers.admin;
let stack: TestStack;

beforeAll(async () => {
  const tables = new Map([
    ["rb-cascade-child", cascadeChildTable],
    ["rb-setnull-child", setNullChildTable],
  ]);
  const hook = createCascadeDeleteHook(createRegistry([feature]), tables);
  stack = await setupTestStack({
    features: [feature],
    systemHooks: [],
    lifecycleSystemHooks: { preDelete: [hook] },
  });
  await unsafeCreateEntityTable(stack.db, parentEntity, "rb-parent");
  await unsafeCreateEntityTable(stack.db, cascadeChildEntity, "rb-cascade-child");
  await unsafeCreateEntityTable(stack.db, setNullChildEntity, "rb-setnull-child");
});

afterAll(async () => {
  await stack.cleanup();
});

async function createId(qn: string, payload: Record<string, unknown>): Promise<string> {
  const res = await stack.http.writeOk(qn, payload, admin);
  return (res["data"] as { id: string }).id;
}

async function rows(table: typeof parentTable): Promise<readonly Record<string, unknown>[]> {
  return (await selectMany(stack.db, table, {})) as readonly Record<string, unknown>[];
}

describe("cascade delete state after a projection rebuild", () => {
  test("cascade-deleted child stays gone and setNull child keeps a null FK", async () => {
    const parentId = await createId("cascaderb:write:parent:create", { name: "p" });
    const cascadeId = await createId("cascaderb:write:cascadechild:create", {
      name: "c",
      parentId,
    });
    const setNullId = await createId("cascaderb:write:setnullchild:create", {
      name: "s",
      parentId,
    });

    await stack.http.writeOk("cascaderb:write:parent:delete", { id: parentId }, admin);

    expect((await rows(cascadeChildTable)).some((r) => r["id"] === cascadeId)).toBe(false);
    const nulled = (await rows(setNullChildTable)).find((r) => r["id"] === setNullId);
    expect(nulled?.["parentId"]).toBeNull();

    await rebuildProjection(CASCADE_CHILD_PROJECTION, { db: stack.db, registry: stack.registry });
    await rebuildProjection(SETNULL_CHILD_PROJECTION, { db: stack.db, registry: stack.registry });

    expect((await rows(cascadeChildTable)).some((r) => r["id"] === cascadeId)).toBe(false);
    const afterRebuild = (await rows(setNullChildTable)).find((r) => r["id"] === setNullId);
    expect(afterRebuild).toBeDefined();
    expect(afterRebuild?.["parentId"]).toBeNull();
  });
});
