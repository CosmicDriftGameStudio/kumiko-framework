import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  type InactivityTestStack,
  KEEP_SECRET,
  KEEP_URL,
  setupInactivityStack,
} from "./inactivity-test-stack.ts";

const RULE = { after: { months: 12 }, warnings: [{ days: 30 }, { days: 7 }] } as const;
const START = Temporal.Instant.from("2030-01-15T10:00:00Z");
const DUE = START.toZonedDateTimeISO("UTC").add({ months: 12 }).toInstant();
const FIRST_WARNING_AT = DUE.subtract({ hours: 30 * 24 });
const SECOND_WARNING_AT = DUE.subtract({ hours: 7 * 24 });

let t: InactivityTestStack;
let duringProbe: (() => Promise<void>) | undefined;

beforeAll(async () => {
  t = await setupInactivityStack(() => ({
    rule: RULE,
    keepAccountUrl: KEEP_URL,
    keepAccountTokenSecret: KEEP_SECRET,
    activitySources: [
      async () => {
        await duringProbe?.();
        return null;
      },
    ],
  }));
});

afterAll(async () => {
  await t.stack.cleanup();
});

beforeEach(async () => {
  duringProbe = undefined;
  await t.reset();
  await t.seedTenantWithOwner();
  await t.runJob();
  t.clock.set(FIRST_WARNING_AT);
  await t.runJob();
  expect(t.sent).toHaveLength(1);
});

describe("a keep link redeemed while the job is busy", () => {
  test("is not overwritten by the job's warning", async () => {
    const token = t.tokenInMail(0);
    t.clock.set(SECOND_WARNING_AT);
    duringProbe = async () => {
      duringProbe = undefined;
      expect((await t.keepAccount(token)).status).toBe(200);
    };
    await t.runJob();

    const state = await t.queryState();
    expect(state["warningsSent"]).toBe(0);
  });

  test("does not end in a deletion request", async () => {
    const token = t.tokenInMail(0);
    t.clock.set(DUE);
    duringProbe = async () => {
      duringProbe = undefined;
      expect((await t.keepAccount(token)).status).toBe(200);
    };
    await t.runJob();

    expect((await t.tenantRow())?.["status"]).toBe("active");
    expect((await t.queryState())["warningsSent"]).toBe(0);
  });
});
