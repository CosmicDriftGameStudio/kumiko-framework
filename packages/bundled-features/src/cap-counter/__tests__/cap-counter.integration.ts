// Full-stack integration test for cap-counter. Drives the increment
// + get + enforceCap path through the dispatcher + real DB.
//
// **Test-Probe-Pattern:** a tiny one-off feature with a write-handler
// that calls enforceCap → returns the result-state so the test can
// assert. Mirrors the mail-foundation / file-foundation integration
// test pattern.

import type { DbConnection } from "@kumiko/framework/db";
import { defineFeature, type WriteHandlerDef } from "@kumiko/framework/engine";
import { createEventsTable } from "@kumiko/framework/event-store";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
} from "@kumiko/framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { z } from "zod";
import { CapCounterHandlers, CapCounterQueries } from "../constants";
import {
  CapExceededError,
  currentCalendarMonthStartIso,
  enforceCap,
  enforceRollingCap,
} from "../enforce-cap";
import { capCounterEntity } from "../entity";
import { capCounterFeature } from "../feature";

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

// Sister probe for the rolling-window flavour. Same pattern as
// `enforceHandler` above — drives `enforceRollingCap` through the
// dispatcher so the test sees a real ctx with real db + real
// tenant-scope.
const ENFORCE_ROLLING_PROBE_QN = "cap-test:write:enforce-rolling";
const enforceRollingHandler: WriteHandlerDef = {
  name: "enforce-rolling",
  schema: z.object({
    capName: z.string(),
    windowDays: z.number(),
    limit: z.number(),
    profile: z.enum(["burstable", "storage", "hardSlot", "egress"]),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    try {
      const result = await enforceRollingCap(
        ctx,
        event.payload as Parameters<typeof enforceRollingCap>[1],
      );
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

const enforceProbeFeature = defineFeature("cap-test", (r) => {
  r.writeHandler(enforceHandler);
  r.writeHandler(enforceRollingHandler);
});

// --- Setup ---

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [capCounterFeature, enforceProbeFeature],
  });
  db = stack.db;

  await createEntityTable(db, capCounterEntity);
  await createEventsTable(db);
});

afterAll(async () => {
  await stack.cleanup();
});

// Fixed period used for calendar-counter scenarios. Tests don't care
// which month — just need a stable iso-string so `increment` +
// `readCounter` hit the same aggregate.
const PERIOD = "2026-05-01T00:00:00Z";
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

async function readCounter(
  user: ReturnType<typeof adminFor>,
  capName: string,
  periodStartIso: string = PERIOD,
) {
  return (await stack.http.queryOk(
    CapCounterQueries.getCounter,
    { capName, periodStartIso },
    user,
  )) as Record<string, unknown> | null;
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

// --- Scenario 5: Rolling-Window Counter (Sprint 4) ---
//
// Echte Verdrahtung beweisen: incrementRollingCap appendet ein
// rolling-incremented-Event in den event-store, enforceRollingCap
// liest das Event aus dem Window und summiert. Beide gehen über den
// Dispatcher mit dem realen ctx.

describe("scenario 5: rolling-window through dispatcher", () => {
  test("incrementRolling appends a rolling-incremented-event without creating a projection-row", async () => {
    const admin = adminFor(901);
    await incrementRolling(admin, "ai-tokens-7d", 1500);

    // Drift-Pin: Rolling-Counter MUSS den Calendar-Counter NICHT
    // berühren. Wenn ein Refactor die Pfade vermischt, taucht hier
    // plötzlich eine Row auf, die nichts mit dem rolling-stream zu
    // tun hat.
    const calendarRow = await readCounter(admin, "ai-tokens-7d");
    expect(calendarRow).toBeNull();
  });

  test("enforceRollingCap summiert mehrere increment-events innerhalb des Windows", async () => {
    const admin = adminFor(902);
    await incrementRolling(admin, "ai-tokens-7d", 1000);
    await incrementRolling(admin, "ai-tokens-7d", 2500);
    await incrementRolling(admin, "ai-tokens-7d", 500);

    const result = (await stack.http.writeOk(
      ENFORCE_ROLLING_PROBE_QN,
      { capName: "ai-tokens-7d", windowDays: 7, limit: 10000, profile: "burstable" },
      admin,
    )) as Record<string, unknown>;

    expect(result["ok"]).toBe(true);
    expect(result["state"]).toBe("ok");
    expect(result["value"]).toBe(4000);
  });

  test("at soft-threshold (11000, soft=1.1×10000) → soft-hit, crossed=false", async () => {
    const admin = adminFor(903);
    await incrementRolling(admin, "ai-tokens-7d", 6000);
    await incrementRolling(admin, "ai-tokens-7d", 5000);

    const result = (await stack.http.writeOk(
      ENFORCE_ROLLING_PROBE_QN,
      { capName: "ai-tokens-7d", windowDays: 7, limit: 10000, profile: "burstable" },
      admin,
    )) as Record<string, unknown>;

    expect(result["state"]).toBe("soft-hit");
    expect(result["value"]).toBe(11000);
    // Rolling-Counter hat keine projection-row → crossed ist konstant false.
    expect(result["crossed"]).toBe(false);
  });

  test("at hard-threshold (12000) → cap_exceeded code returned", async () => {
    const admin = adminFor(904);
    await incrementRolling(admin, "ai-tokens-7d", 6000);
    await incrementRolling(admin, "ai-tokens-7d", 6000);

    const result = (await stack.http.writeOk(
      ENFORCE_ROLLING_PROBE_QN,
      { capName: "ai-tokens-7d", windowDays: 7, limit: 10000, profile: "burstable" },
      admin,
    )) as Record<string, unknown>;

    expect(result["ok"]).toBe(false);
    expect(result["code"]).toBe("cap_exceeded");
    expect(result["currentValue"]).toBe(12000);
  });

  test("rolling-counter-Stream isoliert pro (tenant, capName) — fremder cap zählt nicht", async () => {
    const admin = adminFor(905);
    await incrementRolling(admin, "ai-tokens-7d", 9999);
    await incrementRolling(admin, "egress-bytes-24h", 100);

    const result = (await stack.http.writeOk(
      ENFORCE_ROLLING_PROBE_QN,
      { capName: "egress-bytes-24h", windowDays: 1, limit: 1000, profile: "egress" },
      admin,
    )) as Record<string, unknown>;

    // Egress-window sieht NUR die 100 vom egress-cap — die 9999 vom
    // ai-tokens-cap sind ein anderer Aggregate-Stream.
    expect(result["state"]).toBe("ok");
    expect(result["value"]).toBe(100);
  });

  test("rolling-counter ist tenant-isoliert — tenant A's increments leaken nicht zu tenant B", async () => {
    const adminA = adminFor(906);
    const adminB = adminFor(907);
    await incrementRolling(adminA, "rolling-iso", 5000);
    await incrementRolling(adminB, "rolling-iso", 100);

    const resultB = (await stack.http.writeOk(
      ENFORCE_ROLLING_PROBE_QN,
      { capName: "rolling-iso", windowDays: 7, limit: 10000, profile: "burstable" },
      adminB,
    )) as Record<string, unknown>;

    expect(resultB["state"]).toBe("ok");
    expect(resultB["value"]).toBe(100);
  });
});
