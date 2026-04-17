import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { z } from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { defineFeature, type SaveContext } from "../../engine";
import {
  createEntityTable,
  createTestRedis,
  setupTestStack,
  sharedItemEntity,
  sharedItemTable,
  type TestRedis,
  type TestStack,
  TestUsers,
} from "../../testing";
import { createEventDedup } from "../event-dedup";

// --- Feature ---

const postSaveLog: SaveContext[] = [];

const dedupFeature = defineFeature("dedup", (r) => {
  r.entity("item", sharedItemEntity);

  r.writeHandler(
    "item:create",
    z.object({ name: z.string() }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(sharedItemTable, sharedItemEntity, {
        entityName: "item",
      });
      return crud.create(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  r.writeHandler(
    "item:update",
    z.object({
      id: z.uuid(),
      version: z.number().optional(),
      changes: z.record(z.string(), z.unknown()),
    }),
    async (event, ctx) => {
      const crud = createEventStoreExecutor(sharedItemTable, sharedItemEntity, {
        entityName: "item",
      });
      return crud.update(event.payload, event.user, ctx.db);
    },
    { access: { roles: ["Admin"] } },
  );

  r.hook("postSave", "item:create", async (result) => {
    postSaveLog.push(result);
  });

  r.hook("postSave", "item:update", async (result) => {
    postSaveLog.push(result);
  });
});

// --- Setup ---

let stack: TestStack;
let testRedis: TestRedis;
const admin = TestUsers.admin;

beforeAll(async () => {
  testRedis = await createTestRedis();

  stack = await setupTestStack({
    features: [dedupFeature],
    systemHooks: [],
  });

  await createEntityTable(stack.db.db, sharedItemEntity, "item");
});

afterAll(async () => {
  await stack.cleanup();
  await testRedis.cleanup();
});

beforeEach(() => {
  postSaveLog.length = 0;
});

// =============================================================================
// Dedup at lifecycle level
// =============================================================================

describe("event dedup in lifecycle pipeline", () => {
  test("postSave hooks fire normally (no dedup without eventDedup wired)", async () => {
    await stack.http.writeOk("dedup:write:item:create", { name: "First" }, admin);

    expect(postSaveLog).toHaveLength(1);
    expect(postSaveLog[0]?.data["name"]).toBe("First");
  });

  test("two different creates both fire hooks", async () => {
    await stack.http.writeOk("dedup:write:item:create", { name: "A" }, admin);
    await stack.http.writeOk("dedup:write:item:create", { name: "B" }, admin);

    expect(postSaveLog).toHaveLength(2);
  });

  test("two updates on same entity fire both hooks (different versions)", async () => {
    const created = await stack.http.writeOk(
      "dedup:write:item:create",
      { name: "Versioned" },
      admin,
    );
    postSaveLog.length = 0;

    await stack.http.writeOk(
      "dedup:write:item:update",
      { id: created["id"], version: 1, changes: { name: "V2" } },
      admin,
    );
    await stack.http.writeOk(
      "dedup:write:item:update",
      { id: created["id"], version: 2, changes: { name: "V3" } },
      admin,
    );

    // Both updates should fire — version makes eventId unique
    expect(postSaveLog).toHaveLength(2);
    expect(postSaveLog[0]?.data["version"]).toBe(2);
    expect(postSaveLog[1]?.data["version"]).toBe(3);
  });
});

// =============================================================================
// Dedup guard direct test (lifecycle-level dedup behavior)
// =============================================================================

describe("event dedup guard blocks duplicate hook execution", () => {
  test("tryAcquire prevents second execution for same eventId", async () => {
    const dedup = createEventDedup(testRedis.redis, { ttlSeconds: 10 });

    // Simulate: same handler + entity + version + phase
    const eventId = "dedup.item.create:99:1:postSave";

    expect(await dedup.tryAcquire(eventId)).toBe(true); // first: proceed
    expect(await dedup.tryAcquire(eventId)).toBe(false); // duplicate: skip
  });

  test("different versions are independent", async () => {
    const dedup = createEventDedup(testRedis.redis, { ttlSeconds: 10 });

    expect(await dedup.tryAcquire("handler:5:1:postSave")).toBe(true);
    expect(await dedup.tryAcquire("handler:5:2:postSave")).toBe(true); // different version
    expect(await dedup.tryAcquire("handler:5:1:postSave")).toBe(false); // same as first
  });
});
