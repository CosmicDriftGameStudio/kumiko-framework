// calendarCapReservationHandle over real HTTP: a handler reserves, later requests consume per unit.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createEntityExecutor,
  defineFeature,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import {
  calendarCapReservationHandle,
  reserveCalendarCapUsage,
} from "../calendar-cap-usage-reservation.js";
import { settleCalendarCapReservation } from "../cap-reservation.js";
import { CapCounterQueries } from "../constants.js";
import { capCounterEntity } from "../entity.js";
import { capCounterFeature } from "../feature.js";
import { capReservationsTable } from "../tables.js";

const PERIOD = "2026-09-01T00:00:00Z";

const { table: capCounterTable } = createEntityExecutor("cap-counter", capCounterEntity);

const reservePayload = z.object({
  capName: z.string(),
  limit: z.number(),
  amount: z.number().int().min(1),
});
const handlePayload = z.object({
  capName: z.string(),
  reservationId: z.string(),
  units: z.number().int().min(1),
});
const releasePayload = handlePayload.omit({ units: true });
const settlePayload = releasePayload.extend({
  actual: z.number().int().min(0),
  reserved: z.number().int().min(1),
});

const capHandleFeature = defineFeature("caphandle", (r) => {
  r.writeHandler({
    name: "reserve",
    schema: reservePayload,
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) => {
      const payload = reservePayload.parse(event.payload);
      const reservation = await reserveCalendarCapUsage(ctx, {
        capName: payload.capName,
        periodStartIso: PERIOD,
        limit: payload.limit,
        profile: "hardSlot",
        amount: payload.amount,
      });
      return { isSuccess: true as const, data: { reservationId: reservation.reservationId } };
    },
  } satisfies WriteHandlerDef);
  r.writeHandler({
    name: "consume",
    schema: handlePayload,
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) => {
      const payload = handlePayload.parse(event.payload);
      await calendarCapReservationHandle(ctx, payload.reservationId, {
        capName: payload.capName,
        periodStartIso: PERIOD,
      }).consume(payload.units);
      return { isSuccess: true as const, data: {} };
    },
  } satisfies WriteHandlerDef);
  r.writeHandler({
    name: "release",
    schema: releasePayload,
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) => {
      const payload = releasePayload.parse(event.payload);
      await calendarCapReservationHandle(ctx, payload.reservationId, {
        capName: payload.capName,
        periodStartIso: PERIOD,
      }).release();
      return { isSuccess: true as const, data: {} };
    },
  } satisfies WriteHandlerDef);
  r.writeHandler({
    name: "settle",
    schema: settlePayload,
    access: { roles: ["TenantAdmin"] },
    handler: async (event, ctx) => {
      const payload = settlePayload.parse(event.payload);
      await settleCalendarCapReservation(ctx, payload.reservationId, {
        capName: payload.capName,
        periodStartIso: PERIOD,
        actualAmount: payload.actual,
        reservedAmount: payload.reserved,
      });
      return { isSuccess: true as const, data: {} };
    },
  } satisfies WriteHandlerDef);
});

const RESERVE_QN = "caphandle:write:reserve";
const CONSUME_QN = "caphandle:write:consume";
const RELEASE_QN = "caphandle:write:release";
const SETTLE_QN = "caphandle:write:settle";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [capCounterFeature, capHandleFeature] });
  await unsafeCreateEntityTable(stack.db, capCounterEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [capCounterTable, eventsTable, capReservationsTable]);
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin"],
  });
}

async function readCounterValue(
  user: ReturnType<typeof adminFor>,
  capName: string,
): Promise<number | undefined> {
  const row = await stack.http.queryOk<{ value: number } | null>(
    CapCounterQueries.getCounter,
    { capName, periodStartIso: PERIOD },
    user,
  );
  return row === null ? undefined : row.value;
}

async function reserve(user: ReturnType<typeof adminFor>, capName: string, amount: number) {
  const data = await stack.http.writeOk<{ reservationId: string }>(
    RESERVE_QN,
    { capName, limit: 10, amount },
    user,
  );
  return data.reservationId;
}

describe("calendarCapReservationHandle", () => {
  test("two parallel reservations just below the hard cap yield exactly one cap_exceeded", async () => {
    const user = adminFor(3201);

    const outcomes = await Promise.all(
      Array.from({ length: 2 }, async () => {
        const response = await stack.http.write(
          RESERVE_QN,
          { capName: "race-cap", limit: 10, amount: 9 },
          user,
        );
        const body = (await response.json()) as { error?: { code: string } };
        return { status: response.status, code: body.error?.code };
      }),
    );

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([200, 429]);
    expect(outcomes.filter((outcome) => outcome.code === "cap_exceeded")).toHaveLength(1);
    expect(await readCounterValue(user, "race-cap")).toBe(9);
  });

  test("partial consume then release raises the counter only by the consumed units", async () => {
    const user = adminFor(3202);
    const reservationId = await reserve(user, "partial-cap", 5);
    expect(await readCounterValue(user, "partial-cap")).toBe(5);

    await stack.http.writeOk(CONSUME_QN, { capName: "partial-cap", reservationId, units: 1 }, user);
    await stack.http.writeOk(CONSUME_QN, { capName: "partial-cap", reservationId, units: 1 }, user);
    expect(await readCounterValue(user, "partial-cap")).toBe(5);

    await stack.http.writeOk(RELEASE_QN, { capName: "partial-cap", reservationId }, user);
    expect(await readCounterValue(user, "partial-cap")).toBe(2);

    await stack.http.writeOk(RELEASE_QN, { capName: "partial-cap", reservationId }, user);
    expect(await readCounterValue(user, "partial-cap")).toBe(2);
  });

  test("consume beyond the reserved rest is rejected and changes nothing", async () => {
    const user = adminFor(3203);
    const reservationId = await reserve(user, "over-cap", 3);
    await stack.http.writeOk(CONSUME_QN, { capName: "over-cap", reservationId, units: 2 }, user);

    const rejected = await stack.http.writeErr(
      CONSUME_QN,
      { capName: "over-cap", reservationId, units: 2 },
      user,
    );

    expect(rejected.httpStatus).toBe(422);
    expect(await readCounterValue(user, "over-cap")).toBe(3);
    await stack.http.writeOk(CONSUME_QN, { capName: "over-cap", reservationId, units: 1 }, user);
    await stack.http.writeOk(RELEASE_QN, { capName: "over-cap", reservationId }, user);
    expect(await readCounterValue(user, "over-cap")).toBe(3);
  });

  test("consume after the TTL sweep books the units on top of the freed capacity", async () => {
    const user = adminFor(3204);
    const reservationId = await reserve(user, "ttl-cap", 3);
    await updateMany(
      stack.db,
      capReservationsTable,
      { expiresAt: Temporal.Now.instant().subtract({ minutes: 1 }) },
      { tenantId: testTenantId(3204), capName: "ttl-cap" },
    );
    await reserve(user, "ttl-cap", 1);
    expect(await readCounterValue(user, "ttl-cap")).toBe(1);

    await stack.http.writeOk(CONSUME_QN, { capName: "ttl-cap", reservationId, units: 1 }, user);
    await stack.http.writeOk(CONSUME_QN, { capName: "ttl-cap", reservationId, units: 1 }, user);

    expect(await readCounterValue(user, "ttl-cap")).toBe(3);
  });

  test("consume after a settle is rejected, release gives nothing back", async () => {
    const user = adminFor(3205);
    const reservationId = await reserve(user, "settled-cap", 4);
    await stack.http.writeOk(
      SETTLE_QN,
      { capName: "settled-cap", reservationId, actual: 2, reserved: 4 },
      user,
    );
    expect(await readCounterValue(user, "settled-cap")).toBe(2);

    const rejected = await stack.http.writeErr(
      CONSUME_QN,
      { capName: "settled-cap", reservationId, units: 1 },
      user,
    );
    await stack.http.writeOk(RELEASE_QN, { capName: "settled-cap", reservationId }, user);

    expect(rejected.httpStatus).toBe(422);
    expect(await readCounterValue(user, "settled-cap")).toBe(2);
  });

  test("settle after a partial consume books the total once and rejects less than consumed", async () => {
    const user = adminFor(3206);
    const reservationId = await reserve(user, "total-cap", 5);
    await stack.http.writeOk(CONSUME_QN, { capName: "total-cap", reservationId, units: 3 }, user);

    const tooLow = await stack.http.writeErr(
      SETTLE_QN,
      { capName: "total-cap", reservationId, actual: 2, reserved: 5 },
      user,
    );
    expect(tooLow.httpStatus).toBe(422);
    expect(await readCounterValue(user, "total-cap")).toBe(5);

    await stack.http.writeOk(
      SETTLE_QN,
      { capName: "total-cap", reservationId, actual: 5, reserved: 5 },
      user,
    );
    expect(await readCounterValue(user, "total-cap")).toBe(5);
  });
});
