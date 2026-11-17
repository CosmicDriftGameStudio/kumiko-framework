// Subject rows of the cap counter: one row per (tenant, cap, period, HMAC of subject key) next
// to the tenant-wide row. Drives bookCapUsage through a real handler and the forget path directly.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  InMemoryKmsAdapter,
  subjectKeyForUser,
} from "@cosmicdrift/kumiko-framework/crypto";
import { createTenantDb, type DbConnection, selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  type TenantId,
  type WriteHandlerDef,
} from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createCryptoShreddingFeature } from "../../crypto-shredding/feature.ts";
import { bookCapUsage, readCalendarCapCounter } from "../book-cap-usage.ts";
import { reserveCalendarCapUsage } from "../calendar-cap-usage-reservation.ts";
import {
  capSubjectHash,
  forgetCapCounterSubject,
  TENANT_WIDE_SUBJECT_HASH,
} from "../cap-subject.ts";
import { CapCounterHandlers } from "../constants.ts";
import { createCapCounterFeature } from "../feature.ts";
import { capCountersTable, capReservationsTable } from "../tables.ts";
import { withCapEnforcement } from "../with-cap-enforcement.ts";
import { fetchCounterValue } from "./read-counter.ts";

const BOOK_QN = "cap-subject-test:write:book";
const CAP = "cap-subject-mails";
const MAY = "2026-05-01T00:00:00Z";
const JUNE = "2026-06-01T00:00:00Z";

const bookHandler: WriteHandlerDef = {
  name: "book",
  schema: z.object({
    capName: z.string(),
    periodStartIso: z.string(),
    subjectKey: z.string().optional(),
  }),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    const { capName, periodStartIso, subjectKey } = event.payload as {
      capName: string;
      periodStartIso: string;
      subjectKey?: string;
    };
    const { value } = await bookCapUsage(ctx, {
      capName,
      periodStartIso,
      ...(subjectKey !== undefined && { subjectKey }),
    });
    return { isSuccess: true as const, data: { value } };
  },
};

const SHARE_PERIOD = "2026-07-01T00:00:00Z";
const SHARE_CAP = "cap-subject-share";
const ROLLBACK_CAP = "cap-subject-rollback";
const FORGET_CAP = "cap-subject-forget";
const FORGET_RESERVED_CAP = "cap-subject-forget-reserved";

const noNotify = () => {};

const shareInner: WriteHandlerDef = {
  name: "share-send",
  schema: z.object({}),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async () => ({ isSuccess: true as const, data: { sent: true } }),
};
const shareHandler = withCapEnforcement(shareInner, (event) => ({
  capName: SHARE_CAP,
  periodStartIso: SHARE_PERIOD,
  limit: 10,
  profile: "hardSlot",
  notify: noNotify,
  subject: { key: subjectKeyForUser(event.user.id), share: 0.5 },
}));

const failInner: WriteHandlerDef = {
  name: "fail-after-reserve",
  schema: z.object({}),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async () => {
    throw new Error("fail-after-reservation-on-purpose");
  },
};
const failHandler = withCapEnforcement(failInner, (event) => ({
  capName: ROLLBACK_CAP,
  periodStartIso: SHARE_PERIOD,
  limit: 10,
  profile: "hardSlot",
  notify: noNotify,
  subject: { key: subjectKeyForUser(event.user.id), share: 0.5 },
}));

// Books usage for the calling user and leaves one reservation of that user open on a second cap.
const bookAndReserveHandler: WriteHandlerDef = {
  name: "book-and-reserve",
  schema: z.object({}),
  access: { roles: ["TenantAdmin", "SystemAdmin"] },
  handler: async (event, ctx) => {
    const subjectKey = subjectKeyForUser(event.user.id);
    await bookCapUsage(ctx, { capName: FORGET_CAP, periodStartIso: SHARE_PERIOD, subjectKey });
    await reserveCalendarCapUsage(ctx, {
      capName: FORGET_RESERVED_CAP,
      periodStartIso: SHARE_PERIOD,
      limit: 100,
      profile: "hardSlot",
      amount: 2,
      subject: { key: subjectKey },
    });
    return { isSuccess: true as const, data: { ok: true } };
  },
};

const probeFeature = defineFeature("cap-subject-test", (r) => {
  r.writeHandler(bookHandler);
  r.writeHandler(shareHandler);
  r.writeHandler(failHandler);
  r.writeHandler(bookAndReserveHandler);
});

let stack: TestStack;
let db: DbConnection;

beforeAll(async () => {
  configureBlindIndexKey(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
    features: [createCapCounterFeature(), createCryptoShreddingFeature(), probeFeature],
  });
  db = stack.db;
});

afterAll(async () => {
  await stack.cleanup();
  resetBlindIndexKeyForTests();
});

beforeEach(async () => {
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  await resetTestTables(db, [capCountersTable, capReservationsTable, eventsTable]);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

const admin = createTestUser({
  id: 701,
  tenantId: testTenantId(701),
  roles: ["TenantAdmin", "SystemAdmin"],
});

function book(periodStartIso: string, subjectKey?: string) {
  return stack.http.writeOk(
    BOOK_QN,
    { capName: CAP, periodStartIso, ...(subjectKey !== undefined && { subjectKey }) },
    admin,
  );
}

async function counterRows() {
  const rows = await selectMany<{
    subjectHash: string;
    periodStart: { toString(): string };
    value: number;
  }>(db, capCountersTable, { tenantId: admin.tenantId, capName: CAP });
  return rows;
}

describe("cap-counter subject rows", () => {
  test("a subject booking increments the tenant row and its own subject row", async () => {
    await book(MAY, "user:alice");
    await book(MAY, "user:alice");
    await book(MAY, "user:bob");

    const byHash = new Map((await counterRows()).map((row) => [row.subjectHash, row.value]));
    expect(byHash.get(TENANT_WIDE_SUBJECT_HASH)).toBe(3);
    expect(byHash.get(capSubjectHash("user:alice"))).toBe(2);
    expect(byHash.get(capSubjectHash("user:bob"))).toBe(1);
  });

  test("the subject key is stored only as an HMAC", async () => {
    await book(MAY, "user:alice");

    const hashes = (await counterRows()).map((row) => row.subjectHash);
    expect(hashes.some((hash) => hash.includes("alice"))).toBe(false);
  });

  test("a booking without subject leaves no subject row", async () => {
    await book(MAY);

    const rows = await counterRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subjectHash).toBe(TENANT_WIDE_SUBJECT_HASH);
  });

  test("a booking in a later period deletes the subject rows of earlier periods, tenant rows stay", async () => {
    await book(MAY, "user:alice");
    await book(JUNE, "user:alice");

    const rows = await counterRows();
    const subjectRows = rows.filter((row) => row.subjectHash !== TENANT_WIDE_SUBJECT_HASH);
    expect(subjectRows).toHaveLength(1);
    expect(subjectRows[0]?.periodStart.toString()).toContain("2026-06");
    expect(rows.filter((row) => row.subjectHash === TENANT_WIDE_SUBJECT_HASH)).toHaveLength(2);
  });

  test("forgetting a subject deletes its rows in every period and keeps tenant and other subjects", async () => {
    await book(MAY, "user:alice");
    await book(MAY, "user:bob");

    await forgetCapCounterSubject(db, stack.registry.features, "user:alice");

    const hashes = (await counterRows()).map((row) => row.subjectHash);
    expect(hashes).not.toContain(capSubjectHash("user:alice"));
    expect(hashes).toContain(capSubjectHash("user:bob"));
    expect(hashes).toContain(TENANT_WIDE_SUBJECT_HASH);
  });

  test("20 parallel increments sum to 20 and append no cap-counter event", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        stack.http.writeOk(
          CapCounterHandlers.increment,
          { capName: CAP, periodStartIso: MAY },
          admin,
        ),
      ),
    );

    expect(await fetchCounterValue(stack, admin, CAP, MAY)).toBe(20);
    const events = await selectMany(db, eventsTable, { type: { startsWith: "cap-counter" } });
    expect(events).toHaveLength(0);
  });

  describe("subject share through withCapEnforcement", () => {
    const tenantId: TenantId = admin.tenantId;
    const userA = createTestUser({ id: 702, tenantId, roles: ["TenantAdmin"] });
    const userB = createTestUser({ id: 703, tenantId, roles: ["TenantAdmin"] });
    const SHARE_QN = "cap-subject-test:write:share-send";
    const FAIL_QN = "cap-subject-test:write:fail-after-reserve";

    function read(capName: string, subjectKey?: string) {
      const tenantDb = createTenantDb({ db, tenantId });
      return readCalendarCapCounter(tenantDb, tenantId, {
        capName,
        periodStartIso: SHARE_PERIOD,
        ...(subjectKey !== undefined && { subjectKey }),
      });
    }

    test("one user is blocked at its share, a second user of the tenant still passes", async () => {
      for (let i = 0; i < 5; i++) {
        expect((await stack.http.write(SHARE_QN, {}, userA)).status).toBe(200);
      }
      const blocked = await stack.http.write(SHARE_QN, {}, userA);
      expect(blocked.status).toBe(429);
      const body = (await blocked.json()) as {
        error: { code: string; details: { scope?: string } };
      };
      expect(body.error.code).toBe("cap_exceeded");
      expect(body.error.details.scope).toBe("subject");

      expect((await stack.http.write(SHARE_QN, {}, userB)).status).toBe(200);

      expect((await read(SHARE_CAP))?.value).toBe(6);
      expect((await read(SHARE_CAP, subjectKeyForUser(userA.id)))?.value).toBe(5);
    });

    test("a handler failing after the reservation gives back tenant and subject row", async () => {
      const response = await stack.http.write(FAIL_QN, {}, userA);
      expect(response.status).toBeGreaterThanOrEqual(500);

      expect((await read(ROLLBACK_CAP))?.value ?? 0).toBe(0);
      expect((await read(ROLLBACK_CAP, subjectKeyForUser(userA.id)))?.value ?? 0).toBe(0);
    });
  });

  test("forget-subject removes the subject row and detaches open reservations, tenant row stays", async () => {
    const user = createTestUser({ id: 704, tenantId: admin.tenantId, roles: ["TenantAdmin"] });
    const subjectKey = subjectKeyForUser(user.id);
    const tenantDb = createTenantDb({ db, tenantId: admin.tenantId });
    const read = (capName: string, withSubject: boolean) =>
      readCalendarCapCounter(tenantDb, admin.tenantId, {
        capName,
        periodStartIso: SHARE_PERIOD,
        ...(withSubject && { subjectKey }),
      });
    const reservationRows = () =>
      selectMany<{ subjectHash: string | null }>(db, capReservationsTable, {
        tenantId: admin.tenantId,
        capName: FORGET_RESERVED_CAP,
      });

    await stack.http.writeOk("cap-subject-test:write:book-and-reserve", {}, user);
    expect((await read(FORGET_CAP, true))?.value).toBe(1);
    expect((await read(FORGET_RESERVED_CAP, true))?.value).toBe(2);
    const reservationsBefore = await reservationRows();
    expect(reservationsBefore).toHaveLength(1);
    expect(reservationsBefore[0]?.subjectHash).not.toBeNull();

    await stack.http.writeOk(
      "crypto-shredding:write:forget-subject",
      { subject: { kind: "user", userId: user.id }, reason: "cap subject erasure test" },
      admin,
    );

    expect(await read(FORGET_CAP, true)).toBeUndefined();
    expect(await read(FORGET_RESERVED_CAP, true)).toBeUndefined();
    expect((await read(FORGET_CAP, false))?.value).toBe(1);
    expect((await read(FORGET_RESERVED_CAP, false))?.value).toBe(2);
    const reservationsAfter = await reservationRows();
    expect(reservationsAfter).toHaveLength(1);
    expect(reservationsAfter[0]?.subjectHash).toBeNull();
  });
});
