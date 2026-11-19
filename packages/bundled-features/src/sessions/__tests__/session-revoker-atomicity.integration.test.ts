import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import type { Registry, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { seedRow } from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { revokeAllUserCredentials } from "../../auth-foundation/credential-revoker.ts";
import { type CredentialRevoker, EXT_CREDENTIAL_REVOKER } from "../../auth-foundation/types.ts";
import { revokeSessionsAndAnnounce } from "../revoke-sessions.ts";
import { userSessionEntity, userSessionTable } from "../schema/user-session.ts";
import { createSessionCallbacks } from "../session-callbacks.ts";
import { SESSION_REVOKED_EVENT_QN } from "../session-revoked-event.ts";

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
});

const USER_ID = "00000000-0000-4000-8000-0000000000a1";
const OTHER_SID = "00000000-0000-4000-8000-000000000002";

function registryWith(
  ...revokers: readonly CredentialRevoker[]
): Pick<Registry, "getExtensionUsages"> {
  return {
    getExtensionUsages: () =>
      revokers.map((revoker, index) => ({
        extensionName: EXT_CREDENTIAL_REVOKER,
        entityName: `revoker-${index}`,
        featureName: "test",
        options: revoker,
      })),
  };
}

const sessionsRevoker: CredentialRevoker = {
  revokeAllForUser: async (runner, userId, { keepSessionId }) =>
    (
      await revokeSessionsAndAnnounce(runner, {
        where: keepSessionId !== undefined ? { userId, id: { ne: keepSessionId } } : { userId },
        revokedAt: Temporal.Now.instant(),
        ...(keepSessionId !== undefined && { keptSessionId: keepSessionId }),
      })
    ).length,
};

async function seedSecondSession(): Promise<void> {
  const now = Temporal.Now.instant();
  await seedRow(testDb.db, userSessionTable, {
    id: OTHER_SID,
    tenantId: TENANT,
    userId: USER_ID,
    createdAt: now,
    expiresAt: now.add({ milliseconds: 3_600_000 }),
    ip: "1.2.3.5",
    userAgent: "test-agent",
  });
}

async function liveSessionCount(): Promise<number> {
  const [row] = await asRawClient(testDb.db).unsafe<{ count: number }>(
    "SELECT count(*)::int AS count FROM store_user_sessions WHERE revoked_at IS NULL",
  );
  return row?.count ?? 0;
}

describe("revokeAllUserCredentials atomicity", () => {
  test("a failing event append leaves all sessions live so a retry still revokes and emits", async () => {
    await seedSecondSession();
    const registry = registryWith(sessionsRevoker);

    await withRejectingEventAppend(async () => {
      await expect(revokeAllUserCredentials(registry, testDb.db, USER_ID, {})).rejects.toThrow();
    });

    expect(await liveSessionCount()).toBe(2);
    expect(await revokedEventCount()).toBe(0);

    await revokeAllUserCredentials(registry, testDb.db, USER_ID, {});

    expect(await liveSessionCount()).toBe(0);
    expect(await revokedEventCount()).toBe(1);
  });

  test("keepSessionId: a failing event append leaves the other sessions live, a retry keeps the kept one", async () => {
    await seedSecondSession();
    const registry = registryWith(sessionsRevoker);

    await withRejectingEventAppend(async () => {
      await expect(
        revokeAllUserCredentials(registry, testDb.db, USER_ID, { keepSessionId: SID }),
      ).rejects.toThrow();
    });

    expect(await liveSessionCount()).toBe(2);
    expect(await revokedEventCount()).toBe(0);

    await revokeAllUserCredentials(registry, testDb.db, USER_ID, { keepSessionId: SID });

    expect(await liveSessionCount()).toBe(1);
    expect(await revokedAtOfSession()).toBeNull();
    expect(await revokedEventCount()).toBe(1);
  });

  test("a later revoker that throws rolls back the sessions revoke of the same call", async () => {
    const failingRevoker: CredentialRevoker = {
      revokeAllForUser: async () => {
        throw new Error("second revoker failed");
      },
    };

    await expect(
      revokeAllUserCredentials(
        registryWith(sessionsRevoker, failingRevoker),
        testDb.db,
        USER_ID,
        {},
      ),
    ).rejects.toThrow("second revoker failed");

    expect(await revokedAtOfSession()).toBeNull();
    expect(await revokedEventCount()).toBe(0);
  });
});
