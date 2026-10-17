import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor.js";
import { selectMany } from "../../db/query.js";
import { buildEntityTable } from "../../db/table-builder.js";
import { createEntity, createTextField, defineFeature } from "../../engine/index.js";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";

// Every concurrent write holds a tx on the main pool, then waits at the barrier until all of them
// are inside, then needs a second connection for its outside-tx access. If that access shared the
// main pool, all slots would be held by waiting txs and every request would hang forever.
const MAIN_POOL_MAX = 3;
const CONCURRENT_WRITES = MAIN_POOL_MAX;

const noteEntity = createEntity({
  table: "outside_pool_notes",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const noteTable = buildEntityTable("note", noteEntity);

function createBarrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const allArrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    arrived += 1;
    if (arrived === parties) release();
    return allArrived;
  };
}

let waitForAllWrites = createBarrier(CONCURRENT_WRITES);

const poolFeature = defineFeature("outsidepool", (r) => {
  r.entity({ name: "note", ...noteEntity });
  const crud = createEventStoreExecutor(noteTable, noteEntity, { entityName: "note" });

  r.writeHandler({
    name: "note:via-db-outside-transaction",
    schema: z.object({ label: z.string() }),
    handler: async (event, ctx) => {
      await crud.create({ label: `${event.payload.label}-inside` }, event.user, ctx.db);
      await waitForAllWrites();
      if (!ctx.dbOutsideTransaction) throw new Error("ctx.dbOutsideTransaction missing");
      return crud.create(
        { label: `${event.payload.label}-outside` },
        event.user,
        ctx.dbOutsideTransaction,
      );
    },
    access: { roles: ["Admin"] },
  });

  r.writeHandler({
    name: "note:via-outside-transaction",
    schema: z.object({ label: z.string() }),
    handler: async (event, ctx) => {
      await crud.create({ label: `${event.payload.label}-inside` }, event.user, ctx.db);
      await waitForAllWrites();
      if (!ctx.outsideTransaction) throw new Error("ctx.outsideTransaction missing");
      return ctx.outsideTransaction((txDb) =>
        crud.create({ label: `${event.payload.label}-outside` }, event.user, txDb),
      );
    },
    access: { roles: ["Admin"] },
  });
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [poolFeature],
    dbPoolMax: MAIN_POOL_MAX,
    outsideTransactionPoolMax: 1,
  });
  await unsafeCreateEntityTable(stack.db, noteEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("outside-transaction access with a saturated main pool", () => {
  test.each([
    "outsidepool:write:note:via-db-outside-transaction",
    "outsidepool:write:note:via-outside-transaction",
  ])("%s: concurrent writes holding a tx all complete", async (qualifiedName) => {
    waitForAllWrites = createBarrier(CONCURRENT_WRITES);
    const label = qualifiedName.split(":").at(-1) ?? qualifiedName;

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_WRITES }, (_, index) =>
        stack.http.write(qualifiedName, { label: `${label}-${index}` }, TestUsers.admin),
      ),
    );

    for (const res of results) expect((await res.json()).isSuccess).toBe(true);

    const labels = (await selectMany(stack.db, noteTable)).map((row) => row["label"]);
    for (let index = 0; index < CONCURRENT_WRITES; index++) {
      expect(labels).toContain(`${label}-${index}-outside`);
    }
  });
});
