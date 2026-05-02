// Full-stack integration test for cap-counter. Drives the increment
// + get + enforceCap path through the dispatcher + real DB.
//
// **Test-Probe-Pattern:** a tiny one-off feature with a write-handler
// that calls enforceCap → returns the result-state so the test can
// assert. Mirrors the mail-foundation / file-foundation integration
// test pattern.

import type { DbConnection } from "@kumiko/framework/db";
import { defineFeature, defineWriteHandler } from "@kumiko/framework/engine";
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
  ROLLING_WINDOW_PERIOD,
} from "../enforce-cap";
import { capCounterEntity } from "../entity";
import { capCounterFeature } from "../feature";

// --- Test-Probe-Feature: drives enforceCap from inside a real handler ---

const ENFORCE_PROBE_QN = "cap-test:write:enforce";
const enforceProbeFeature = defineFeature("cap-test", (r) => {
  r.writeHandler(
    defineWriteHandler({
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
    }),
  );
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

const ROLLING = ROLLING_WINDOW_PERIOD;
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
  periodStartIso = ROLLING,
) {
  await stack.http.writeOk(CapCounterHandlers.increment, { capName, amount, periodStartIso }, user);
}

async function readCounter(
  user: ReturnType<typeof adminFor>,
  capName: string,
  periodStartIso = ROLLING,
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
      { capName: "cap-2-mails", periodStartIso: ROLLING, limit: 1000, profile: "burstable" },
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
      { capName: "cap-2-mails", periodStartIso: ROLLING, limit: 1000, profile: "burstable" },
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
      { capName: "cap-2-mails", periodStartIso: ROLLING, limit: 1000, profile: "burstable" },
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
