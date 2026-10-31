import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { addDurationSpec, COMPLIANCE_PROFILES } from "@cosmicdrift/kumiko-framework/compliance";
import { selectMany, updateMany } from "@cosmicdrift/kumiko-framework/db";
import { EXT_TENANT_DATA } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { userSessionTable } from "../../sessions/schema/user-session.ts";
import {
  INACTIVITY_TENANT,
  type InactivityTestStack,
  KEEP_SECRET,
  KEEP_URL,
  setupInactivityStack,
} from "./inactivity-test-stack.ts";

const RULE = { after: { months: 12 }, warnings: [{ days: 30 }, { days: 7 }] } as const;
const START = Temporal.Instant.from("2030-01-15T10:00:00Z");
// The cleanup job compares against the database clock, so its rows must be old in real time.
const LONG_AGO = Temporal.Instant.from("2020-01-01T00:00:00Z");
const DUE = START.toZonedDateTimeISO("UTC").add({ months: 12 }).toInstant();
const FIRST_WARNING_AT = DUE.subtract({ hours: 30 * 24 });
const SECOND_WARNING_AT = DUE.subtract({ hours: 7 * 24 });

let t: InactivityTestStack;

beforeAll(async () => {
  t = await setupInactivityStack(() => ({
    rule: RULE,
    keepAccountUrl: KEEP_URL,
    keepAccountTokenSecret: KEEP_SECRET,
    appName: "Acme",
  }));
});

afterAll(async () => {
  await t.stack.cleanup();
});

beforeEach(async () => {
  await t.reset();
  await t.seedTenantWithOwner();
});

describe("tenant-inactivity warning cycle", () => {
  test("warns once at due-30 and due-7, files the deletion request at the due date", async () => {
    await t.runJob();
    expect(t.sent).toHaveLength(0);

    t.clock.set(FIRST_WARNING_AT.subtract({ hours: 24 }));
    await t.runJob();
    expect(t.sent).toHaveLength(0);

    t.clock.set(FIRST_WARNING_AT);
    await t.runJob();
    await t.runJob();
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]?.subject).toContain(
      "Deletion request for your account Acme Corp on 2031-01-15",
    );

    t.clock.set(SECOND_WARNING_AT.subtract({ hours: 24 }));
    await t.runJob();
    expect(t.sent).toHaveLength(1);

    t.clock.set(SECOND_WARNING_AT);
    await t.runJob();
    expect(t.sent).toHaveLength(2);

    t.clock.set(DUE);
    await t.runJob();
    const tenant = await t.tenantRow();
    expect(tenant?.["status"]).toBe("destroyRequested");
    const wait = COMPLIANCE_PROFILES["eu-dsgvo"].tenantDestroyGracePeriod;
    expect(String(tenant?.["gracePeriodEnd"])).toBe(addDurationSpec(DUE, wait).toString());
  });
});

describe("tenant-inactivity activity and keep-account", () => {
  async function warnOnce(): Promise<void> {
    await t.runJob();
    t.clock.set(FIRST_WARNING_AT);
    await t.runJob();
    expect(t.sent).toHaveLength(1);
  }

  test("a real login after the first warning restarts the period", async () => {
    await warnOnce();
    const loginAt = FIRST_WARNING_AT.add({ hours: 5 });
    t.clock.set(loginAt);
    await t.loginOwner();

    const outlook = await t.queryState();
    const newDue = loginAt.toZonedDateTimeISO("UTC").add({ months: 12 }).toInstant();
    expect(outlook["nextStep"]).toBe("warning");
    expect(outlook["warningsSent"]).toBe(0);
    expect(outlook["nextStepAt"]).toBe(newDue.subtract({ hours: 30 * 24 }).toString());

    t.clock.set(SECOND_WARNING_AT);
    await t.runJob();
    t.clock.set(DUE);
    await t.runJob();
    expect(t.sent).toHaveLength(1);
    expect((await t.tenantRow())?.["status"]).toBe("active");
  });

  test("redeeming the mail link restarts the period and kills older links", async () => {
    await warnOnce();
    const firstToken = t.tokenInMail(0);

    t.clock.set(FIRST_WARNING_AT.add({ hours: 2 }));
    expect((await t.keepAccount(firstToken)).status).toBe(200);

    t.clock.set(SECOND_WARNING_AT);
    await t.runJob();
    t.clock.set(DUE);
    await t.runJob();
    expect(t.sent).toHaveLength(1);
    expect((await t.tenantRow())?.["status"]).toBe("active");

    const replay = await t.keepAccount(firstToken);
    expect(replay.status).toBe(422);
  });

  test("a garbage token is rejected like an expired one", async () => {
    await t.runJob();
    expect((await t.keepAccount("not-a-token")).status).toBe(422);
  });
});

describe("tenant-inactivity state", () => {
  test("a second run on the same day changes nothing", async () => {
    await t.runJob();
    const before = JSON.stringify(await t.stateRows());
    await t.runJob();
    expect(JSON.stringify(await t.stateRows())).toBe(before);
    t.clock.set(FIRST_WARNING_AT);
    await t.runJob();
    const afterWarning = JSON.stringify(await t.stateRows());
    await t.runJob();
    expect(JSON.stringify(await t.stateRows())).toBe(afterWarning);
  });

  test("session cleanup does not move lastActivityAt or the due date", async () => {
    const loginAt = START.add({ hours: 48 });
    t.clock.set(loginAt);
    await t.loginOwner();
    await t.runJob();
    const before = await t.queryState();
    expect(before["lastActivityAt"]).toBe(loginAt.toString());

    await updateMany(
      t.stack.db,
      userSessionTable,
      { expiresAt: LONG_AGO, revokedAt: LONG_AGO },
      { tenantId: INACTIVITY_TENANT },
    );
    await t.stack.jobRunner?.dispatch("sessions:job:cleanup", { olderThanDays: 0 });
    await t.stack.drainJobs();
    expect(await selectMany(t.stack.db, userSessionTable, { tenantId: INACTIVITY_TENANT })).toEqual(
      [],
    );

    t.clock.set(loginAt.add({ hours: 24 }));
    await t.runJob();
    expect(await t.queryState()).toEqual(before);
  });

  test("the state is erased with the tenant data", async () => {
    await t.runJob();
    expect(await t.stateRows()).toHaveLength(1);
    const hook = t.stack.registry
      .getExtensionUsages(EXT_TENANT_DATA)
      .find((usage) => usage.entityName === "tenant-inactivity-state");
    expect(hook).toBeDefined();
  });
});

describe("tenant-inactivity state query across tenants", () => {
  const OTHER_TENANT = testTenantId(7);

  test("a tenant owner sees only the own tenant, a SystemAdmin any tenant", async () => {
    await t.seedTenant(OTHER_TENANT);
    await t.runJob();
    const loginAt = START.add({ hours: 48 });
    t.clock.set(loginAt);
    const token = await t.loginOwner();
    await t.runJob();

    const own = await t.queryStateWithToken(token);
    expect(own.status).toBe(200);
    const ownBody = (await own.json()) as { data: Record<string, unknown> };
    expect(ownBody.data["lastActivityAt"]).toBe(loginAt.toString());

    const foreign = await t.queryStateWithToken(token, OTHER_TENANT);
    expect(foreign.status).toBe(403);
    expect(await foreign.text()).not.toContain("lastActivityAt");

    const systemAdminOnOwn = await t.queryState(INACTIVITY_TENANT);
    expect(systemAdminOnOwn["lastActivityAt"]).toBe(loginAt.toString());
    const systemAdminOnOther = await t.queryState(OTHER_TENANT);
    expect(systemAdminOnOther["lastActivityAt"]).toBeNull();
  });
});

describe("tenant-inactivity write load", () => {
  test("authenticated requests never write the state; only the job does", async () => {
    const token = await t.loginOwner();
    for (let request = 0; request < 25; request++) {
      const res = await t.stack.http.raw(
        "POST",
        "/api/query",
        { type: "tenant-inactivity:query:state", payload: {} },
        { Authorization: `Bearer ${token}` },
      );
      expect(res.status).toBe(200);
    }
    expect(await t.stateRows()).toHaveLength(0);
    await t.runJob();
    expect(await t.stateRows()).toHaveLength(1);
  });
});
