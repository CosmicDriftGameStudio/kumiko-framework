// reserveCalendarCapUsage over real HTTP and the job runner: exact limit under parallel reserves,
// settle against actual usage, swept rows, systemScope handlers, tenant stamping, tenant isolation.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { insertOne } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  createSystemUser,
  defineFeature,
  type HandlerContext,
  type TenantId,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { bookCapUsage } from "../book-cap-usage.js";
import { reserveCalendarCapUsage } from "../calendar-cap-usage-reservation.js";
import {
  releaseCapReservation,
  reserveCalendarCap,
  settleCalendarCapReservation,
} from "../cap-reservation.js";
import { CapCounterQueries } from "../constants.js";
import { CAP_TOLERANCES, type SoftHitNotifier } from "../enforce-cap.js";
import { capCounterEntity } from "../entity.js";
import { capCounterFeature } from "../feature.js";
import { capReservationsTable } from "../tables.js";
import { withCapEnforcement } from "../with-cap-enforcement.js";

const PERIOD = "2026-09-01T00:00:00Z";

const { table: capCounterTable } = createEntityExecutor("cap-counter", capCounterEntity);

const reservePayload = z.object({
  capName: z.string(),
  limit: z.number(),
  amount: z.number().int().min(1),
  actual: z.number().int().min(0),
  outsideTransaction: z.boolean().optional(),
  expireAndSweepFirst: z.boolean().optional(),
});
type ReservePayload = z.infer<typeof reservePayload>;

// Runs between reserve and settle, so a test can age the row and let another request sweep it.
let betweenReserveAndSettle: ((payload: ReservePayload) => Promise<void>) | undefined;

const softHits: string[] = [];
const recordingNotifier: SoftHitNotifier = (info) => {
  softHits.push(`${info.tenantId}:${info.capName}`);
};

function reserveSettleHandler(name: string): WriteHandlerDef {
  return {
    name,
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
        ...(payload.outsideTransaction !== undefined && {
          outsideTransaction: payload.outsideTransaction,
        }),
      });
      await betweenReserveAndSettle?.(payload);
      await reservation.settle(payload.actual);
      return { isSuccess: true as const, data: { counterValue: reservation.counterValue } };
    },
  };
}

const wrappedStoragePayload = z.object({ amount: z.number().int().min(1) });
const STORAGE_CAP = "sys-wrapper-cap";
const wrappedStorageHandler = withCapEnforcement(
  {
    name: "wrapped-storage",
    schema: wrappedStoragePayload,
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  },
  (event) => ({
    capName: STORAGE_CAP,
    periodStartIso: PERIOD,
    limit: 100,
    profile: "storage",
    amount: wrappedStoragePayload.parse(event.payload).amount,
    notify: recordingNotifier,
  }),
);

const otherTenantPayload = z.object({ otherTenantId: z.string(), capName: z.string() });

// Same context shape the metering caller builds: another tenant's user on the caller's system-mode dbs.
function otherTenantContext(ctx: HandlerContext, otherTenantId: string): HandlerContext {
  if (!ctx.systemDb) throw new Error("expected a systemScope handler");
  const { systemDb, ...rest } = ctx;
  return {
    ...rest,
    user: createSystemUser(otherTenantId as TenantId),
    db: systemDb.acknowledgeCrossTenant("cap-counter reservation test"),
    dbOutsideTransaction: systemDb.outsideTransaction.acknowledgeCrossTenant(
      "cap-counter reservation test",
    ),
  };
}

const reserveForOtherTenantHandler: WriteHandlerDef = {
  name: "reserve-for-other-tenant",
  schema: otherTenantPayload,
  access: { roles: ["TenantAdmin"] },
  handler: async (event, ctx) => {
    const payload = otherTenantPayload.parse(event.payload);
    await reserveCalendarCapUsage(otherTenantContext(ctx, payload.otherTenantId), {
      capName: payload.capName,
      periodStartIso: PERIOD,
      limit: 100,
      profile: "hardSlot",
      amount: 2,
    });
    return { isSuccess: true as const, data: {} };
  },
};

const foreignRowPayload = z.object({
  otherTenantId: z.string(),
  reservationId: z.string(),
  capName: z.string(),
});
const settleForeignRowHandler: WriteHandlerDef = {
  name: "settle-foreign-row",
  schema: foreignRowPayload,
  access: { roles: ["TenantAdmin"] },
  handler: async (event, ctx) => {
    const payload = foreignRowPayload.parse(event.payload);
    const otherCtx = otherTenantContext(ctx, payload.otherTenantId);
    await releaseCapReservation(otherCtx, payload.reservationId);
    await settleCalendarCapReservation(otherCtx, payload.reservationId, {
      capName: payload.capName,
      periodStartIso: PERIOD,
      actualAmount: 1,
    });
    return { isSuccess: true as const, data: {} };
  },
};

const lifecyclePayload = z.object({
  capName: z.string(),
  amount: z.number().int().min(1),
  actual: z.number().int().min(0),
  scenario: z.enum([
    "settle-twice",
    "settle-then-release",
    "release-then-settle-twice",
    "settle-once",
    "settle-parallel",
    "release-then-settle-parallel",
  ]),
});

// Drives the low-level settle/release directly: the handle's in-memory state would reject a second
// settle before it reaches the row logic under test.
const settleLifecycleHandler: WriteHandlerDef = {
  name: "settle-lifecycle",
  schema: lifecyclePayload,
  access: { roles: ["TenantAdmin"] },
  handler: async (event, ctx) => {
    const payload = lifecyclePayload.parse(event.payload);
    const reservation = await reserveCalendarCap(ctx, {
      capName: payload.capName,
      periodStartIso: PERIOD,
      amount: payload.amount,
    });
    const settle = () =>
      settleCalendarCapReservation(ctx, reservation.reservationId, {
        capName: payload.capName,
        periodStartIso: PERIOD,
        actualAmount: payload.actual,
      });
    if (
      payload.scenario === "release-then-settle-twice" ||
      payload.scenario === "release-then-settle-parallel"
    ) {
      await releaseCapReservation(ctx, reservation.reservationId);
    }
    if (
      payload.scenario === "settle-parallel" ||
      payload.scenario === "release-then-settle-parallel"
    ) {
      await Promise.all([settle(), settle()]);
    } else {
      await settle();
    }
    if (payload.scenario === "settle-twice" || payload.scenario === "release-then-settle-twice") {
      await settle();
    }
    if (payload.scenario === "settle-then-release") {
      await reservation.release();
      await releaseCapReservation(ctx, reservation.reservationId);
    }
    return { isSuccess: true as const, data: {} };
  },
};

const jobPayload = z.object({ capName: z.string(), amount: z.number(), actual: z.number() });
const JOB_CAP = "job-cap";

const tenantFeature = defineFeature("capres", (r) => {
  r.writeHandler(reserveSettleHandler("reserve-settle"));
  r.writeHandler(settleLifecycleHandler);
});

const systemFeature = defineFeature("capsys", (r) => {
  r.systemScope();
  r.writeHandler(reserveSettleHandler("reserve-settle"));
  r.writeHandler(wrappedStorageHandler);
  r.writeHandler(reserveForOtherTenantHandler);
  r.writeHandler(settleForeignRowHandler);
});

const jobFeature = defineFeature("capjob", (r) => {
  r.job({
    name: "reserve-settle",
    trigger: { manual: true },
    handler: async (rawPayload, ctx) => {
      const payload = jobPayload.parse(rawPayload);
      const reservation = await reserveCalendarCapUsage(ctx, {
        capName: payload.capName,
        periodStartIso: PERIOD,
        limit: 100,
        profile: "hardSlot",
        amount: payload.amount,
      });
      await reservation.settle(payload.actual);
    },
  });
});

const meteredJobPayload = z.object({ otherTenantId: z.string(), capName: z.string() });

// The metering shape: the job's context spread into a handler-shaped one for another tenant's user.
const meteringJobFeature = defineFeature("capmeter", (r) => {
  r.systemScope();
  r.job({
    name: "meter-other-tenant",
    trigger: { manual: true },
    handler: async (rawPayload, ctx) => {
      const payload = meteredJobPayload.parse(rawPayload);
      if (!ctx.systemDb) throw new Error("expected a systemScope job");
      const { systemDb, ...rest } = ctx;
      const meteringCtx = {
        ...rest,
        user: createSystemUser(payload.otherTenantId as TenantId),
        db: systemDb.acknowledgeCrossTenant("cap-counter metering job test"),
      };
      await bookCapUsage(meteringCtx, {
        capName: payload.capName,
        periodStartIso: PERIOD,
        amount: 2,
        outsideTransaction: false,
      });
      const reservation = await reserveCalendarCapUsage(meteringCtx, {
        capName: payload.capName,
        periodStartIso: PERIOD,
        limit: 100,
        profile: "hardSlot",
        amount: 1,
        outsideTransaction: false,
      });
      await reservation.settle(3);
    },
  });
});

const RESERVE_SETTLE_QN = "capres:write:reserve-settle";
const SETTLE_LIFECYCLE_QN = "capres:write:settle-lifecycle";
const METER_JOB_QN = "capmeter:job:meter-other-tenant";
const SYSTEM_RESERVE_SETTLE_QN = "capsys:write:reserve-settle";
const WRAPPED_STORAGE_QN = "capsys:write:wrapped-storage";
const OTHER_TENANT_QN = "capsys:write:reserve-for-other-tenant";
const FOREIGN_ROW_QN = "capsys:write:settle-foreign-row";
const JOB_QN = "capjob:job:reserve-settle";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [capCounterFeature, tenantFeature, systemFeature, jobFeature, meteringJobFeature],
    jobs: { consumerLane: "worker" },
  });
  await unsafeCreateEntityTable(stack.db, capCounterEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  betweenReserveAndSettle = undefined;
  softHits.length = 0;
  await resetTestTables(stack.db, [capCounterTable, eventsTable, capReservationsTable]);
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function readCounterValue(
  user: ReturnType<typeof adminFor>,
  capName: string,
): Promise<number | undefined> {
  const row = (await stack.http.queryOk(
    CapCounterQueries.getCounter,
    { capName, periodStartIso: PERIOD },
    user,
  )) as Record<string, unknown> | null;
  return row === null ? undefined : (row["value"] as number);
}

async function reservationRows(tenantNumber: number) {
  return selectMany(stack.db, capReservationsTable, {
    tenantId: testTenantId(tenantNumber),
    settledAt: null,
  });
}

async function settledTombstones(tenantNumber: number) {
  return selectMany<{ id: string }>(stack.db, capReservationsTable, {
    tenantId: testTenantId(tenantNumber),
    settledAt: { ne: null },
  });
}

describe("reserveCalendarCapUsage", () => {
  test("parallel reserves keep the limit exact and every rejection is cap_exceeded", async () => {
    const user = adminFor(3101);
    const limit = 3;
    const amount = 1;
    const hardLimit = Math.floor(limit * CAP_TOLERANCES.hardSlot.hard);

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        stack.http.write(
          RESERVE_SETTLE_QN,
          { capName: "parallel-cap", limit, amount, actual: amount },
          user,
        ),
      ),
    );
    const bodies = await Promise.all(
      responses.map(async (response) => ({
        status: response.status,
        body: (await response.json()) as { error?: { code: string } },
      })),
    );

    const succeeded = bodies.filter((entry) => entry.status === 200);
    const rejected = bodies.filter((entry) => entry.status !== 200);
    expect(succeeded.length * amount).toBeLessThanOrEqual(hardLimit);
    expect(succeeded).toHaveLength(hardLimit);
    expect(rejected.map((entry) => entry.body.error?.code)).toEqual(
      rejected.map(() => "cap_exceeded"),
    );
    expect(await readCounterValue(user, "parallel-cap")).toBe(succeeded.length * amount);
    expect(await reservationRows(3101)).toHaveLength(0);
  });

  test("settle books the actual amount, above and below the reservation, and drops the row", async () => {
    const user = adminFor(3102);

    await stack.http.writeOk(
      RESERVE_SETTLE_QN,
      { capName: "settle-cap", limit: 100, amount: 3, actual: 5 },
      user,
    );
    expect(await readCounterValue(user, "settle-cap")).toBe(5);

    await stack.http.writeOk(
      RESERVE_SETTLE_QN,
      { capName: "settle-cap", limit: 100, amount: 4, actual: 1 },
      user,
    );
    expect(await readCounterValue(user, "settle-cap")).toBe(6);

    await stack.http.writeOk(
      RESERVE_SETTLE_QN,
      { capName: "settle-cap", limit: 100, amount: 2, actual: 0 },
      user,
    );
    expect(await readCounterValue(user, "settle-cap")).toBe(6);
    expect(await reservationRows(3102)).toHaveLength(0);
  });

  test("settle after the row was swept books the full actual amount once", async () => {
    const user = adminFor(3103);
    const tenantId = testTenantId(3103);
    betweenReserveAndSettle = async (payload) => {
      if (!payload.expireAndSweepFirst) return;
      betweenReserveAndSettle = undefined;
      await updateMany(
        stack.db,
        capReservationsTable,
        { expiresAt: Temporal.Now.instant().subtract({ minutes: 1 }) },
        { tenantId, capName: payload.capName },
      );
      await stack.http.writeOk(
        RESERVE_SETTLE_QN,
        { capName: payload.capName, limit: 100, amount: 1, actual: 1 },
        user,
      );
    };

    await stack.http.writeOk(
      RESERVE_SETTLE_QN,
      { capName: "swept-cap", limit: 100, amount: 3, actual: 2, expireAndSweepFirst: true },
      user,
    );

    // 3 reserved, swept back to 0, nested call +1, own settle +2
    expect(await readCounterValue(user, "swept-cap")).toBe(3);
    expect(await reservationRows(3103)).toHaveLength(0);
  });

  test("an in-place reservation on the handler's transaction-bound db is rejected", async () => {
    const user = adminFor(3104);

    const response = await stack.http.write(
      RESERVE_SETTLE_QN,
      { capName: "in-place-cap", limit: 100, amount: 1, actual: 1, outsideTransaction: false },
      user,
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await readCounterValue(user, "in-place-cap")).toBeUndefined();
  });
});

describe("settle tombstone", () => {
  test("a repeated settle books once and leaves one settled row", async () => {
    const user = adminFor(3131);

    await stack.http.writeOk(
      SETTLE_LIFECYCLE_QN,
      { capName: "twice-cap", amount: 3, actual: 5, scenario: "settle-twice" },
      user,
    );

    expect(await readCounterValue(user, "twice-cap")).toBe(5);
    expect(await reservationRows(3131)).toHaveLength(0);
    expect(await settledTombstones(3131)).toHaveLength(1);
  });

  test("two parallel settles of one open reservation book the actual amount once", async () => {
    const user = adminFor(3134);

    await stack.http.writeOk(
      SETTLE_LIFECYCLE_QN,
      { capName: "parallel-cap", amount: 3, actual: 5, scenario: "settle-parallel" },
      user,
    );

    expect(await readCounterValue(user, "parallel-cap")).toBe(5);
    expect(await reservationRows(3134)).toHaveLength(0);
    expect(await settledTombstones(3134)).toHaveLength(1);
  });

  test("two parallel settles after a release book the full amount once", async () => {
    const user = adminFor(3135);

    await stack.http.writeOk(
      SETTLE_LIFECYCLE_QN,
      {
        capName: "parallel-released-cap",
        amount: 3,
        actual: 2,
        scenario: "release-then-settle-parallel",
      },
      user,
    );

    expect(await readCounterValue(user, "parallel-released-cap")).toBe(2);
    expect(await settledTombstones(3135)).toHaveLength(1);
  });

  test("a release after a settle gives nothing back", async () => {
    const user = adminFor(3132);

    await stack.http.writeOk(
      SETTLE_LIFECYCLE_QN,
      { capName: "late-release-cap", amount: 3, actual: 4, scenario: "settle-then-release" },
      user,
    );

    expect(await readCounterValue(user, "late-release-cap")).toBe(4);
  });

  test("a settle after a release books the full amount, a second settle books nothing", async () => {
    const user = adminFor(3133);

    await stack.http.writeOk(
      SETTLE_LIFECYCLE_QN,
      { capName: "released-cap", amount: 3, actual: 2, scenario: "release-then-settle-twice" },
      user,
    );

    expect(await readCounterValue(user, "released-cap")).toBe(2);
    expect(await settledTombstones(3133)).toHaveLength(1);
  });

  test("the sweep deletes an expired tombstone without giving its amount back", async () => {
    const user = adminFor(3134);
    await stack.http.writeOk(
      SETTLE_LIFECYCLE_QN,
      { capName: "sweep-tombstone-cap", amount: 3, actual: 3, scenario: "settle-once" },
      user,
    );
    const [expiredTombstone] = await settledTombstones(3134);
    await updateMany(
      stack.db,
      capReservationsTable,
      { expiresAt: Temporal.Now.instant().subtract({ minutes: 1 }) },
      { tenantId: testTenantId(3134), capName: "sweep-tombstone-cap" },
    );

    await stack.http.writeOk(
      RESERVE_SETTLE_QN,
      { capName: "sweep-tombstone-cap", limit: 100, amount: 1, actual: 1 },
      user,
    );

    const remaining = (await settledTombstones(3134)).map((row) => row.id);
    expect(remaining).toHaveLength(1);
    expect(remaining).not.toContain(expiredTombstone?.id);
    expect(await readCounterValue(user, "sweep-tombstone-cap")).toBe(4);
  });
});

describe("systemScope handlers", () => {
  test("the public API reserves and settles", async () => {
    const user = adminFor(3111);

    await stack.http.writeOk(
      SYSTEM_RESERVE_SETTLE_QN,
      { capName: "sys-api-cap", limit: 100, amount: 3, actual: 2 },
      user,
    );

    expect(await readCounterValue(user, "sys-api-cap")).toBe(2);
    expect(await reservationRows(3111)).toHaveLength(0);
  });

  test("withCapEnforcement enforces, notifies and reserves", async () => {
    const user = adminFor(3112);

    await stack.http.writeOk(WRAPPED_STORAGE_QN, { amount: 100 }, user);
    await stack.http.writeOk(WRAPPED_STORAGE_QN, { amount: 1 }, user);

    expect(softHits).toEqual([`${testTenantId(3112)}:${STORAGE_CAP}`]);
    expect(await readCounterValue(user, STORAGE_CAP)).toBe(101);
    const counter = (await stack.http.queryOk(
      CapCounterQueries.getCounter,
      { capName: STORAGE_CAP, periodStartIso: PERIOD },
      user,
    )) as Record<string, unknown>;
    expect(counter["lastSoftWarnedAt"]).not.toBeNull();
  });

  test("withCapEnforcement rejects an amount that would cross the hard cap and leaves the counter untouched", async () => {
    const user = adminFor(3115);
    await stack.http.writeOk(WRAPPED_STORAGE_QN, { amount: 100 }, user);

    // storage hard cap is 105 for limit 100: 100 + 6 would end at 106.
    const rejected = await stack.http.writeErr(WRAPPED_STORAGE_QN, { amount: 6 }, user);

    expect(rejected.code).toBe("cap_exceeded");
    expect(rejected.httpStatus).toBe(429);
    expect(await readCounterValue(user, STORAGE_CAP)).toBe(100);

    await stack.http.writeOk(WRAPPED_STORAGE_QN, { amount: 5 }, user);
    expect(await readCounterValue(user, STORAGE_CAP)).toBe(105);
  });

  test("a context for another tenant stamps reservation and counter with that tenant", async () => {
    const caller = adminFor(3113);
    const otherTenantId = testTenantId(3114);
    const body = { otherTenantId, capName: "stamped-cap" };

    await stack.http.writeOk(OTHER_TENANT_QN, body, caller);

    const rows = await selectMany<{ tenantId: string }>(stack.db, capReservationsTable, {
      capName: "stamped-cap",
    });
    expect(rows.map((row) => row.tenantId)).toEqual([otherTenantId]);
    const counters = await selectMany<{ tenantId: string; value: number }>(
      stack.db,
      capCounterTable,
      { capName: "stamped-cap" },
    );
    expect(counters.map((row) => row.tenantId)).toEqual([otherTenantId]);

    await updateMany(
      stack.db,
      capReservationsTable,
      { expiresAt: Temporal.Now.instant().subtract({ minutes: 1 }) },
      { capName: "stamped-cap" },
    );
    await stack.http.writeOk(OTHER_TENANT_QN, body, caller);

    // The sweep of the other tenant gave the expired 2 back before booking the new 2.
    const after = await selectMany<{ tenantId: string; value: number }>(stack.db, capCounterTable, {
      capName: "stamped-cap",
    });
    expect(after.map((row) => row.value)).toEqual([2]);
    expect(
      await selectMany(stack.db, capReservationsTable, { capName: "stamped-cap" }),
    ).toHaveLength(1);
  });

  test("release and settle never touch another tenant's reservation row", async () => {
    const caller = adminFor(3115);
    const ownerId = testTenantId(3116);
    const reservationId = generateId();
    const now = Temporal.Now.instant();
    await insertOne(stack.db, capReservationsTable, {
      id: reservationId,
      tenantId: ownerId,
      capName: "foreign-cap",
      kind: "calendar",
      periodStartIso: PERIOD,
      amount: 4,
      expiresAt: now.add({ minutes: 30 }),
      createdAt: now,
    });

    // The id is taken by the owner's row, so the tombstone insert for the other tenant cannot be
    // created and the settle fails without booking.
    await stack.http.writeErr(
      FOREIGN_ROW_QN,
      { otherTenantId: testTenantId(3117), reservationId, capName: "foreign-cap" },
      caller,
    );

    const rows = await selectMany<{ id: string }>(stack.db, capReservationsTable, {
      tenantId: ownerId,
    });
    expect(rows.map((row) => row.id)).toEqual([reservationId]);
    expect(await readCounterValue(adminFor(3116), "foreign-cap")).toBeUndefined();
    expect(await readCounterValue(adminFor(3117), "foreign-cap")).toBeUndefined();
  });
});

describe("job context", () => {
  test("a job reserves and settles in place", async () => {
    const tenantId = testTenantId(3121);
    const runner = stack.jobRunner;
    if (!runner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");

    await runner.dispatch(JOB_QN, { _tenantId: tenantId, capName: JOB_CAP, amount: 3, actual: 2 });
    await stack.drainJobs();

    expect(await readCounterValue(adminFor(3121), JOB_CAP)).toBe(2);
    expect(await reservationRows(3121)).toHaveLength(0);
  });

  test("a job context spread for another tenant's user books on that tenant, in place", async () => {
    const runner = stack.jobRunner;
    if (!runner) throw new Error("setupTestStack({ jobs }) did not wire a jobRunner");

    await runner.dispatch(METER_JOB_QN, {
      _tenantId: testTenantId(3122),
      otherTenantId: testTenantId(3123),
      capName: "metered-cap",
    });
    await stack.drainJobs();

    expect(await readCounterValue(adminFor(3123), "metered-cap")).toBe(5);
    expect(await readCounterValue(adminFor(3122), "metered-cap")).toBeUndefined();
    expect(await reservationRows(3123)).toHaveLength(0);
  });
});
