import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { buildEntityTable, selectMany, table, text, uuid } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { setupTestStack, type TestStack, unsafeCreateEntityTable } from "../../stack/index.ts";
import { resetTestTables } from "../db-cleanup.ts";
import { seedRowViaEventStore } from "../event-store-writes.ts";

const gadgetEntity = createEntity({
  table: "read_seed_via_es_gadgets",
  fields: {
    label: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});
const gadgetTable = buildEntityTable("seed-gadget", gadgetEntity);
const plainTable = table("store_seed_via_es_plain", {
  id: uuid("id").primaryKey(),
  label: text("label"),
});

const feature = defineFeature("seedviaes", (r) => {
  r.entity({ name: "seed-gadget", ...gadgetEntity });
});

const TENANT_ID = "00000000-0000-4000-8000-00000000a001";
const GADGET_ID = "00000000-0000-4000-8000-00000000b001";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, gadgetEntity, "seed-gadget");
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [gadgetTable, eventsTable]);
});

describe("seedRowViaEventStore", () => {
  test("writes the created event on the row's tenant and projects the row", async () => {
    await seedRowViaEventStore(stack.db, gadgetTable, {
      id: GADGET_ID,
      tenantId: TENANT_ID,
      label: "first",
    });

    const rows = await selectMany<Record<string, unknown>>(stack.db, gadgetTable, {});
    expect(rows).toMatchObject([
      { id: GADGET_ID, tenantId: TENANT_ID, label: "first", version: 1 },
    ]);
    const events = await selectMany<Record<string, unknown>>(stack.db, eventsTable, {
      aggregateId: GADGET_ID,
    });
    expect(events).toMatchObject([{ type: "seed-gadget.created", tenantId: TENANT_ID }]);
  });

  test("throws for a table that is not an event-sourced entity table", async () => {
    await expect(seedRowViaEventStore(stack.db, plainTable, { label: "x" })).rejects.toThrow(
      /not an event-sourced entity table/,
    );
  });

  test("throws for a non-string id instead of minting a new one", async () => {
    await expect(
      seedRowViaEventStore(stack.db, gadgetTable, { id: 7, label: "x" }),
    ).rejects.toThrow(/id must be a string/);
  });

  test("throws when the executor rejects the row", async () => {
    await seedRowViaEventStore(stack.db, gadgetTable, { id: GADGET_ID, label: "first" });

    await expect(
      seedRowViaEventStore(stack.db, gadgetTable, { id: GADGET_ID, label: "again" }),
    ).rejects.toThrow(/seed seed-gadget failed: version_conflict/);
  });
});
