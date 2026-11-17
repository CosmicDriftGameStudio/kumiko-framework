// Full-stack integration test for cap-counter. Drives the increment
// + get + enforceCap path through the dispatcher + real DB.
//
// **Test-Probe-Pattern:** a tiny one-off feature with a write-handler
// that calls enforceCap → returns the result-state so the test can
// assert. Mirrors the mail-foundation / file-foundation integration
// test pattern.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createTenantDb,
  type DbConnection,
  insertOne,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { defineFeature, type WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import { readRollingCapUsage, rollingBucketStart } from "../book-cap-usage.ts";
import { CapCounterHandlers } from "../constants.ts";
import {
  CapExceededError,
  currentCalendarMonthStartIso,
  enforceCap,
  enforceCapAndMaybeNotify,
  type SoftHitNotifier,
} from "../enforce-cap.ts";
import { createCapCounterFeature } from "../feature.ts";
import { capCountersTable, rollingCapUsageTable } from "../tables.ts";
import { fetchCounterRow } from "./read-counter.ts";

// --- Test-Probe-Feature: drives enforceCap from inside a real handler ---

const ENFORCE_PROBE_QN = "cap-test:write:enforce";

// Direct WriteHandlerDef — bypasses the defineWriteHandler factory whose
// type-parameter inference clashes with the cross-package HandlerContext
// generic in this test file. Same runtime contract.
const enforceHandler: WriteHandlerDef = {
  name: "enforce",
  schema: z.object({
    capName: z.string(),
    periodStartIso: z.string(),
    limit: z.number(),
    profile: z.enum(["burstable", "storage", "hardSlot", "egress"]),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    try {
      const result = await enforceCap(ctx, event.payload as Parameters<typeof enforceCap>[1]);
      return { isSuccess: true as const, data: { ok: true, ...result } };
    } catch (e) {
      if (e instanceof CapExceededError) {
        return {
          isSuccess: true as const,
          data: { ok: false, code: e.code, currentValue: e.currentValue, limit: e.limit },
        };
      }
      throw e;
    }
  },
};

// Notification-recorder — module-level state that the probe-handlers
// push into. Tests reset between scenarios via `recordedNotifications.length = 0`.
// Captures real notifier-callback firings against a real dispatched
// mark-soft-warned-write — this is the full-stack proof that
// enforceCapAndMaybeNotify actually wires soft-hit → notify + DB-flag.
const recordedNotifications: Array<{
  capName: string;
  value: number;
  limit: number;
  tenantId: string;
}> = [];
const recordingNotifier: SoftHitNotifier = (info) => {
  recordedNotifications.push({
    capName: info.capName,
    value: info.value,
    limit: info.limit,
    tenantId: info.tenantId,
  });
};

const ENFORCE_NOTIFY_PROBE_QN = "cap-test:write:enforce-and-notify";
const enforceAndNotifyHandler: WriteHandlerDef = {
  name: "enforce-and-notify",
  schema: z.object({
    capName: z.string(),
    periodStartIso: z.string(),
    limit: z.number(),
    profile: z.enum(["burstable", "storage", "hardSlot", "egress"]),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    try {
      const result = await enforceCapAndMaybeNotify(ctx, {
        ...(event.payload as Omit<Parameters<typeof enforceCapAndMaybeNotify>[1], "notify">),
        notify: recordingNotifier,
      });
      return { isSuccess: true as const, data: { ok: true, ...result } };
    } catch (e) {
      if (e instanceof CapExceededError) {
        return { isSuccess: true as const, data: { ok: false, code: e.code } };
      }
      throw e;
    }
  },
};

const enforceProbeFeature = defineFeature("cap-test", (r) => {
  r.writeHandler(enforceHandler);
  r.writeHandler(enforceAndNotifyHandler);
});

// --- Setup ---

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createCapCounterFeature(), enforceProbeFeature],
  });
  db = stack.db;
});

afterAll(async () => {
  await stack.cleanup();
});

// Fixed period used for calendar-counter scenarios. Tests don't care
// which month — just need a stable iso-string so `increment` +
// `readCounter` hit the same aggregate.
const PERIOD = "2026-05-01T00:00:00Z";

beforeEach(async () => {
  await resetTestTables(db, [capCountersTable, eventsTable, rollingCapUsageTable]);
});

const sysadmin = TestUsers.systemAdmin;

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function increment(
  user: ReturnType<typeof adminFor>,
  capName: string,
  amount: number,
  periodStartIso: string = PERIOD,
) {
  await stack.http.writeOk(CapCounterHandlers.increment, { capName, amount, periodStartIso }, user);
}

async function incrementRolling(
  user: ReturnType<typeof adminFor>,
  capName: string,
  amount: number,
) {
  await stack.http.writeOk(CapCounterHandlers.incrementRolling, { capName, amount }, user);
}

function rollingUsage(user: ReturnType<typeof adminFor>, capName: string, windowDays: number) {
  return readRollingCapUsage(createTenantDb({ db, tenantId: user.tenantId }), user.tenantId, {
    capName,
    windowDays,
  });
}

function readCounter(
  user: ReturnType<typeof adminFor>,
  capName: string,
  periodStartIso: string = PERIOD,
) {
  return fetchCounterRow(stack, user, capName, periodStartIso);
}

// --- Scenario 1: increment + read ---

describe("scenario 1: increment + read", () => {
  test("first increment creates the counter row with value=amount", async () => {
    await increment(sysadmin, "cap-1-mails", 1);

    const row = await readCounter(sysadmin, "cap-1-mails");
    expect(row).not.toBeNull();
    expect(row!["value"]).toBe(1);
    expect(row!["capName"]).toBe("cap-1-mails");
  });

  test("subsequent increments add to the existing value", async () => {
    await increment(sysadmin, "cap-1-tokens", 100);
    await increment(sysadmin, "cap-1-tokens", 50);
    await increment(sysadmin, "cap-1-tokens", 25);

    const row = await readCounter(sysadmin, "cap-1-tokens");
    expect(row!["value"]).toBe(175);
  });

  test("get-counter returns null when no increment happened in this period", async () => {
    const row = await readCounter(sysadmin, "cap-1-never-touched");
    expect(row).toBeNull();
  });
});

// --- Scenario 2: enforceCap end-to-end ---

describe("scenario 2: enforceCap through dispatcher", () => {
  test("under-soft → ok", async () => {
    const admin = adminFor(601);
    await increment(admin, "cap-2-mails", 100);

    const result = (await stack.http.writeOk(
      ENFORCE_PROBE_QN,
      { capName: "cap-2-mails", periodStartIso: PERIOD, limit: 1000, profile: "burstable" },
      admin,
    )) as Record<string, unknown>;

    expect(result["ok"]).toBe(true);
    expect(result["state"]).toBe("ok");
    expect(result["value"]).toBe(100);
  });

  test("at soft-threshold (1100, soft=1.1) → soft-hit, crossed=true", async () => {
    const admin = adminFor(602);
    await increment(admin, "cap-2-mails", 1100);

    const result = (await stack.http.writeOk(
      ENFORCE_PROBE_QN,
      { capName: "cap-2-mails", periodStartIso: PERIOD, limit: 1000, profile: "burstable" },
      admin,
    )) as Record<string, unknown>;

    expect(result["state"]).toBe("soft-hit");
    expect(result["crossed"]).toBe(true);
  });

  test("at hard-threshold (1200) → cap_exceeded code returned", async () => {
    const admin = adminFor(603);
    await increment(admin, "cap-2-mails", 1200);

    const result = (await stack.http.writeOk(
      ENFORCE_PROBE_QN,
      { capName: "cap-2-mails", periodStartIso: PERIOD, limit: 1000, profile: "burstable" },
      admin,
    )) as Record<string, unknown>;

    expect(result["ok"]).toBe(false);
    expect(result["code"]).toBe("cap_exceeded");
    expect(result["currentValue"]).toBe(1200);
    expect(result["limit"]).toBe(1000);
  });
});

// --- Scenario 3: tenant isolation ---

describe("scenario 3: tenant isolation", () => {
  test("tenant A's counter doesn't bleed into tenant B's read", async () => {
    const adminA = adminFor(701);
    const adminB = adminFor(702);

    await increment(adminA, "iso-test", 500);
    await increment(adminB, "iso-test", 50);

    const rowA = await readCounter(adminA, "iso-test");
    const rowB = await readCounter(adminB, "iso-test");

    expect(rowA!["value"]).toBe(500);
    expect(rowB!["value"]).toBe(50);
  });
});

// --- Scenario 4: calendar-month period switch ---

describe("scenario 4: period transition", () => {
  test("new periodStart creates a separate counter aggregate", async () => {
    const admin = adminFor(801);
    const monthA = "2026-04-01T00:00:00Z";
    const monthB = "2026-05-01T00:00:00Z";

    await increment(admin, "monthly-mails", 800, monthA);
    await increment(admin, "monthly-mails", 200, monthB);

    const rowA = await readCounter(admin, "monthly-mails", monthA);
    const rowB = await readCounter(admin, "monthly-mails", monthB);

    expect(rowA!["value"]).toBe(800);
    expect(rowB!["value"]).toBe(200);
  });

  test("currentCalendarMonthStartIso returns a usable period-key", () => {
    // Real-time call — just confirm it returns valid ISO + 1st-of-month
    const iso = currentCalendarMonthStartIso();
    expect(iso).toMatch(/^\d{4}-\d{2}-01T00:00:00/);
  });
});

// --- Scenario 5: Rolling-window buckets ---
//
// increment-rolling adds to the current hour's bucket row; readRollingCapUsage sums the buckets of
// the window. Bookings go through real HTTP.

describe("scenario 5: rolling-window buckets through dispatcher", () => {
  test("an increment books into the current hour's bucket and no calendar counter row", async () => {
    const admin = adminFor(901);
    await incrementRolling(admin, "ai-tokens-7d", 1500);

    const rows = await selectMany(db, rollingCapUsageTable, { tenantId: admin.tenantId });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["capName"]).toBe("ai-tokens-7d");
    expect(rows[0]?.["amount"]).toBe(1500);
    const bucket = Temporal.Instant.from(String(rows[0]?.["bucketStart"]));
    expect(bucket.equals(rollingBucketStart(bucket))).toBe(true);
    expect(await readCounter(admin, "ai-tokens-7d")).toBeNull();
  });

  test("the window sums all increments", async () => {
    const admin = adminFor(902);
    await incrementRolling(admin, "ai-tokens-7d", 1000);
    await incrementRolling(admin, "ai-tokens-7d", 2500);
    await incrementRolling(admin, "ai-tokens-7d", 500);

    expect(await rollingUsage(admin, "ai-tokens-7d", 7)).toBe(4000);
  });

  test("caps are isolated", async () => {
    const admin = adminFor(903);
    await incrementRolling(admin, "ai-tokens-7d", 9999);
    await incrementRolling(admin, "egress-bytes-24h", 100);

    expect(await rollingUsage(admin, "egress-bytes-24h", 1)).toBe(100);
  });

  test("tenants are isolated", async () => {
    const adminA = adminFor(904);
    const adminB = adminFor(905);
    await incrementRolling(adminA, "rolling-iso", 5000);
    await incrementRolling(adminB, "rolling-iso", 100);

    expect(await rollingUsage(adminA, "rolling-iso", 7)).toBe(5000);
    expect(await rollingUsage(adminB, "rolling-iso", 7)).toBe(100);
  });

  test("parallel increments all succeed and add up", async () => {
    const admin = adminFor(906);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        stack.http.writeOk(
          CapCounterHandlers.incrementRolling,
          { capName: "rolling-parallel", amount: 1 },
          admin,
        ),
      ),
    );

    expect(await rollingUsage(admin, "rolling-parallel", 1)).toBe(10);
  });

  test("the window starts at the full hour N×24h back", async () => {
    const admin = adminFor(907);
    const b = rollingBucketStart(Temporal.Now.instant());
    await insertOne(db, rollingCapUsageTable, {
      tenantId: admin.tenantId,
      capName: "rolling-edge",
      bucketStart: b.subtract({ hours: 23 }),
      amount: 7,
    });
    await insertOne(db, rollingCapUsageTable, {
      tenantId: admin.tenantId,
      capName: "rolling-edge",
      bucketStart: b.subtract({ hours: 25 }),
      amount: 1000,
    });
    await incrementRolling(admin, "rolling-edge", 1);

    expect(await rollingUsage(admin, "rolling-edge", 1)).toBe(8);
  });

  test("an increment deletes buckets older than the maximum window", async () => {
    const admin = adminFor(908);
    const b = rollingBucketStart(Temporal.Now.instant());
    await insertOne(db, rollingCapUsageTable, {
      tenantId: admin.tenantId,
      capName: "rolling-prune",
      bucketStart: b.subtract({ hours: 91 * 24 }),
      amount: 50,
    });
    await incrementRolling(admin, "rolling-prune", 1);

    const rows = await selectMany(db, rollingCapUsageTable, { tenantId: admin.tenantId });
    expect(rows.some((row) => row["amount"] === 50)).toBe(false);
    expect(await rollingUsage(admin, "rolling-prune", 90)).toBe(1);
  });

  test("readRollingCapUsage rejects windows outside 1..90 whole days", async () => {
    const admin = adminFor(909);
    await expect(rollingUsage(admin, "rolling-window", 0)).rejects.toThrow();
    await expect(rollingUsage(admin, "rolling-window", 91)).rejects.toThrow();
    await expect(rollingUsage(admin, "rolling-window", 1.5)).rejects.toThrow();
  });
});

// --- Scenario 6: Notification wiring through the dispatcher ---
//
// Proves that enforceCapAndMaybeNotify calls the notifier and dispatches
// `cap-counter:write:mark-soft-warned`, which sets the
// `lastSoftWarnedAt` flag in the database. On the second call in
// the same period, the notifier does not fire again (`crossed=false`)
// because the flag is no longer null.

describe("scenario 6: notification-wiring (calendar)", () => {
  test("soft-hit crossing → notifier fires AND mark-soft-warned-handler flips the DB flag", async () => {
    recordedNotifications.length = 0;
    const admin = adminFor(1001);
    const NOTIFY_PERIOD = "2026-06-01T00:00:00Z";

    // 1100 is the soft threshold for limit=1000 / burstable.
    await increment(admin, "cap-notify-mails", 1100, NOTIFY_PERIOD);

    const first = (await stack.http.writeOk(
      ENFORCE_NOTIFY_PROBE_QN,
      {
        capName: "cap-notify-mails",
        periodStartIso: NOTIFY_PERIOD,
        limit: 1000,
        profile: "burstable",
      },
      admin,
    )) as Record<string, unknown>;
    expect(first["state"]).toBe("soft-hit");
    expect(first["crossed"]).toBe(true);
    expect(recordedNotifications).toHaveLength(1);
    expect(recordedNotifications[0]).toMatchObject({
      capName: "cap-notify-mails",
      value: 1100,
      limit: 1000,
    });

    // Second call in the same period: the counter is still in the soft
    // range, but `lastSoftWarnedAt` is now set by the dispatched
    // `mark-soft-warned` handler. enforceCap returns `crossed=false`,
    // so the notifier does not fire again.
    const second = (await stack.http.writeOk(
      ENFORCE_NOTIFY_PROBE_QN,
      {
        capName: "cap-notify-mails",
        periodStartIso: NOTIFY_PERIOD,
        limit: 1000,
        profile: "burstable",
      },
      admin,
    )) as Record<string, unknown>;
    expect(second["state"]).toBe("soft-hit");
    expect(second["crossed"]).toBe(false);
    expect(recordedNotifications).toHaveLength(1); // unchanged
  });

  test("ok range → notifier does not fire", async () => {
    recordedNotifications.length = 0;
    const admin = adminFor(1002);
    await increment(admin, "cap-notify-quiet", 100);

    const result = (await stack.http.writeOk(
      ENFORCE_NOTIFY_PROBE_QN,
      { capName: "cap-notify-quiet", periodStartIso: PERIOD, limit: 1000, profile: "burstable" },
      admin,
    )) as Record<string, unknown>;
    expect(result["state"]).toBe("ok");
    expect(recordedNotifications).toHaveLength(0);
  });

  test("hard-hit → CapExceededError, notifier does NOT fire (throw comes before notify)", async () => {
    recordedNotifications.length = 0;
    const admin = adminFor(1003);
    await increment(admin, "cap-notify-hard", 1200);

    const result = (await stack.http.writeOk(
      ENFORCE_NOTIFY_PROBE_QN,
      { capName: "cap-notify-hard", periodStartIso: PERIOD, limit: 1000, profile: "burstable" },
      admin,
    )) as Record<string, unknown>;
    expect(result["ok"]).toBe(false);
    expect(result["code"]).toBe("cap_exceeded");
    expect(recordedNotifications).toHaveLength(0);
  });
});
