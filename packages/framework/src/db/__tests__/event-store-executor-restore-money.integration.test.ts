// Restore read the soft-deleted row raw: money columns carried bigint minor
// units into payload.previous and JSON.stringify threw on the jsonb bind (500).
// delete() builds `previous` from the rehydrated domain form; restore must match.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createEntity, createMoneyField, defineFeature } from "../../engine/index.js";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack/index.js";
import { createEventStoreExecutor } from "../event-store-executor.js";
import { buildEntityTable } from "../table-builder.js";

const ledgerEntity = createEntity({
  table: "read_restore_money_entries",
  fields: { grossTotal: createMoneyField() },
  softDelete: true,
});
const ledgerTable = buildEntityTable("ledger-entry", ledgerEntity);

const ledgerFeature = defineFeature("restoremoney", (r) => {
  r.entity("ledger-entry", ledgerEntity);
  const executor = createEventStoreExecutor(ledgerTable, ledgerEntity, {
    entityName: "ledger-entry",
  });

  r.writeHandler(
    "entry:create",
    z.object({ grossTotal: z.object({ amount: z.number(), currency: z.string() }) }),
    async (event, ctx) => executor.create(event.payload, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );
  r.writeHandler(
    "entry:delete",
    z.object({ id: z.uuid() }),
    async (event, ctx) => executor.delete({ id: event.payload.id }, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );
  r.writeHandler(
    "entry:restore",
    z.object({ id: z.uuid() }),
    async (event, ctx) => executor.restore({ id: event.payload.id }, event.user, ctx.db),
    { access: { roles: ["Admin"] } },
  );
  r.queryHandler(
    "entry:events",
    z.object({ id: z.uuid() }),
    async (query, ctx) => ctx.loadAggregate(query.payload.id),
    { access: { openToAll: { reason: "test handler callable by any signed-in test user" } } },
  );
});

type StoredEventView = { readonly type: string; readonly payload: Record<string, unknown> };

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({ features: [ledgerFeature], systemHooks: [] });
  await unsafeCreateEntityTable(stack.db, ledgerEntity, "ledger-entry");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_restore_money_entries"]);
});

describe("event-store-executor restore — money in payload.previous", () => {
  test("restoring a soft-deleted row with a money field succeeds and previous matches the delete event", async () => {
    const { id } = await stack.http.writeOk<{ id: string }>(
      "restoremoney:write:entry:create",
      { grossTotal: { amount: 1500, currency: "EUR" } },
      admin,
    );
    await stack.http.writeOk("restoremoney:write:entry:delete", { id }, admin);

    const restore = await stack.http.write("restoremoney:write:entry:restore", { id }, admin);
    expect(restore.status).toBe(200);

    const events = await stack.http.queryOk<StoredEventView[]>(
      "restoremoney:query:entry:events",
      { id },
      admin,
    );
    const deleted = events.find((e) => e.type.endsWith(".deleted"));
    const restored = events.find((e) => e.type.endsWith(".restored"));
    if (!deleted || !restored) throw new Error("expected deleted and restored events");

    const deletedPrevious = deleted.payload["previous"] as Record<string, unknown>;
    const restoredPrevious = restored.payload["previous"] as Record<string, unknown>;
    expect(restoredPrevious["grossTotal"]).toEqual({
      amount: 1500,
      currency: "EUR",
      amountScaled: 150000,
      amountMinor: 150000,
    });
    expect(restoredPrevious["grossTotal"]).toEqual(deletedPrevious["grossTotal"]);
    expect("grossTotalCurrency" in restoredPrevious).toBe(false);
  });
});
