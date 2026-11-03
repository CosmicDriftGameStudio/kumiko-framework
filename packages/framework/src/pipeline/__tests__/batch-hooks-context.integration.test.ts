import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
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
import { eventsTable } from "../../event-store/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";

const noteEntity = createEntity({
  table: "batch_hook_notes",
  fields: { title: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const noteTable = buildEntityTable("note", noteEntity);

type BatchHookObservation = {
  readonly userId: string;
  readonly tenantId: string;
  readonly savedTitles: readonly string[];
  readonly hasLogger: boolean;
  readonly visibleRowCount: number;
};

const observations: BatchHookObservation[] = [];

const noteFeature = defineFeature("batchhook", (r) => {
  r.entity({ name: "note", ...noteEntity });
  r.writeHandler({
    name: "note:create",
    schema: z.object({ title: z.string().min(1) }),
    handler: async (event, ctx) => {
      const crud = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });
      return crud.create(event.payload, event.user, ctx.db);
    },
    access: { roles: ["Admin"] },
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [noteFeature],
    lifecycleSystemHooks: {
      postSaveBatch: [
        {
          name: "test:observe-batch",
          priority: 0,
          fn: async (saves, ctx) => {
            observations.push({
              userId: ctx.user.id,
              tenantId: ctx.user.tenantId,
              savedTitles: saves.map((save) => String(save.changes["title"])),
              hasLogger: typeof ctx.obs.log.info === "function",
              visibleRowCount: (await selectMany(ctx.db, noteTable)).length,
            });
          },
        },
      ],
    },
  });
  await unsafeCreateEntityTable(stack.db, noteEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  observations.length = 0;
  await resetTestTables(stack.db, [noteTable, eventsTable]);
});

describe("postSaveBatch system hook context", () => {
  test("runs once per batch as the caller, after commit, with a usable db and logger", async () => {
    const admin = TestUsers.admin;
    const res = await stack.http.batch(
      [
        { type: "batchhook:write:note:create", payload: { title: "one" } },
        { type: "batchhook:write:note:create", payload: { title: "two" } },
      ],
      admin,
    );
    expect(res.status).toBe(200);

    expect(observations).toEqual([
      {
        userId: admin.id,
        tenantId: admin.tenantId,
        savedTitles: ["one", "two"],
        hasLogger: true,
        visibleRowCount: 2,
      },
    ]);
  });

  test("a batch without successful saves does not run the hook", async () => {
    const res = await stack.http.batch([], TestUsers.admin);
    expect(res.status).toBe(200);
    expect(observations).toEqual([]);
  });
});
