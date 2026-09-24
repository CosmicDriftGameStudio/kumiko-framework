// #3043 — event attribution. append() stamps metadata.feature +
// metadata.handler from the ambient execution scope, below every envelope
// builder, so no writer can forget it.
//
// Claims pinned here:
//   1. Dispatch path: an event a write-handler appends carries the handler's
//      qualified name and its owning feature.
//   2. In-process path: the entity-executor's CRUD event carries the SAME
//      attribution although nothing was passed through its signature.
//   3. MSP-apply: an event an apply writes is attributed to the consumer, not
//      to the handler that started the chain.
//   4. No scope: a bare append() stamps the sentinel, never a guess.
//   5. appendRaw stays unstamped — historical rows keep their metadata verbatim
//      and stay readable without the new fields.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { UNATTRIBUTED_ORIGIN, type WriteOrigin } from "@cosmicdrift/kumiko-types/event-store-types";
import { z } from "zod";
import { createEventStoreExecutor } from "../../db/event-store-executor";
import { selectMany } from "../../db/query";
import { buildEntityTable } from "../../db/table-builder";
import { createEntity, createTextField, defineFeature } from "../../engine";
import type { TenantId } from "../../engine/types";
import {
  resetEventStore,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
} from "../../stack";
import { generateId as uuid } from "../../utils";
import { appendRaw } from "../admin-api";
import { append } from "../event-store";
import { eventsTable } from "../events-schema";

const orderEntity = createEntity({
  table: "read_attribution_orders",
  fields: {
    item: createTextField({ personal: false, reason: "test_fixture", required: true }),
  },
});

const orderTable = buildEntityTable("attr-order", orderEntity);

const PLACED = "attribution:event:placed";
const CONFIRMED = "attribution:event:confirmed";
const PROBED = "attribution:event:probed";
const PLACE_HANDLER = "attribution:write:order:place";
const PROBE_HANDLER = "attribution:write:order:probe";
const CONFIRMER_MSP = "attribution:projection:confirmer";
const TENANT_ID = "00000000-0000-4000-8000-000000000002" as TenantId;

const attributionFeature = defineFeature("attribution", (r) => {
  r.entity("attr-order", orderEntity);

  const placed = r.defineEvent("placed", z.object({ orderId: z.uuid() }), { piiFields: "none" });
  const confirmed = r.defineEvent("confirmed", z.object({ orderId: z.uuid() }), {
    piiFields: "none",
  });

  const orderExecutor = createEventStoreExecutor(orderTable, orderEntity, {
    entityName: "attr-order",
  });

  r.writeHandler(
    "order:place",
    z.object({ item: z.string() }),
    async (event, ctx) => {
      const created = await orderExecutor.create({ item: event.payload.item }, event.user, ctx.db);
      if (!created.isSuccess) return created;
      await ctx.unsafeAppendEvent({
        aggregateId: String(created.data.id),
        aggregateType: "attr-order",
        type: placed.name,
        payload: { orderId: String(created.data.id) },
      });
      return created;
    },
    { access: { roles: ["Admin"] } },
  );

  const probed = r.defineEvent("probed", z.object({ orderId: z.uuid() }), { piiFields: "none" });

  // Anonymous, no public-intake declared, no PII field written (nothing to gate).
  r.writeHandler(
    "order:probe",
    z.object({ item: z.string() }),
    async (event, ctx) => {
      const created = await orderExecutor.create({ item: event.payload.item }, event.user, ctx.db);
      if (!created.isSuccess) return created;
      await ctx.unsafeAppendEvent({
        aggregateId: String(created.data.id),
        aggregateType: "attr-order",
        type: probed.name,
        payload: { orderId: String(created.data.id) },
      });
      return created;
    },
    { access: { roles: ["anonymous"] } },
  );

  r.multiStreamProjection({
    name: "confirmer",
    apply: {
      [placed.name]: async (event, _tx, ctx) => {
        if (!ctx) throw new Error("MSP-apply ctx missing — regression of C.2b wiring");
        await ctx.unsafeAppendEvent({
          aggregateId: event.aggregateId,
          aggregateType: "attr-order",
          type: confirmed.name,
          payload: { orderId: event.aggregateId },
        });
      },
    },
  });
});

let stack: TestStack;
const admin = TestUsers.admin;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [attributionFeature],
    systemHooks: [],
    anonymousAccess: { defaultTenantId: TENANT_ID },
  });
  await unsafeCreateEntityTable(stack.db, orderEntity, "attr-order");
});

afterAll(async () => {
  await stack.cleanup();
});

afterEach(async () => {
  await resetEventStore(stack, ["read_attribution_orders"]);
});

type Origin = { feature?: string; handler?: string; writeOrigin?: WriteOrigin };

async function originOf(type: string): Promise<Origin> {
  const rows = await selectMany(stack.db, eventsTable);
  const row = rows.find((r: Record<string, unknown>) => r["type"] === type);
  expect(row).toBeDefined();
  return (row?.["metadata"] ?? {}) as Origin;
}

describe("#3043 — event attribution from the execution scope", () => {
  test("dispatch path: ctx.appendEvent stamps the handler and its feature", async () => {
    await stack.http.writeOk(PLACE_HANDLER, { item: "widget" }, admin);

    expect(await originOf(PLACED)).toMatchObject({
      feature: "attribution",
      handler: PLACE_HANDLER,
    });
  });

  test("in-process path: the entity-executor CRUD event carries the same attribution", async () => {
    await stack.http.writeOk(PLACE_HANDLER, { item: "sprocket" }, admin);

    // Nothing is threaded through createEntityExecutor → EventStoreExecutor.write —
    // the write runs inside the handler's scope, so the stamp finds it anyway.
    expect(await originOf("attr-order.created")).toMatchObject({
      feature: "attribution",
      handler: PLACE_HANDLER,
    });
  });

  test("MSP-apply: the follow-up event is attributed to the consumer, not the trigger", async () => {
    await stack.http.writeOk(PLACE_HANDLER, { item: "gasket" }, admin);
    await stack.eventDispatcher?.runOnce();

    expect(await originOf(CONFIRMED)).toMatchObject({
      feature: "attribution",
      handler: CONFIRMER_MSP,
    });
  });

  test("no scope: a bare append() stamps the sentinel instead of guessing", async () => {
    const aggregateId = uuid();
    await append(stack.db, {
      aggregateId,
      aggregateType: "attr-order",
      tenantId: admin.tenantId,
      expectedVersion: 0,
      type: PLACED,
      payload: { orderId: aggregateId },
      metadata: { userId: admin.id },
    });

    expect(await originOf(PLACED)).toMatchObject({
      feature: UNATTRIBUTED_ORIGIN,
      handler: UNATTRIBUTED_ORIGIN,
    });
  });

  test("authenticated write: the event carries no writeOrigin at all", async () => {
    await stack.http.writeOk(PLACE_HANDLER, { item: "cog" }, admin);

    const origin = await originOf(PLACED);
    expect(origin.writeOrigin).toBeUndefined();
  });

  test("anonymous non-intake write: the event is stamped with the gated origin", async () => {
    const res = await stack.http.raw("POST", "/api/write", {
      type: PROBE_HANDLER,
      payload: { item: "washer" },
    });
    expect(res.status).toBe(200);

    const origin = await originOf(PROBED);
    expect(origin.writeOrigin).toMatchObject({
      rootHandler: PROBE_HANDLER,
      anonymousRoot: true,
      publicIntake: false,
    });
  });

  test("appendRaw keeps historical metadata verbatim and stays readable", async () => {
    const aggregateId = uuid();
    await appendRaw(stack.db, {
      aggregateId,
      aggregateType: "attr-order",
      tenantId: admin.tenantId,
      expectedVersion: 0,
      type: CONFIRMED,
      payload: { orderId: aggregateId },
      metadata: { userId: admin.id },
      createdAt: Temporal.Instant.from("2023-01-15T10:00:00Z"),
      createdBy: admin.id,
    });

    const origin = await originOf(CONFIRMED);
    expect(origin.feature).toBeUndefined();
    expect(origin.handler).toBeUndefined();
  });
});
