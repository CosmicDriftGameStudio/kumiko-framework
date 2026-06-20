// #494 — ein read_users-Projection-Rebuild darf den Lifecycle-State nicht
// wegwischen. Die user-Entity ist event-sourced bei CREATE (user.created),
// aber Lifecycle-Mutationen (restrict/grace-period/cancel/...) waren rohe
// updateMany OHNE Event. Ein Rebuild replayt damit nur user.created und setzt
// status zurueck auf den Default (Active) — Datenverlust auf einem DSGVO-Pfad.
//
// Diskriminierend: T_create (Stream des user.created — Signup-Tenant) MUSS
// ungleich T_active (aktiver Tenant zur Lifecycle-Zeit) sein. Nur so wird der
// Prod-Zustand reproduziert und das Stream-Rescope eingelockt. Ein
// same-tenant-Test gaebe falsches GREEN: er liefe sogar mit `event.user`
// durch (gleicher Tenant -> gleicher Stream) und liesse einen Rueckbau auf
// `event.user` unentdeckt — genau die Naht, an der prod bricht.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, type Registry, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createProjectionStateTable,
  rebuildProjection,
} from "@cosmicdrift/kumiko-framework/pipeline";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createLateBoundHolder, resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { AuthHandlers } from "../../auth-email-password/constants";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature";
import { hashPassword } from "../../auth-email-password/password-hashing";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDataRetentionFeature } from "../../data-retention";
import { createSessionsFeature } from "../../sessions";
import { userSessionEntity, userSessionTable } from "../../sessions/schema/user-session";
import { createSessionCallbacks, type SessionCallbacks } from "../../sessions/session-callbacks";
import { sessionCallbacksFromLateBound } from "../../sessions/testing";
import { createTenantFeature, tenantMembershipsTable } from "../../tenant";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/seeding";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { UserHandlers } from "../../user/constants";
import { createUserDataRightsFeature } from "../feature";
import { backfillUserLifecycleEvents, updateUserLifecycle } from "../lib/update-user-lifecycle";

const RESTRICT = "user-data-rights:write:restrict-account";
const USER_PROJECTION = "user:projection:user-entity";
// T_create: Stream auf den user.created landet (systemAdmin-Signup-Tenant).
const T_CREATE: TenantId = testTenantId(1);
// T_active: aktiver Tenant des Users zur Lifecycle-Zeit — bewusst ungleich.
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
    createSessionsFeature(),
    createUserDataRightsFeature(),
  ];
}

beforeAll(async () => {
  const encryption = createEncryptionProvider(encryptionKey);
  const resolver = createConfigResolver({ encryption });
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
  // Eigene Registry fuer den Rebuild — enthaelt die implicit read_users-Projektion.
  registry = createRegistry(buildFeatures());

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await createEventsTable(stack.db);
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

describe("#494 :: read_users-Rebuild bewahrt Lifecycle-State", () => {
  test("Restricted-Status ueberlebt einen Projection-Rebuild (T_create != T_active)", async () => {
    // Diskriminierende Praemisse: user.created landet auf systemAdmin.tenantId
    // (= T_CREATE), Lifecycle laeuft spaeter auf T_ACTIVE. Beide ungleich.
    expect(TestUsers.systemAdmin.tenantId).toBe(T_CREATE);
    expect(T_ACTIVE).not.toBe(T_CREATE);

    // user.created landet auf T_CREATE (systemAdmin-Signup-Stream).
    const hash = await hashPassword(ALICE_PW);
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: ALICE_EMAIL, passwordHash: hash, displayName: "Alice" },
      TestUsers.systemAdmin,
    );
    // Mitgliedschaft + Lifecycle auf einem ANDEREN, aktiven Tenant.
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId: T_ACTIVE,
      roles: ["Member"],
    });

    const aliceActive = { id: created.id, tenantId: T_ACTIVE, roles: ["Member"] };
    const restricted = await stack.http.writeOk<{ status: string }>(RESTRICT, {}, aliceActive);
    expect(restricted.status).toBe(USER_STATUS.Restricted);

    // Live-Row ist Restricted (sanity).
    const before = (await selectMany(stack.db, userTable, { id: created.id })) as Array<{
      status: string;
    }>;
    expect(before[0]?.status).toBe(USER_STATUS.Restricted);

    // ECHTER Rebuild der read_users-Projektion aus dem Event-Log.
    await rebuildProjection(USER_PROJECTION, { db: stack.db, registry });

    // RED auf aktuellem Code: restrict schrieb roh ohne Event -> der Rebuild
    // replayt nur user.created -> status faellt auf Active zurueck.
    // GREEN nach Stream-Rescope der Lifecycle-Handler.
    const after = (await selectMany(stack.db, userTable, { id: created.id })) as Array<{
      status: string;
    }>;
    expect(after[0]?.status).toBe(USER_STATUS.Restricted);
  });

  test("DeletionRequested + gracePeriodEnd (Date-Spalte) ueberleben den Rebuild", async () => {
    // Direkt via Helper, ohne compliance-profile-Setup — der Fokus ist die
    // Serialisierung der Date-Spalte durch das Event + den Reducer.
    const hash = await hashPassword(ALICE_PW);
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "grace.rebuild@example.com", passwordHash: hash, displayName: "Grace" },
      TestUsers.systemAdmin,
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
      gracePeriodEnd: unknown;
    }>;
    expect(after[0]?.status).toBe(USER_STATUS.DeletionRequested);
    // gracePeriodEnd ueberlebt — nicht null nach Replay.
    expect(after[0]?.gracePeriodEnd).not.toBeNull();
    expect(after[0]?.gracePeriodEnd).toBeDefined();
  });

  // Ehrlicher Spiegel zum Forward-Test: Bestandsdaten, deren Status der ALTE
  // raw-Pfad (ohne Event) gesetzt hat, ueberleben einen Rebuild NICHT — bis der
  // einmalige Backfill ihren Live-State als user.updated ins Event-Log spiegelt.
  test("Bestandsdaten: alt-roh gesetzter Status wird ohne Backfill weggewischt, mit Backfill bewahrt", async () => {
    const hash = await hashPassword(ALICE_PW);
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      { email: "legacy.rebuild@example.com", passwordHash: hash, displayName: "Legacy" },
      TestUsers.systemAdmin,
    );

    // Prae-Fix-Zustand simulieren: roher Write OHNE Event.
    await updateMany(stack.db, userTable, { status: USER_STATUS.Restricted }, { id: created.id });

    // Ohne Backfill replayt der Rebuild nur user.created -> Status weggewischt.
    await rebuildProjection(USER_PROJECTION, { db: stack.db, registry });
    const wiped = (await selectMany(stack.db, userTable, { id: created.id })) as Array<{
      status: string;
    }>;
    expect(wiped[0]?.status).toBe(USER_STATUS.Active);

    // Bestand wieder in den divergenten Live-State bringen (der Rebuild hat ihn
    // auf Active gesetzt) und den Reconcile laufen lassen.
    await updateMany(stack.db, userTable, { status: USER_STATUS.Restricted }, { id: created.id });
    const backfilled = await backfillUserLifecycleEvents(stack.db);
    expect(backfilled).toBeGreaterThanOrEqual(1);

    // Jetzt traegt das Event-Log den State -> Rebuild bewahrt ihn.
    await rebuildProjection(USER_PROJECTION, { db: stack.db, registry });
    const survived = (await selectMany(stack.db, userTable, { id: created.id })) as Array<{
      status: string;
    }>;
    expect(survived[0]?.status).toBe(USER_STATUS.Restricted);
  });
});
