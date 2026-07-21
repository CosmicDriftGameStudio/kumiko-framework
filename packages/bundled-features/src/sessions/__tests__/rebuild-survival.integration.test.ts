import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createTenantDb, type DbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createProjectionStateTable,
  rebuildProjection,
} from "@cosmicdrift/kumiko-framework/pipeline";
import {
  createTestDb,
  type TestDb,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { seedRow, updateRows } from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "temporal-polyfill";
import { createUserFeature } from "../../user/feature";
import { createSessionsFeature } from "../feature";
import { userSessionEntity, userSessionTable } from "../schema/user-session";

// store_user_sessions is a hot-path direct-write store: sessionCreator inserts
// rows and the revoke handlers update them WITHOUT emitting lifecycle events.
// If the table is registered as an r.entity, the framework makes it a
// rebuildable implicit projection whose replay finds zero matching events and
// swaps an EMPTY shadow over the live table — silently wiping every active
// session on the next projection rebuild (deploy / `schema apply`). #498/#494.
//
// Pre-fix both tests are RED: the implicit projection "sessions:projection:
// user-session-entity" exists and rebuilding it empties store_user_sessions.
// Post-fix (r.unmanagedTable) the table is no longer a rebuild target.

const IMPLICIT_PROJECTION = "sessions:projection:user-session-entity";

let testDb: TestDb;
const TENANT: TenantId = testTenantId(1);

beforeAll(async () => {
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, userSessionEntity, "user-session");
  await createEventsTable(testDb.db);
  await createProjectionStateTable(testDb.db);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    "TRUNCATE store_user_sessions, kumiko_events, kumiko_projections RESTART IDENTITY CASCADE",
  );
});

// Mirrors createSessionCallbacks().sessionCreator + sessionRevoker: a row
// written directly on the hot path, then revoked — no events anywhere.
const SID = "00000000-0000-0000-0000-000000000001";

async function insertRevokedSession(db: DbConnection): Promise<void> {
  const now = Temporal.Now.instant();
  await seedRow(db, userSessionTable, {
    id: SID,
    tenantId: TENANT,
    userId: "user-1",
    createdAt: now,
    expiresAt: now.add({ milliseconds: 3_600_000 }),
    ip: "1.2.3.4",
    userAgent: "test-agent",
  });
  await updateRows(db, userSessionTable, { revokedAt: now }, { id: SID, revokedAt: null });
}

describe("sessions / store_user_sessions survives projection rebuild", () => {
  test("is NOT registered as a rebuildable implicit projection", () => {
    const registry = createRegistry([
      authFoundationFeature,
      createSessionsFeature(),
      createUserFeature(),
    ]);
    expect(registry.getAllProjections().has(IMPLICIT_PROJECTION)).toBe(false);
  });

  test("direct-written rows (incl. revoked state) survive a rebuild", async () => {
    await insertRevokedSession(createTenantDb(testDb.db, TENANT));

    const registry = createRegistry([
      authFoundationFeature,
      createSessionsFeature(),
      createUserFeature(),
    ]);
    // Pre-fix: the implicit projection exists → rebuild swaps an empty shadow
    // → rows wiped. Post-fix: absent → no rebuild → rows untouched. Either way
    // a regression (re-adding r.entity) makes this fail.
    if (registry.getAllProjections().has(IMPLICIT_PROJECTION)) {
      await rebuildProjection(IMPLICIT_PROJECTION, { db: testDb.db, registry });
    }

    const rows = await selectMany(testDb.db, userSessionTable, {});
    expect(rows.length).toBe(1);
    expect(rows[0]?.revokedAt).not.toBeNull();
  });
});
