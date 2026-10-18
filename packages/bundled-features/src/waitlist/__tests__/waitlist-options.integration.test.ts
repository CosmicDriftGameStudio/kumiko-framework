import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createTenantDb, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { type SessionUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { deleteRows, seedRow, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { type TestStack, unsafePushTables } from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { WAITLIST_STATUS, WaitlistHandlers } from "../constants.js";
import { waitlistEntryTable } from "../entity.js";
import { importWaitlistEntry } from "../import.js";
import {
  migrateLegacyWaitlist,
  offlotLegacyTable,
  publicstatusLegacyTable,
} from "../legacy-migrate.js";
import {
  acceptInviteAsNewUser,
  createWaitlistTestStack,
  resetWaitlistTestState,
  SYSTEM_ADMIN,
  signUpOpenly,
} from "./waitlist-test-stack.js";

const TENANT_ADMIN: SessionUser = {
  id: crypto.randomUUID(),
  tenantId: crypto.randomUUID(),
  roles: ["TenantAdmin"],
};

function submitOn(target: TestStack, email: string) {
  return target.http.raw(
    "POST",
    "/api/write",
    {
      type: WaitlistHandlers.submit,
      payload: { name: "Ada Lovelace", email, locale: "en", message: "hello" },
    },
    { "x-forwarded-for": "198.51.100.9" },
  );
}

async function rowsOf(target: TestStack) {
  return selectMany(target.db, waitlistEntryTable, {});
}

describe("waitlist rateLimit option", () => {
  test("the default limits one IP to five submits per window", async () => {
    const limited = await createWaitlistTestStack({ emailRateLimits: [] });
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        statuses.push((await submitOn(limited, `l${attempt}@example.com`)).status);
      }
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    } finally {
      await limited.cleanup();
    }
  });

  test("{ disabled: true } leaves repeated submits from one IP unlimited", async () => {
    const open = await createWaitlistTestStack({
      emailRateLimits: [],
      rateLimit: { disabled: true, reason: "a CDN throttles the route upstream" },
    });
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        statuses.push((await submitOn(open, `o${attempt}@example.com`)).status);
      }
      expect(statuses.every((status) => status === 200)).toBe(true);
    } finally {
      await open.cleanup();
    }
  });

  test("a custom limit replaces the default", async () => {
    const custom = await createWaitlistTestStack({
      emailRateLimits: [],
      rateLimit: { per: "ip+handler", limit: 2, windowSeconds: 600 },
    });
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        statuses.push((await submitOn(custom, `c${attempt}@example.com`)).status);
      }
      expect(statuses).toEqual([200, 200, 429]);
    } finally {
      await custom.cleanup();
    }
  });
});

describe("waitlist export and purge", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await createWaitlistTestStack({ rateLimit: { disabled: true, reason: "test" } });
  });
  afterAll(async () => {
    await stack.cleanup();
  });
  beforeEach(async () => {
    await resetWaitlistTestState(stack);
  });

  test("export hands over every entry with its personal data and needs SystemAdmin", async () => {
    await submitOn(stack, "first@example.com");
    await submitOn(stack, "second@example.com");

    const exported = await stack.http.writeOk<{
      count: number;
      entries: readonly { email: string; name: string; message: string }[];
    }>(WaitlistHandlers.export, {}, SYSTEM_ADMIN);
    expect(exported.count).toBe(2);
    expect(exported.entries.map((entry) => entry.email).sort()).toEqual([
      "first@example.com",
      "second@example.com",
    ]);
    expect(exported.entries[0]?.name).toBe("Ada Lovelace");
    expect(exported.entries[0]?.message).toBe("hello");

    const denied = await stack.http.writeErr(WaitlistHandlers.export, {}, TENANT_ADMIN);
    expect(denied.httpStatus).toBe(403);
    const anonymous = await stack.http.raw("POST", "/api/write", {
      type: WaitlistHandlers.export,
      payload: {},
    });
    expect([401, 403]).toContain(anonymous.status);
  });

  test("purge refuses a stale confirmCount and keeps the entries", async () => {
    await submitOn(stack, "keep@example.com");
    const failure = await stack.http.writeErr(
      WaitlistHandlers.purge,
      { confirmCount: 5 },
      SYSTEM_ADMIN,
    );
    expect(failure.httpStatus).toBe(422);
    expect(await rowsOf(stack)).toHaveLength(1);
  });

  test("purge erases every entry when the count matches and refuses non-admins", async () => {
    await submitOn(stack, "gone1@example.com");
    await submitOn(stack, "gone2@example.com");

    const denied = await stack.http.writeErr(
      WaitlistHandlers.purge,
      { confirmCount: 2 },
      TENANT_ADMIN,
    );
    expect(denied.httpStatus).toBe(403);
    expect(await rowsOf(stack)).toHaveLength(2);

    const purged = await stack.http.writeOk<{ purged: number }>(
      WaitlistHandlers.purge,
      { confirmCount: 2 },
      SYSTEM_ADMIN,
    );
    expect(purged.purged).toBe(2);
    expect(await rowsOf(stack)).toHaveLength(0);
    const after = await stack.http.writeOk<{ count: number }>(
      WaitlistHandlers.export,
      {},
      SYSTEM_ADMIN,
    );
    expect(after.count).toBe(0);
  });

  test("exportPurge: false leaves both handlers out", async () => {
    const without = await createWaitlistTestStack({ exportPurge: false });
    try {
      const res = await without.http.raw(
        "POST",
        "/api/write",
        { type: WaitlistHandlers.export, payload: {} },
        { "x-test-user": "ignored" },
      );
      expect(res.status).not.toBe(200);
      const failure = await without.http.writeErr(WaitlistHandlers.export, {}, SYSTEM_ADMIN);
      expect(failure.httpStatus).toBe(404);
    } finally {
      await without.cleanup();
    }
  });
});

describe("waitlist linkOnSignup option", () => {
  async function inviteAndAccept(target: TestStack, email: string): Promise<string> {
    await submitOn(target, email);
    const [entry] = await rowsOf(target);
    const invited = await target.http.writeOk<{ tenantId: string }>(
      WaitlistHandlers.invite,
      { id: String(entry?.["id"]) },
      SYSTEM_ADMIN,
    );
    await acceptInviteAsNewUser(target, email);
    return invited.tenantId;
  }

  test("accepting the invite as first tenant admin marks the entry provisioned", async () => {
    const linking = await createWaitlistTestStack({
      linkOnSignup: true,
      rateLimit: { disabled: true, reason: "test" },
    });
    try {
      const tenantId = await inviteAndAccept(linking, "linked@example.com");
      await waitFor(async () => {
        await linking.eventDispatcher?.runOnce();
        const [current] = await rowsOf(linking);
        expect(current?.["status"]).toBe(WAITLIST_STATUS.Provisioned);
      });
      const [entry] = await rowsOf(linking);
      expect(entry?.["status"]).toBe(WAITLIST_STATUS.Provisioned);
      expect(entry?.["linkedTenantId"]).toBe(tenantId);
      expect(entry?.["provisionedAt"]).toBeDefined();
    } finally {
      await linking.cleanup();
    }
  });

  test("open signup with an invited email marks the entry provisioned with the new tenant", async () => {
    const linking = await createWaitlistTestStack({
      linkOnSignup: true,
      rateLimit: { disabled: true, reason: "test" },
    });
    try {
      await submitOn(linking, "open-signup@example.com");
      const [submitted] = await rowsOf(linking);
      const invited = await linking.http.writeOk<{ tenantId: string }>(
        WaitlistHandlers.invite,
        { id: String(submitted?.["id"]) },
        SYSTEM_ADMIN,
      );
      await signUpOpenly(linking, "open-signup@example.com");
      await waitFor(async () => {
        await linking.eventDispatcher?.runOnce();
        const [current] = await rowsOf(linking);
        expect(current?.["status"]).toBe(WAITLIST_STATUS.Provisioned);
      });
      const [entry] = await rowsOf(linking);
      expect(typeof entry?.["linkedTenantId"]).toBe("string");
      expect(entry?.["linkedTenantId"]).not.toBe(invited.tenantId);
    } finally {
      await linking.cleanup();
    }
  });

  test("without the option the entry stays invited", async () => {
    const plain = await createWaitlistTestStack({
      rateLimit: { disabled: true, reason: "test" },
    });
    try {
      await inviteAndAccept(plain, "unlinked@example.com");
      const [entry] = await rowsOf(plain);
      expect(entry?.["status"]).toBe(WAITLIST_STATUS.Invited);
      expect(entry?.["provisionedAt"] ?? null).toBeNull();
    } finally {
      await plain.cleanup();
    }
  });
});

describe("legacy waitlist migration", () => {
  let stack: TestStack;
  const OFFLOT_TABLE = "legacy_offlot_waitlist";
  const PUBLICSTATUS_TABLE = "legacy_publicstatus_waitlist";
  const offlotTable = offlotLegacyTable(OFFLOT_TABLE);
  const publicstatusTable = publicstatusLegacyTable(PUBLICSTATUS_TABLE);
  // Fresh ids per test: the event store outlives the table reset and a derived entry id would collide.
  let offlotId = "";
  let publicstatusId = "";

  beforeAll(async () => {
    stack = await createWaitlistTestStack({});
    await unsafePushTables(stack.db, { offlotTable, publicstatusTable });
  });
  afterAll(async () => {
    await stack.cleanup();
  });
  beforeEach(async () => {
    await resetWaitlistTestState(stack);
    offlotId = crypto.randomUUID();
    publicstatusId = crypto.randomUUID();
    await deleteRows(stack.db, offlotTable, {});
    await deleteRows(stack.db, publicstatusTable, {});
    await seedRow(stack.db, offlotTable, {
      id: offlotId,
      name: "Dealer Dan",
      email: "Dan@Dealer.example",
      dealership: "Dan Motors",
      city: "Valencia",
      stock: "11-30",
      country: "ES",
      locale: "es",
      status: "invited",
      submittedAt: Temporal.Instant.from("2026-08-01T10:00:00Z"),
      invitedAt: Temporal.Instant.from("2026-08-02T10:00:00Z"),
      invitedBy: "admin-1",
      notes: "call back",
    });
    await seedRow(stack.db, publicstatusTable, {
      id: publicstatusId,
      email: "lead@apex.example",
      createdAt: Temporal.Instant.from("2026-07-01T08:00:00Z"),
    });
  });

  const offlotOptions = {
    from: "offlot",
    dryRun: false,
    sourceTable: OFFLOT_TABLE,
    defaultLocale: "en",
  } as const;
  const publicstatusOptions = {
    from: "publicstatus",
    dryRun: false,
    sourceTable: PUBLICSTATUS_TABLE,
    defaultLocale: "de",
  } as const;

  test("dry run reports what would be created and writes nothing", async () => {
    const report = await migrateLegacyWaitlist(stack.db, { ...offlotOptions, dryRun: true });
    expect(report).toEqual({ read: 1, created: 1, skipped: 0, unreadable: 0 });
    expect(await rowsOf(stack)).toHaveLength(0);
  });

  test("offlot rows land in the FW entity; the second run writes nothing", async () => {
    const first = await migrateLegacyWaitlist(stack.db, offlotOptions);
    expect(first).toEqual({ read: 1, created: 1, skipped: 0, unreadable: 0 });

    const [entry] = await rowsOf(stack);
    expect(entry?.["name"]).toBe("Dealer Dan");
    expect(entry?.["email"]).toBe("dan@dealer.example");
    expect(entry?.["company"]).toBe("Dan Motors");
    expect(entry?.["locale"]).toBe("es");
    expect(entry?.["status"]).toBe(WAITLIST_STATUS.Invited);
    expect(entry?.["invitedBy"]).toBe("admin-1");
    expect(String(entry?.["message"])).toBe(
      "City: Valencia\nStock: 11-30\nCountry: ES\nNotes: call back",
    );
    expect(String(entry?.["submittedAt"])).toContain("2026-08-01T10:00:00");

    const second = await migrateLegacyWaitlist(stack.db, offlotOptions);
    expect(second).toEqual({ read: 1, created: 0, skipped: 1, unreadable: 0 });
    expect(await rowsOf(stack)).toHaveLength(1);
  });

  test("publicstatus rows become pending entries with the default locale; re-run is a no-op", async () => {
    const first = await migrateLegacyWaitlist(stack.db, publicstatusOptions);
    expect(first).toEqual({ read: 1, created: 1, skipped: 0, unreadable: 0 });
    const [entry] = await rowsOf(stack);
    expect(entry?.["email"]).toBe("lead@apex.example");
    expect(entry?.["name"]).toBe("lead");
    expect(entry?.["locale"]).toBe("de");
    expect(entry?.["status"]).toBe(WAITLIST_STATUS.Pending);

    const second = await migrateLegacyWaitlist(stack.db, publicstatusOptions);
    expect(second).toEqual({ read: 1, created: 0, skipped: 1, unreadable: 0 });
    expect(await rowsOf(stack)).toHaveLength(1);
  });

  test("a row without a readable status is counted unreadable and not imported", async () => {
    await seedRow(stack.db, offlotTable, {
      id: crypto.randomUUID(),
      name: "Odd",
      email: "odd@example.com",
      locale: "en",
      status: "archived",
      submittedAt: Temporal.Instant.from("2026-08-03T10:00:00Z"),
    });
    const report = await migrateLegacyWaitlist(stack.db, offlotOptions);
    expect(report).toEqual({ read: 2, created: 1, skipped: 0, unreadable: 1 });
  });

  test("importWaitlistEntry keeps the same source key on one id", async () => {
    const db = createTenantDb({ db: stack.db, tenantId: SYSTEM_TENANT_ID, mode: "system" });
    const entry = {
      sourceKey: `x:${crypto.randomUUID()}`,
      name: "N",
      email: "n@example.com",
      locale: "en",
      status: WAITLIST_STATUS.Pending,
      submittedAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    } as const;
    expect(await importWaitlistEntry(db, entry)).toBe("created");
    expect(await importWaitlistEntry(db, entry)).toBe("skipped");
  });
});
