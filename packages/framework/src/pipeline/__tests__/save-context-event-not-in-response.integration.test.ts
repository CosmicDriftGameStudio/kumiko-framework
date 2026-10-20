import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { sharedItemEntity, sharedItemTable } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.ts";
import { defineFeature, type SaveContext } from "../../engine/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const postSaveEvents: unknown[] = [];

const feature = defineFeature("echo-event", (r) => {
  r.entity({ name: "item", ...sharedItemEntity });
  const executor = () =>
    createEventStoreExecutor(sharedItemTable, sharedItemEntity, { entityName: "item" });

  r.writeHandler({
    name: "item:create",
    schema: z.object({ name: z.string() }),
    handler: async (event, ctx) => executor().create(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
  r.writeHandler({
    name: "item:update",
    schema: z.object({
      id: z.uuid(),
      version: z.number(),
      changes: z.record(z.string(), z.unknown()),
    }),
    handler: async (event, ctx) => executor().update(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
  r.writeHandler({
    name: "item:delete",
    schema: z.object({ id: z.uuid() }),
    handler: async (event, ctx) => executor().delete(event.payload, event.user, ctx.db),
    access: { roles: ["Admin"] },
  });
  for (const target of ["item:create", "item:update"]) {
    r.hook({
      type: "postSave",
      target,
      handler: async (save: SaveContext) => {
        postSaveEvents.push(save.event);
      },
    });
  }
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, sharedItemEntity, "item");
});

afterAll(async () => {
  await stack.cleanup();
});

describe("SaveContext.event stays out of JSON responses", () => {
  test("create and update responses carry no event, hooks still see it", async () => {
    const created = await stack.http.writeOk(
      "echo-event:write:item:create",
      { name: "Secret" },
      TestUsers.admin,
    );
    expect(created).not.toHaveProperty("event");
    expect(JSON.stringify(created)).not.toContain("eventId");

    const updated = await stack.http.writeOk(
      "echo-event:write:item:update",
      { id: created["id"], version: 1, changes: { name: "Changed" } },
      TestUsers.admin,
    );
    expect(updated).not.toHaveProperty("event");

    const deleted = await stack.http.writeOk(
      "echo-event:write:item:delete",
      { id: created["id"] },
      TestUsers.admin,
    );
    expect(deleted).not.toHaveProperty("event");

    expect(postSaveEvents).toHaveLength(2);
    expect(postSaveEvents.every((e) => e !== undefined)).toBe(true);
  });
});
