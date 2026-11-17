import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import type { SingleStreamApplyFn } from "@cosmicdrift/kumiko-types/projection";
import { z } from "zod";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineFeature,
  defineWriteHandler,
  emitEvent,
  typedPayload,
} from "../../engine/index.ts";
import { rebuildProjection } from "../../pipeline/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { generateDeterministicId } from "../../utils/index.ts";
import { insertProjectedEntityRow, patchProjectedEntityRow } from "../projected-entity-row.ts";
import { selectMany } from "../query.ts";
import { buildEntityTable } from "../table-builder.ts";

const orderEntity = createEntity({
  table: "read_pe_orders",
  fields: {
    customer: createTextField({ personal: false, reason: "is_business_data", required: true }),
  },
});
const receiptEntity = createEntity({
  table: "read_pe_receipts",
  fields: {
    orderId: createTextField({ personal: false, reason: "is_business_data" }),
    note: createTextField({ personal: false, reason: "is_business_data" }),
  },
});
const receiptTable = buildEntityTable("pe-receipt", receiptEntity);
const receipts = { entityName: "pe-receipt", entity: receiptEntity, table: receiptTable };

const admin = TestUsers.admin;

// rowIdOf only sees tenant and aggregate, so a row written from the order stream needs an id
// derived from those to survive a rebuild.
function receiptIdOf(source: { readonly tenantId: string; readonly aggregateId: string }): string {
  return generateDeterministicId("pe-receipt", `${source.tenantId}|${source.aggregateId}`);
}

const peFeature = defineFeature("pe", (r) => {
  r.entity({ name: "pe-order", ...orderEntity });
  r.entity({ name: "pe-receipt", ...receiptEntity });

  const eventShape = z.object({ note: z.string() });
  const paid = r.defineEvent("order-paid", eventShape, { piiFields: "none" });
  const noted = r.defineEvent("order-noted", eventShape, { piiFields: "none" });
  const tagged = r.defineEvent("order-tagged", eventShape.extend({ bogus: z.string() }), {
    piiFields: "none",
  });

  const receiptApply: Record<string, SingleStreamApplyFn> = {
    [paid.name]: async (event, tx) => {
      const p = typedPayload(event, paid);
      await insertProjectedEntityRow(tx, receipts, event, receiptIdOf(event), {
        orderId: event.aggregateId,
        note: p.note,
      });
    },
    [noted.name]: async (event, tx) => {
      const p = typedPayload(event, noted);
      await patchProjectedEntityRow(tx, receipts, event, receiptIdOf(event), { note: p.note });
    },
    [tagged.name]: async (event, tx) => {
      const p = typedPayload(event, tagged);
      // Not a fresh literal: the unknown key reaches the helper at runtime, as a payload spread would.
      const values = { note: p.note, bogus: p.bogus };
      await patchProjectedEntityRow(tx, receipts, event, receiptIdOf(event), values);
    },
  };

  // Live only runs this projection for a foreign stream; the extension repeats the applies with a
  // rowIdOf so the rebuild keeps the row.
  r.projection({
    name: "receipt-from-order",
    source: "pe-order",
    table: receiptTable,
    apply: receiptApply,
  });
  r.extendEntityProjection("pe-receipt", {
    sources: ["pe-order"],
    rowIdOf: receiptIdOf,
    apply: receiptApply,
  });

  r.writeHandler(defineEntityCreateHandler("pe-order", orderEntity, { access: { roles: ["Admin"] } }));

  const eventWrites = [
    ["order:pay", paid],
    ["order:note", noted],
  ] as const;
  for (const [name, def] of eventWrites) {
    r.writeHandler(
      defineWriteHandler({
        name,
        schema: z.object({ id: z.uuid(), note: z.string() }),
        handler: async (event, ctx) => {
          await emitEvent(ctx, def, {
            aggregateId: event.payload.id,
            aggregateType: "pe-order",
            payload: { note: event.payload.note },
          });
          return { isSuccess: true as const, data: { id: event.payload.id } };
        },
        access: { roles: ["Admin"] },
      }),
    );
  }
  r.writeHandler(
    defineWriteHandler({
      name: "order:tag",
      schema: z.object({ id: z.uuid(), note: z.string() }),
      handler: async (event, ctx) => {
        await emitEvent(ctx, tagged, {
          aggregateId: event.payload.id,
          aggregateType: "pe-order",
          payload: { note: event.payload.note, bogus: "x" },
        });
        return { isSuccess: true as const, data: { id: event.payload.id } };
      },
      access: { roles: ["Admin"] },
    }),
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [peFeature] });
  await unsafeCreateEntityTable(stack.db, orderEntity, "pe-order");
  await unsafeCreateEntityTable(stack.db, receiptEntity, "pe-receipt");
});

afterAll(async () => {
  await stack.cleanup();
});

async function receiptRow(id: string): Promise<Record<string, unknown>> {
  const [row] = await selectMany(stack.db, receiptTable, { id });
  if (row === undefined) throw new Error("receipt row missing");
  return row;
}

describe("projected entity row helpers", () => {
  test("insert, patch, guard and rebuild", async () => {
    await resetEventStore(stack, ["read_pe_orders", "read_pe_receipts"]);
    const { id: orderId } = await stack.http.writeOk<{ id: string }>(
      "pe:write:pe-order:create",
      { customer: "Acme" },
      admin,
    );
    const receiptId = receiptIdOf({ tenantId: admin.tenantId, aggregateId: orderId });
    await stack.http.writeOk("pe:write:order:pay", { id: orderId, note: "paid" }, admin);

    const inserted = await receiptRow(receiptId);
    expect(inserted).toMatchObject({
      tenantId: admin.tenantId,
      version: 1,
      insertedById: admin.id,
      orderId,
      note: "paid",
    });
    expect(inserted["insertedAt"]).not.toBeNull();

    await stack.http.writeOk("pe:write:order:note", { id: orderId, note: "noted" }, admin);
    const patched = await receiptRow(receiptId);
    expect(patched["note"]).toBe("noted");
    expect(patched["modifiedById"]).toBe(admin.id);
    expect(patched["version"]).toBe(1);

    const tagRes = await stack.http.write(
      "pe:write:order:tag",
      { id: orderId, note: "tagged" },
      admin,
    );
    expect(tagRes.status).toBeGreaterThanOrEqual(400);
    expect((await receiptRow(receiptId))["note"]).toBe("noted");

    const before = await receiptRow(receiptId);
    await rebuildProjection("pe:projection:pe-receipt-entity", {
      db: stack.db,
      registry: stack.registry,
    });
    const after = await receiptRow(receiptId);
    for (const key of [
      "id",
      "tenantId",
      "version",
      "insertedAt",
      "insertedById",
      "modifiedAt",
      "orderId",
      "note",
    ]) {
      expect(after[key]).toEqual(before[key]);
    }
  });
});
