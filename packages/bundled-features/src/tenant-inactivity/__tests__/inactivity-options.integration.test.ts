import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import type { InactivityRule } from "../inactivity-plan.ts";
import {
  type InactivityTestStack,
  KEEP_URL,
  setupInactivityStack,
} from "./inactivity-test-stack.ts";

const FREE_RULE: InactivityRule = {
  after: { months: 12 },
  warnings: [{ days: 30 }, { days: 7 }],
};
const START = Temporal.Instant.from("2030-01-15T10:00:00Z");
const HOURS_PER_DAY = 24;

type Tier = "free" | "paid";
let tier: Tier = "paid";
let externalActivity: Temporal.Instant | null = null;
let sourceDb: TenantDb | undefined;
let t: InactivityTestStack;

function afterMonths(from: Temporal.Instant, months: number): Temporal.Instant {
  return from.toZonedDateTimeISO("UTC").add({ months }).toInstant();
}

beforeAll(async () => {
  t = await setupInactivityStack(
    () => ({
      resolveTier: async () => tier,
      rulesByTier: { free: FREE_RULE, paid: null },
      keepAccountUrl: KEEP_URL,
      appName: "Acme",
      activitySources: [
        async ({ db }) => {
          sourceDb = db;
          return externalActivity;
        },
      ],
    }),
    START,
  );
});

afterAll(async () => {
  await t.stack.cleanup();
});

beforeEach(async () => {
  await t.reset();
  tier = "paid";
  externalActivity = null;
  sourceDb = undefined;
  await t.seedTenantWithOwner();
});

describe("tenant-inactivity tiers", () => {
  test("a tier without a rule is never warned and shows as exempt", async () => {
    await t.runJob();
    t.clock.set(afterMonths(START, 24));
    await t.runJob();
    expect(t.sent).toHaveLength(0);
    expect((await t.tenantRow())?.["status"]).toBe("active");
    const outlook = await t.queryState();
    expect(outlook["exempt"]).toBe(true);
    expect(outlook["nextStep"]).toBeNull();
  });

  test("after a downgrade to free the period starts at the change", async () => {
    await t.runJob();
    const changeAt = afterMonths(START, 24);
    t.clock.set(changeAt);
    await t.runJob();
    tier = "free";

    const firstWarning = afterMonths(changeAt, 12).subtract({ hours: 30 * HOURS_PER_DAY });
    t.clock.set(firstWarning.subtract({ hours: 1 }));
    await t.runJob();
    expect(t.sent).toHaveLength(0);

    t.clock.set(firstWarning);
    await t.runJob();
    expect(t.sent).toHaveLength(1);
  });

  test("without a token secret the mail links to the plain keep-account page", async () => {
    tier = "free";
    await t.runJob();
    t.clock.set(afterMonths(START, 12).subtract({ hours: 30 * HOURS_PER_DAY }));
    await t.runJob();
    expect(t.sent[0]?.html).toContain(KEEP_URL);
    expect(t.sent[0]?.html).not.toContain("#token");
  });
});

describe("tenant-inactivity activity sources", () => {
  test("activity reported by a source cancels the warning and restarts the period", async () => {
    tier = "free";
    await t.runJob();
    const firstWarning = afterMonths(START, 12).subtract({ hours: 30 * HOURS_PER_DAY });
    externalActivity = firstWarning.subtract({ hours: 2 });
    t.clock.set(firstWarning);
    await t.runJob();
    expect(t.sent).toHaveLength(0);
    const outlook = await t.queryState();
    expect(outlook["lastActivityAt"]).toBe(externalActivity.toString());
    expect(outlook["nextStepAt"]).toBe(
      afterMonths(externalActivity, 12)
        .subtract({ hours: 30 * HOURS_PER_DAY })
        .toString(),
    );
  });
});

describe("tenant-inactivity activity source db", () => {
  test("the source receives the tenant db and can read through it", async () => {
    tier = "free";
    await t.runJob();
    t.clock.set(afterMonths(START, 12).subtract({ hours: 30 * HOURS_PER_DAY }));
    await t.runJob();
    expect(sourceDb).toBeDefined();
    const memberships = await sourceDb?.selectMany(tenantMembershipsTable, {});
    expect(memberships).toHaveLength(1);
  });
});

describe("tenant-inactivity recipients", () => {
  test("an Admin without the TenantOwner role gets the warning, once per user", async () => {
    await t.reset();
    tier = "free";
    await t.seedTenantWithMembers([
      { email: "admin@inactivity.test", roles: ["Admin", "TenantOwner"] },
      { email: "plain@inactivity.test", roles: ["User"] },
      { email: "onlyadmin@inactivity.test", roles: ["Admin"] },
    ]);
    await t.runJob();
    t.clock.set(afterMonths(START, 12).subtract({ hours: 30 * HOURS_PER_DAY }));
    await t.runJob();
    expect(t.sent.map((mail) => mail.to).sort()).toEqual([
      "admin@inactivity.test",
      "onlyadmin@inactivity.test",
    ]);
  });
});
