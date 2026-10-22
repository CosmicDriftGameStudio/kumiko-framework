// A read_users projection rebuild must not erase lifecycle state. The user entity
// is event-sourced on CREATE (user.created), but lifecycle mutations
// (restrict/grace-period/cancel/...) used to be raw updateMany calls WITHOUT an
// event. A rebuild therefore replayed only user.created and reset status to the
// default (Active), causing data loss on a GDPR path.
//
// Discriminating condition: T_create (the stream receiving user.created — the
// signup tenant) MUST differ from T_active (the tenant active at lifecycle time).
// Only this reproduces production and locks in the stream rescope. A same-tenant
// test would falsely pass: it would also work with `event.user` (same tenant →
// same stream), leaving a regression to `event.user` undetected—the exact seam
// where production fails.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createRegistry,
  type Registry,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { archiveStream, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createProjectionStateTable,
  rebuildProjection,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import {
  createLateBoundHolder,
  createTestEnvelopeCipher,
  resetTestTables,
  updateRows,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { AuthHandlers } from "../../auth-email-password/web/constants.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { userSessionEntity, userSessionTable } from "../../sessions/schema/user-session.ts";
import { createSessionCallbacks, type SessionCallbacks } from "../../sessions/session-callbacks.ts";
import { sessionCallbacksFromLateBound, withMintedSession } from "../../sessions/testing.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature, tenantMembershipsTable } from "../../tenant/index.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenantMembership } from "../../tenant/seeding.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { UserHandlers } from "../../user/web/constants.ts";
import { createUserDataRightsFeature } from "../feature.ts";
import { backfillUserLifecycleEvents, updateUserLifecycle } from "../lib/update-user-lifecycle.ts";

const RESTRICT = "user-data-rights:write:restrict-account";
const USER_PROJECTION = "user:projection:user-entity";
// T_create: the stream receiving user.created (the systemAdmin signup tenant).
const T_CREATE: TenantId = testTenantId(1);
// T_active: the user's active tenant at lifecycle time—intentionally different.
const T_ACTIVE: TenantId = testTenantId(2);

const ALICE_EMAIL = "alice.rebuild@example.com";
const ALICE_PW = "alice-pw-long-enough";

let stack: TestStack;
let registry: Registry;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");
const encryptionKey = randomBytes(32).toString("base64");

function buildFeatures() {
  return [
    createConfigFeature(),
    createUserFeature(),
    createTenantFeature(),
    createDataRetentionFeature(),
    createComplianceProfilesFeature(),
    createAuthEmailPasswordFeature(),
    createAuthFoundationFeature(),
    createSessionsFeature(),
    createUserDataRightsFeature(),
  ];
}

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(encryptionKey);
  const resolver = createConfigResolver({ cipher: encryption });
  const bound = sessionCallbacksFromLateBound(callbacks);

  stack = await setupTestStack({
    features: buildFeatures(),
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      ...bound.asAuthConfig(),
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
  });
  callbacks.set(createSessionCallbacks({ db: stack.db }));
  // Separate registry for the rebuild; it contains the implicit read_users projection.
  registry = createRegistry(buildFeatures());

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await createProjectionStateTable(stack.db);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userSessionTable,
    userTable,
    tenantMembershipsTable,
    tenantComplianceProfileTable,
    eventsTable,
  ]);
});

// Any actor hitting a write handler needs a live sid once sessionChecker
// is wired.
function mintActor(user: { id: string; tenantId: TenantId; roles: readonly string[] }) {
  return withMintedSession((u, meta) => callbacks.get().sessionCreator(u, meta), user);
}

describe("#494 :: read_users-Rebuild bewahrt Lifecycle-State", () => {
  test("Restricted-Status ueberlebt einen Projection-Rebuild (T_create != T_active)", async () => {
    // Discriminating premise: user.created lands on systemAdmin.tenantId
    // (= T_CREATE), while the lifecycle runs later on T_ACTIVE. They must differ.
    expect(TestUsers.systemAdmin.tenantId).toBe(T_CREATE);
    expect(T_ACTIVE).not.toBe(T_CREATE);

    const hash = await hashPassword(ALICE_PW);
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: ALICE_EMAIL, passwordHash: hash, displayName: "Alice" },
      await mintActor(TestUsers.systemAdmin),
    );
    // Membership and lifecycle are deliberately performed on a DIFFERENT active tenant.
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: T_ACTIVE,
      roles: ["Member"],
    });

    const aliceActive = await mintActor({ id: created.id, tenantId: T_ACTIVE, roles: ["Member"] });
    const restricted = await stack.http.writeOk<{ status: string }>(RESTRICT, {}, aliceActive);
    expect(restricted.status).toBe(USER_STATUS.Restricted);

    const before = (await selectMany(stack.db, userTable, { id: created.id })) as Array<{
      status: string;
    }>;
    expect(before[0]?.status).toBe(USER_STATUS.Restricted);

    // A real rebuild of the read_users projection from the event log.
    await rebuildProjection(USER_PROJECTION, { db: stack.db, registry });

    // Before the lifecycle handlers were rescoped to the user's stream, restrict
    // wrote directly without an event, so the rebuild replayed only user.created
    // and reset the status to Active.
    const after = (await selectMany(stack.db, userTable, { id: created.id })) as Array<{
      status: string;
    }>;
    expect(after[0]?.status).toBe(USER_STATUS.Restricted);
  });

  test("DeletionRequested + gracePeriodEnd (Date-Spalte) ueberleben den Rebuild", async () => {
    // Use the helper directly, without compliance-profile setup, because the focus
    // is serializing the Date column through the event and reducer.
    const hash = await hashPassword(ALICE_PW);
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "grace.rebuild@example.com", passwordHash: hash, displayName: "Grace" },
      await mintActor(TestUsers.systemAdmin),
    );

    const T = getTemporal();
    const gracePeriodEnd = T.Now.instant().add({ hours: 24 });
    await updateUserLifecycle(stack.db, created.id, {
      status: USER_STATUS.DeletionRequested,
      gracePeriodEnd,
    });

    await rebuildProjection(USER_PROJECTION, { db: stack.db, registry });

    const after = (await selectMany(stack.db, userTable, { id: created.id })) as Array<{
      status: string;
      gracePeriodEnd: typeof gracePeriodEnd | null;
    }>;
    expect(after[0]?.status).toBe(USER_STATUS.DeletionRequested);
    // gracePeriodEnd must survive replay with its exact value, not merely remain
    // non-null: a timezone or round-trip error can produce a non-null but wrong
    // instant. epoch-ms tolerates database precision (µs) without checking for
    // sub-ms drift.
    expect(after[0]?.gracePeriodEnd?.epochMilliseconds).toBe(gracePeriodEnd.epochMilliseconds);
  });

  // Honest counterpart to the forward test: existing data whose status was set by
  // the old raw path (without an event) cannot survive a rebuild until the one-time
  // backfill records its live state as user.updated in the event log.
  test("Bestandsdaten: alt-roh gesetzter Status wird ohne Backfill weggewischt, mit Backfill bewahrt", async () => {
    const hash = await hashPassword(ALICE_PW);
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "legacy.rebuild@example.com", passwordHash: hash, displayName: "Legacy" },
      await mintActor(TestUsers.systemAdmin),
    );

    // Prae-Fix-Zustand simulieren: roher Write OHNE Event.
    await updateRows(stack.db, userTable, { status: USER_STATUS.Restricted }, { id: created.id });

    // Without the backfill, the rebuild replays only user.created and erases the status.
    await rebuildProjection(USER_PROJECTION, { db: stack.db, registry });
    const wiped = (await selectMany(stack.db, userTable, { id: created.id })) as Array<{
      status: string;
    }>;
    expect(wiped[0]?.status).toBe(USER_STATUS.Active);

    // Restore the divergent live state (the rebuild set it to Active) before running
    // reconciliation.
    await updateRows(stack.db, userTable, { status: USER_STATUS.Restricted }, { id: created.id });
    const { backfilled, failed } = await backfillUserLifecycleEvents(stack.db);
    expect(backfilled).toBeGreaterThanOrEqual(1);
    expect(failed).toEqual([]);

    // The event log now contains the state, so the rebuild preserves it.
    await rebuildProjection(USER_PROJECTION, { db: stack.db, registry });
    const survived = (await selectMany(stack.db, userTable, { id: created.id })) as Array<{
      status: string;
    }>;
    expect(survived[0]?.status).toBe(USER_STATUS.Restricted);
  });

  test("a corrupt row (stream archived out from under it) is reported in `failed` — the rest of the estate still backfills", async () => {
    // Real-world corruption: a stale tenant-lifecycle cleanup or an operator
    // mistake archives a user's event stream while the read_users row still
    // physically exists. This must land in `failed`, not abort the whole run
    // — everything after it in the estate scan would otherwise silently miss
    // its user.updated backfill (DSGVO data-loss on an unrelated row).
    const hash = await hashPassword(ALICE_PW);
    const goodRow = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "healthy.rebuild@example.com", passwordHash: hash, displayName: "Healthy" },
      await mintActor(TestUsers.systemAdmin),
    );
    await updateRows(stack.db, userTable, { status: USER_STATUS.Restricted }, { id: goodRow.id });

    const badRow = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "corrupt.rebuild@example.com", passwordHash: hash, displayName: "Corrupt" },
      await mintActor(TestUsers.systemAdmin),
    );
    await updateRows(stack.db, userTable, { status: USER_STATUS.Restricted }, { id: badRow.id });
    // userEntity is systemStream:true (schema/user.ts) — its event stream
    // lives on SYSTEM_TENANT_ID regardless of the creating tenant. Archiving
    // under any other tenant would be a silent no-op against assertStreamWritable.
    await archiveStream(stack.db, {
      tenantId: SYSTEM_TENANT_ID,
      aggregateId: badRow.id,
      aggregateType: "user",
      archivedBy: "test-corruption",
    });

    const { backfilled, failed } = await backfillUserLifecycleEvents(stack.db);

    expect(failed).toHaveLength(1);
    expect(failed[0]?.id).toBe(badRow.id);
    expect(backfilled).toBeGreaterThanOrEqual(1);

    // Prove the loop did not abort at the corrupt row: rebuild the projection—
    // goodRow received its user.updated event and survives. badRow's stream is
    // archived and is no longer replayed: the row disappears after the rebuild
    // rather than merely resetting to Active. That is why the failed report is
    // the operator alert; recovery is restoreStream + Backfill re-run, THEN rebuild.
    await rebuildProjection(USER_PROJECTION, { db: stack.db, registry });
    const rows = (await selectMany(stack.db, userTable, {})) as Array<{
      id: string;
      status: string;
    }>;
    const good = rows.find((r) => r.id === goodRow.id);
    const bad = rows.find((r) => r.id === badRow.id);
    expect(good?.status).toBe(USER_STATUS.Restricted);
    expect(bad).toBeUndefined();
  });
});
