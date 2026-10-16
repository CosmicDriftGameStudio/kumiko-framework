// A calendar cap over the hard limit answers 429 cap_exceeded with the period end
// as resetAt and a matching Retry-After header, over the real HTTP stack.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createEntityExecutor, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import * as z from "zod";
import {
  calendarMonthPeriodEndIso,
  currentCalendarMonthStartIso,
  type SoftHitNotifier,
} from "../enforce-cap.js";
import { capCounterEntity } from "../entity.js";
import { capCounterFeature } from "../feature.js";
import { withCapEnforcement } from "../with-cap-enforcement.js";

const noopNotifier: SoftHitNotifier = () => {};
const CUSTOM_I18N_KEY = "probe:errors.cap-exceeded";
const OVERRIDE_WINDOW_SECONDS = 2 * 60 * 60;

const monthStart = currentCalendarMonthStartIso();
const overrideEndIso = Temporal.Now.instant().add({ seconds: OVERRIDE_WINDOW_SECONDS }).toString();

const monthlyProbe = withCapEnforcement(
  {
    name: "monthly",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  },
  () => ({
    capName: "retry-after-monthly",
    periodStartIso: monthStart,
    limit: 1,
    profile: "hardSlot",
    notify: noopNotifier,
    i18nKey: CUSTOM_I18N_KEY,
  }),
);

const overrideProbe = withCapEnforcement(
  {
    name: "override",
    schema: z.object({}),
    access: { roles: ["TenantAdmin"] },
    handler: async () => ({ isSuccess: true as const, data: {} }),
  },
  () => ({
    capName: "retry-after-override",
    periodStartIso: monthStart,
    periodEndIso: overrideEndIso,
    limit: 1,
    profile: "hardSlot",
    notify: noopNotifier,
  }),
);

const probeFeature = defineFeature("probe", (r) => {
  r.writeHandler(monthlyProbe);
  r.writeHandler(overrideProbe);
});

const { table: capCounterTable } = createEntityExecutor("cap-counter", capCounterEntity);

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({ features: [capCounterFeature, probeFeature] });
  await unsafeCreateEntityTable(stack.db, capCounterEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [capCounterTable, eventsTable]);
});

const admin = createTestUser({
  id: 1301,
  tenantId: testTenantId(1301),
  roles: ["TenantAdmin"],
});

async function writeRaw(type: string) {
  const token = await stack.jwt.sign(admin);
  return stack.app.request(
    new Request("http://test.local/api/write", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, payload: {} }),
    }),
  );
}

type CapErrorBody = {
  error: {
    code: string;
    i18nKey: string;
    details: { resetAt: string; retryAfterSeconds: number };
  };
};

function expectRetryAfterMatches(res: Response, resetAt: string): number {
  const header = Number(res.headers.get("Retry-After"));
  expect(Number.isInteger(header)).toBe(true);
  expect(header).toBeGreaterThan(0);
  const secondsToReset = (Temporal.Instant.from(resetAt).epochMilliseconds - Date.now()) / 1000;
  // Only the second rounding and the request latency may separate header and clock.
  expect(Math.abs(header - secondsToReset)).toBeLessThan(10);
  return header;
}

describe("cap_exceeded carries the period end", () => {
  test("monthly cap: 429, resetAt = end of the calendar month, Retry-After matches, custom i18nKey", async () => {
    expect((await writeRaw("probe:write:monthly")).status).toBe(200);

    const res = await writeRaw("probe:write:monthly");
    expect(res.status).toBe(429);
    const body = (await res.json()) as CapErrorBody;
    expect(body.error.code).toBe("cap_exceeded");
    expect(body.error.i18nKey).toBe(CUSTOM_I18N_KEY);
    expect(body.error.details.resetAt).toBe(calendarMonthPeriodEndIso(monthStart));
    const header = expectRetryAfterMatches(res, body.error.details.resetAt);
    expect(body.error.details.retryAfterSeconds).toBe(header);
  });

  test("periodEndIso override wins over the calendar month", async () => {
    expect((await writeRaw("probe:write:override")).status).toBe(200);

    const res = await writeRaw("probe:write:override");
    expect(res.status).toBe(429);
    const body = (await res.json()) as CapErrorBody;
    expect(body.error.code).toBe("cap_exceeded");
    expect(body.error.details.resetAt).toBe(overrideEndIso);
    const header = expectRetryAfterMatches(res, overrideEndIso);
    expect(header).toBeLessThanOrEqual(OVERRIDE_WINDOW_SECONDS);
  });
});
