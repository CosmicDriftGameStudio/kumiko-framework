import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestDb,
  type TestDb,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { userSessionEntity, userSessionTable } from "../schema/user-session.js";
import { createSessionCallbacks } from "../session-callbacks.js";
import { SESSION_REVOKED_EVENT_QN } from "../session-revoked-event.js";

// Revoke and its session-revoked event must commit together: if only the
// revoke stuck, a retried logout would find no live row (revokedAt IS NULL),
// emit nothing, and the SSE stream of that sid would stay open.

const SID = "00000000-0000-4000-8000-000000000001";
const TENANT: TenantId = testTenantId(1);

let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, userSessionEntity, "user-session");
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    "TRUNCATE store_user_sessions, kumiko_events RESTART IDENTITY CASCADE",
  );
  const now = Temporal.Now.instant();
  await seedRow(testDb.db, userSessionTable, {
    id: SID,
    tenantId: TENANT,
    userId: "00000000-0000-4000-8000-0000000000a1",
    createdAt: now,
    expiresAt: now.add({ milliseconds: 3_600_000 }),
    ip: "1.2.3.4",
    userAgent: "test-agent",
  });
});

async function revokedAtOfSession(): Promise<unknown> {
  const [row] = await asRawClient(testDb.db).unsafe<{ revoked_at: unknown }>(
    "SELECT revoked_at FROM store_user_sessions WHERE id = $1",
    [SID],
  );
  return row?.revoked_at;
}

async function revokedEventCount(): Promise<number> {
  const [row] = await asRawClient(testDb.db).unsafe<{ count: number }>(
    "SELECT count(*)::int AS count FROM kumiko_events WHERE type = $1",
    [SESSION_REVOKED_EVENT_QN],
  );
  return row?.count ?? 0;
}

async function withRejectingEventAppend(fn: () => Promise<void>): Promise<void> {
  const raw = asRawClient(testDb.db);
  await raw.unsafe(`
    CREATE OR REPLACE FUNCTION session_revoker_test_reject() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'event append rejected'; END $$ LANGUAGE plpgsql
  `);
  await raw.unsafe(`
    CREATE TRIGGER session_revoker_test_reject BEFORE INSERT ON kumiko_events
    FOR EACH ROW EXECUTE FUNCTION session_revoker_test_reject()
  `);
  try {
    await fn();
  } finally {
    await raw.unsafe("DROP TRIGGER session_revoker_test_reject ON kumiko_events");
    await raw.unsafe("DROP FUNCTION session_revoker_test_reject()");
  }
}

const USER_ID = "00000000-0000-4000-8000-0000000000a1";

describe("sessionRevoker atomicity", () => {
  test("a failing event append leaves the session live so a retry still revokes and emits", async () => {
    const { sessionRevoker } = createSessionCallbacks({ db: testDb.db });

    await withRejectingEventAppend(async () => {
      await expect(sessionRevoker(SID)).rejects.toThrow();
    });

    expect(await revokedAtOfSession()).toBeNull();
    expect(await revokedEventCount()).toBe(0);

    await sessionRevoker(SID);

    expect(await revokedAtOfSession()).not.toBeNull();
    expect(await revokedEventCount()).toBe(1);
  });

  test("sessionMassRevoker: a failing event append leaves sessions live so a retry still revokes and emits", async () => {
    const { sessionMassRevoker } = createSessionCallbacks({ db: testDb.db });

    await withRejectingEventAppend(async () => {
      await expect(sessionMassRevoker(USER_ID)).rejects.toThrow();
    });

    expect(await revokedAtOfSession()).toBeNull();
    expect(await revokedEventCount()).toBe(0);

    expect(await sessionMassRevoker(USER_ID)).toBe(1);

    expect(await revokedAtOfSession()).not.toBeNull();
    expect(await revokedEventCount()).toBe(1);
  });

  test("sessionRevokeAllOthers: a failing event append leaves sessions live so a retry still revokes and emits", async () => {
    const { sessionRevokeAllOthers } = createSessionCallbacks({ db: testDb.db });

    await withRejectingEventAppend(async () => {
      await expect(sessionRevokeAllOthers(USER_ID, undefined)).rejects.toThrow();
    });

    expect(await revokedAtOfSession()).toBeNull();
    expect(await revokedEventCount()).toBe(0);

    expect(await sessionRevokeAllOthers(USER_ID, undefined)).toBe(1);

    expect(await revokedAtOfSession()).not.toBeNull();
    expect(await revokedEventCount()).toBe(1);
  });
});
