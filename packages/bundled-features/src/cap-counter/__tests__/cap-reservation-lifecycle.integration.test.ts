// Reservation lifecycle of withCapEnforcement over real HTTP: gate order before the reservation,
// TTL sweep of orphaned reservations, a release after a committed confirm, and wrapper composition.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createTenantDb, type DbConnection, insertOne } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntityExecutor,
  defineFeature,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { RateLimitError } from "@cosmicdrift/kumiko-framework/errors";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import type {
  RateLimitConfig,
  RateLimitDecision,
  RateLimitResolver,
} from "@cosmicdrift/kumiko-types/rate-limit-types";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { readRollingCapUsage } from "../book-cap-usage.js";
import { CapCounterHandlers, CapCounterQueries } from "../constants.js";
import type { SoftHitNotifier } from "../enforce-cap.js";
import { capCounterEntity } from "../entity.js";
import { capCounterFeature } from "../feature.js";
import { capReservationsTable } from "../tables.js";
import { withCapEnforcement, withRollingCapEnforcement } from "../with-cap-enforcement.js";

const PERIOD = "2026-07-01T00:00:00Z";

// =============================================================================
// Probes
// =============================================================================

let handlerRuns = 0;
const softHitNotifications: string[] = [];
const recordingNotifier: SoftHitNotifier = (info) => {
  softHitNotifications.push(info.capName);
};

const rateLimitBuckets = new Map<string, number>();
const rateLimitCharges: string[] = [];

function decisionFor(config: RateLimitConfig, used: number): RateLimitDecision {
  return {
    allowed: used <= config.limit,
    limit: config.limit,
    remaining: Math.max(0, config.limit - used),
    retryAfterSeconds: 1,
    windowSeconds: config.windowSeconds,
    resetAt: Temporal.Instant.fromEpochMilliseconds(0),
  };
}

const countingRateLimiter: RateLimitResolver = {
  check: async (_bucket, config) => decisionFor(config, 0),
  peek: async (_bucket, config) => decisionFor(config, 0),
  enforce: async (bucket, config) => {
    rateLimitCharges.push(bucket);
    const used = (rateLimitBuckets.get(bucket) ?? 0) + 1;
    rateLimitBuckets.set(bucket, used);
    if (used > config.limit) {
      throw new RateLimitError({
        bucket,
        limit: config.limit,
        windowSeconds: config.windowSeconds,
        remaining: 0,
        retryAfterSeconds: 1,
        resetAt: "1970-01-01T00:00:00.000Z",
      });
    }
    return decisionFor(config, used);
  },
};

const amountPayload = z.object({ amount: z.number().int().min(1) });

const GATED_CAP = "gate-order-cap";
const gatedHandler: WriteHandlerDef = {
  name: "gated-send",
  schema: amountPayload,
  access: { roles: ["TenantAdmin"] },
  rateLimit: { per: "user", limit: 1, windowSeconds: 60 },
  handler: async () => {
    handlerRuns += 1;
    return { isSuccess: true as const, data: {} };
  },
};
const wrappedGated = withCapEnforcement(gatedHandler, (event) => ({
  capName: GATED_CAP,
  periodStartIso: PERIOD,
  limit: 10,
  profile: "burstable",
  amount: amountPayload.parse(event.payload).amount,
  notify: recordingNotifier,
}));
const GATED_QN = "capgate:write:gated-send";

const UNKNOWN_COMMIT_CAP = "unknown-commit-cap";
const unknownCommitHandler: WriteHandlerDef = {
  name: "unknown-commit-send",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: async () => ({ isSuccess: true as const, data: {} }),
};
const wrappedUnknownCommit = withCapEnforcement(unknownCommitHandler, () => ({
  capName: UNKNOWN_COMMIT_CAP,
  periodStartIso: PERIOD,
  limit: 5,
  profile: "hardSlot",
  notify: recordingNotifier,
}));
const reserveUnknownCommit = wrappedUnknownCommit.reserveBeforeTransaction;
if (!reserveUnknownCommit) throw new Error("withCapEnforcement must set reserveBeforeTransaction");
let reservationOfLastUnknownCommit: Awaited<ReturnType<typeof reserveUnknownCommit>>;
const capturingUnknownCommit: WriteHandlerDef = {
  ...wrappedUnknownCommit,
  reserveBeforeTransaction: async (event, ctx) => {
    reservationOfLastUnknownCommit = await reserveUnknownCommit(event, ctx);
    return reservationOfLastUnknownCommit;
  },
};
const UNKNOWN_COMMIT_QN = "capgate:write:unknown-commit-send";

const ROLLING_WINDOW_DAYS = 7;
const INNER_CAP = "composition-inner-cap";
const OUTER_CAP = "composition-outer-cap";
const composedBase: WriteHandlerDef = {
  name: "composed-send",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  rateLimit: { per: "tenant+handler", limit: 100, windowSeconds: 60 },
  handler: async () => {
    handlerRuns += 1;
    return { isSuccess: true as const, data: {} };
  },
};
const composedWithInnerCap = withRollingCapEnforcement(composedBase, () => ({
  capName: INNER_CAP,
  windowDays: ROLLING_WINDOW_DAYS,
  limit: 5,
  profile: "hardSlot",
  notify: recordingNotifier,
}));
const composed = withCapEnforcement(composedWithInnerCap, () => ({
  capName: OUTER_CAP,
  periodStartIso: PERIOD,
  limit: 1,
  profile: "hardSlot",
  notify: recordingNotifier,
}));
const COMPOSED_QN = "capgate:write:composed-send";

const ROLLING_CAP = "rolling-lifecycle-cap";
let rollingHandlerFails = false;
const rollingHandler: WriteHandlerDef = {
  name: "rolling-send",
  schema: z.object({}),
  access: { roles: ["TenantAdmin"] },
  handler: async () => {
    if (rollingHandlerFails) {
      return {
        isSuccess: false as const,
        error: {
          code: "send_rejected",
          httpStatus: 422,
          message: "rejected",
          i18nKey: "errors.send",
          details: {},
        },
      };
    }
    return { isSuccess: true as const, data: {} };
  },
};
const wrappedRolling = withRollingCapEnforcement(rollingHandler, () => ({
  capName: ROLLING_CAP,
  windowDays: ROLLING_WINDOW_DAYS,
  limit: 3,
  profile: "hardSlot",
  notify: recordingNotifier,
}));
const ROLLING_QN = "capgate:write:rolling-send";

const capGateFeature = defineFeature("capgate", (r) => {
  r.writeHandler(wrappedRolling);
  r.writeHandler(wrappedGated);
  r.writeHandler(capturingUnknownCommit);
  r.writeHandler(composed);
});

// =============================================================================
// Setup
// =============================================================================

const { table: capCounterTable } = createEntityExecutor("cap-counter", capCounterEntity);

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [capCounterFeature, capGateFeature],
    extraContext: { rateLimit: countingRateLimiter },
  });
  db = stack.db;
  await unsafeCreateEntityTable(db, capCounterEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(db, [capCounterTable, eventsTable, capReservationsTable]);
  handlerRuns = 0;
  softHitNotifications.length = 0;
  rateLimitBuckets.clear();
  rateLimitCharges.length = 0;
  rollingHandlerFails = false;
});

function userFor(tenantNumber: number, userNumber: number, roles: string[] = ["TenantAdmin"]) {
  return createTestUser({ id: userNumber, tenantId: testTenantId(tenantNumber), roles });
}

async function readCounter(user: ReturnType<typeof userFor>, capName: string) {
  return (await stack.http.queryOk(
    CapCounterQueries.getCounter,
    { capName, periodStartIso: PERIOD },
    user,
  )) as Record<string, unknown> | null;
}

async function rollingUsage(tenantNumber: number, capName: string) {
  const tenantId = testTenantId(tenantNumber);
  return readRollingCapUsage(createTenantDb(db, tenantId), tenantId, {
    capName,
    windowDays: ROLLING_WINDOW_DAYS,
  });
}

async function reservationRows(tenantNumber: number) {
  return selectMany(db, capReservationsTable, { tenantId: testTenantId(tenantNumber) });
}

// Puts the counter at 11, the soft threshold of limit 10 with the burstable profile.
async function seedCounterAtSoftThreshold(tenantNumber: number) {
  await stack.http.writeOk(GATED_QN, { amount: 11 }, userFor(tenantNumber, 1));
  expect(softHitNotifications).toHaveLength(0);
}

async function expectNothingConsumedSince(tenantNumber: number, runsBefore: number) {
  const counter = await readCounter(userFor(tenantNumber, 1), GATED_CAP);
  expect(counter?.["value"]).toBe(11);
  expect(counter?.["lastSoftWarnedAt"]).toBeNull();
  expect(softHitNotifications).toHaveLength(0);
  expect(handlerRuns).toBe(runsBefore);
  expect(await reservationRows(tenantNumber)).toHaveLength(0);
}

// =============================================================================
// Gate order
// =============================================================================

describe("withCapEnforcement - gates run before the reservation", () => {
  test("a rate-limited caller consumes no cap usage and triggers no soft-warn", async () => {
    await seedCounterAtSoftThreshold(3001);

    const error = await stack.http.writeErr(GATED_QN, { amount: 1 }, userFor(3001, 1));

    expect(error.code).toBe("rate_limited");
    await expectNothingConsumedSince(3001, 1);
  });

  test("a caller without access consumes no cap usage and triggers no soft-warn", async () => {
    await seedCounterAtSoftThreshold(3002);

    const error = await stack.http.writeErr(GATED_QN, { amount: 1 }, userFor(3002, 2, ["Viewer"]));

    expect(error.httpStatus).toBe(403);
    await expectNothingConsumedSince(3002, 1);
  });

  test("an invalid payload consumes no cap usage and triggers no soft-warn", async () => {
    await seedCounterAtSoftThreshold(3003);

    const error = await stack.http.writeErr(GATED_QN, { amount: 0 }, userFor(3003, 2));

    expect(error.httpStatus).toBe(400);
    await expectNothingConsumedSince(3003, 1);
  });

  test("an accepted caller at the soft threshold does trigger soft-warn", async () => {
    await seedCounterAtSoftThreshold(3004);

    await stack.http.writeOk(GATED_QN, { amount: 1 }, userFor(3004, 2));

    expect(softHitNotifications).toEqual([GATED_CAP]);
    const counter = await readCounter(userFor(3004, 1), GATED_CAP);
    expect(counter?.["value"]).toBe(12);
    expect(counter?.["lastSoftWarnedAt"]).not.toBeNull();
  });
});

// =============================================================================
// TTL sweep
// =============================================================================

describe("withCapEnforcement - expired reservations", () => {
  test("the next reserve gives back an expired reservation and keeps a live one", async () => {
    const tenantNumber = 3101;
    const tenantId = testTenantId(tenantNumber);
    const admin = userFor(tenantNumber, 1, ["TenantAdmin", "SystemAdmin"]);
    // Two orphaned bookings (2 expired, 1 live) as a crashed process would leave them.
    await stack.http.writeOk(
      CapCounterHandlers.increment,
      { capName: GATED_CAP, periodStartIso: PERIOD, amount: 3 },
      admin,
    );
    const now = Temporal.Now.instant();
    const orphan = { tenantId, capName: GATED_CAP, kind: "calendar", periodStartIso: PERIOD };
    await insertOne(db, capReservationsTable, {
      ...orphan,
      id: generateId(),
      amount: 2,
      expiresAt: now.subtract({ minutes: 1 }),
      createdAt: now.subtract({ minutes: 61 }),
    });
    await insertOne(db, capReservationsTable, {
      ...orphan,
      id: generateId(),
      amount: 1,
      expiresAt: now.add({ minutes: 30 }),
      createdAt: now.subtract({ minutes: 30 }),
    });

    await stack.http.writeOk(GATED_QN, { amount: 1 }, userFor(tenantNumber, 2));

    // 3 orphaned - 2 expired + 1 new
    expect((await readCounter(admin, GATED_CAP))?.["value"]).toBe(2);
    const remaining = await reservationRows(tenantNumber);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.["amount"]).toBe(1);
  });
});

// =============================================================================
// Unknown COMMIT outcome
// =============================================================================

describe("withCapEnforcement - release after a committed confirm", () => {
  test("releasing a reservation whose confirm committed leaves the counter unchanged", async () => {
    const tenantNumber = 3201;
    const user = userFor(tenantNumber, 1);

    await stack.http.writeOk(UNKNOWN_COMMIT_QN, {}, user);
    expect((await readCounter(user, UNKNOWN_COMMIT_CAP))?.["value"]).toBe(1);
    expect(await reservationRows(tenantNumber)).toHaveLength(0);

    // The dispatcher releases when it cannot tell whether COMMIT went through.
    if (typeof reservationOfLastUnknownCommit !== "object") {
      throw new Error("withCapEnforcement must return a reservation handle");
    }
    await reservationOfLastUnknownCommit.release();

    expect((await readCounter(user, UNKNOWN_COMMIT_CAP))?.["value"]).toBe(1);
  });
});

// =============================================================================
// Composition
// =============================================================================

describe("withCapEnforcement - wrapped around another capped handler", () => {
  test("both caps are enforced and booked, the inner rate limit still applies", async () => {
    const tenantNumber = 3301;
    const user = userFor(tenantNumber, 1);

    await stack.http.writeOk(COMPOSED_QN, {}, user);

    expect(await rollingUsage(tenantNumber, INNER_CAP)).toBe(1);
    expect((await readCounter(user, OUTER_CAP))?.["value"]).toBe(1);
    expect(rateLimitCharges).toEqual([
      `tenant+handler:${testTenantId(tenantNumber)}:${COMPOSED_QN}`,
    ]);
  });

  test("an outer rejection gives the inner reservation back", async () => {
    const tenantNumber = 3302;
    const user = userFor(tenantNumber, 1);
    await stack.http.writeOk(COMPOSED_QN, {}, user);

    const error = await stack.http.writeErr(COMPOSED_QN, {}, user);

    expect(error.code).toBe("cap_exceeded");
    expect(handlerRuns).toBe(1);
    expect(await rollingUsage(tenantNumber, INNER_CAP)).toBe(1);
    expect((await readCounter(user, OUTER_CAP))?.["value"]).toBe(1);
    expect(await reservationRows(tenantNumber)).toHaveLength(0);
  });
});

// =============================================================================
// Rolling reservation
// =============================================================================

describe("withRollingCapEnforcement - reservation lifecycle", () => {
  test("a successful write keeps its amount in the window and leaves no reservation row", async () => {
    const tenantNumber = 3401;

    await stack.http.writeOk(ROLLING_QN, {}, userFor(tenantNumber, 1));

    expect(await rollingUsage(tenantNumber, ROLLING_CAP)).toBe(1);
    expect(await reservationRows(tenantNumber)).toHaveLength(0);
  });

  test("a failed write releases its amount: reserve and release net out", async () => {
    const tenantNumber = 3402;
    const user = userFor(tenantNumber, 1);
    await stack.http.writeOk(ROLLING_QN, {}, user);
    rollingHandlerFails = true;

    await stack.http.writeErr(ROLLING_QN, {}, user);

    expect(await rollingUsage(tenantNumber, ROLLING_CAP)).toBe(1);
    expect(await reservationRows(tenantNumber)).toHaveLength(0);
    const events = await selectMany(db, eventsTable, { tenantId: testTenantId(tenantNumber) });
    expect(events.map((event) => event["type"]).sort()).toEqual([
      "cap-counter:event:rolling-incremented",
      "cap-counter:event:rolling-incremented",
      "cap-counter:event:rolling-released",
    ]);
  });

  test("the hard cap blocks once the window is full", async () => {
    const tenantNumber = 3403;
    const user = userFor(tenantNumber, 1);
    for (let i = 0; i < 3; i++) await stack.http.writeOk(ROLLING_QN, {}, user);

    const error = await stack.http.writeErr(ROLLING_QN, {}, user);

    expect(error.code).toBe("cap_exceeded");
    expect(await rollingUsage(tenantNumber, ROLLING_CAP)).toBe(3);
  });

  test("parallel writes cannot overshoot the hard cap", async () => {
    const tenantNumber = 3405;
    const user = userFor(tenantNumber, 1);

    const results = await Promise.all(
      Array.from({ length: 6 }, () => stack.http.write(ROLLING_QN, {}, user)),
    );

    expect(results.filter((response) => response.status === 200)).toHaveLength(3);
    expect(await rollingUsage(tenantNumber, ROLLING_CAP)).toBe(3);
    expect(await reservationRows(tenantNumber)).toHaveLength(0);
  });

  test("the next reserve gives back an expired rolling reservation", async () => {
    const tenantNumber = 3404;
    const tenantId = testTenantId(tenantNumber);
    // An orphaned booking of 2 as a crashed process would leave it: its event plus an expired row.
    await stack.http.writeOk(
      CapCounterHandlers.incrementRolling,
      { capName: ROLLING_CAP, amount: 2 },
      userFor(tenantNumber, 1, ["TenantAdmin", "SystemAdmin"]),
    );
    const now = Temporal.Now.instant();
    await insertOne(db, capReservationsTable, {
      id: generateId(),
      tenantId,
      capName: ROLLING_CAP,
      kind: "rolling",
      periodStartIso: null,
      amount: 2,
      expiresAt: now.subtract({ minutes: 1 }),
      createdAt: now.subtract({ minutes: 61 }),
    });
    expect(await rollingUsage(tenantNumber, ROLLING_CAP)).toBe(2);

    await stack.http.writeOk(ROLLING_QN, {}, userFor(tenantNumber, 2));

    // 2 orphaned - 2 expired + 1 new
    expect(await rollingUsage(tenantNumber, ROLLING_CAP)).toBe(1);
    expect(await reservationRows(tenantNumber)).toHaveLength(0);
  });
});
