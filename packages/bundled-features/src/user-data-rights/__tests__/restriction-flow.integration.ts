// S2.U6 — DSGVO Art. 18 Account-Freeze. End-to-End-Test ueber drei
// Features (sessions + auth-email-password + user-data-rights):
//
//   - restrict-account flippt Status + revoked alle Sessions cross-feature
//   - lift-restriction flippt zurueck
//   - Login-Pfad blockt Restricted (eigener error code) und collapsed
//     DeletionRequested/Deleted auf invalid_credentials (anti-enum)
//   - Existing JWTs einer restricted-User werden via sessionChecker
//     abgelehnt (session-revocation greift)
//   - State-Transition-Matrix: Active↔Restricted, andere Uebergaenge
//     fehlgeschlagen mit klaren error codes

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient, selectMany, updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createLateBoundHolder } from "@cosmicdrift/kumiko-framework/testing";
import { AuthErrors, AuthHandlers } from "../../auth-email-password/constants";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature";
import { hashPassword } from "../../auth-email-password/password-hashing";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDataRetentionFeature } from "../../data-retention";
import { createSessionsFeature } from "../../sessions";
import { SessionHandlers } from "../../sessions/constants";
import { userSessionEntity, userSessionTable } from "../../sessions/schema/user-session";
import { createSessionCallbacks, type SessionCallbacks } from "../../sessions/session-callbacks";
import { sessionCallbacksFromLateBound } from "../../sessions/testing";
import { createTenantFeature, tenantMembershipsTable } from "../../tenant";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenantMembership } from "../../tenant/seeding";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user";
import { UserHandlers } from "../../user/constants";
import { createUserDataRightsFeature } from "../feature";

const RESTRICT = "user-data-rights:write:restrict-account";
const LIFT = "user-data-rights:write:lift-restriction";

let stack: TestStack;
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");
const encryptionKey = randomBytes(32).toString("base64");
const TENANT: TenantId = testTenantId(1);

const ALICE_EMAIL = "alice.restrict@example.com";
const ALICE_PW = "alice-pw-long-enough";

beforeAll(async () => {
  const encryption = createEncryptionProvider(encryptionKey);
  const resolver = createConfigResolver({ encryption });
  const bound = sessionCallbacksFromLateBound(callbacks);

  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      createAuthEmailPasswordFeature(),
      createSessionsFeature(),
      createUserDataRightsFeature(),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      ...bound.asAuthConfig(),
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
  });
  callbacks.set(createSessionCallbacks({ db: stack.db }));

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await createEventsTable(stack.db);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userSessionTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM read_tenant_compliance_profiles`);
  await asRawClient(stack.db).unsafe(`DELETE FROM kumiko_events`);
});

async function seedAliceWithMembership(
  status: string = USER_STATUS.Active,
): Promise<{ userId: string }> {
  const hash = await hashPassword(ALICE_PW);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email: ALICE_EMAIL, passwordHash: hash, displayName: "Alice" },
    TestUsers.systemAdmin,
  );
  if (status !== USER_STATUS.Active) {
    await updateMany(stack.db, userTable, { status }, { id: created.id });
  }
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId: TENANT,
    roles: ["Member"],
  });
  return { userId: created.id };
}

async function login(email: string, password: string): Promise<{ status: number; body: unknown }> {
  const res = await stack.http.raw("POST", "/api/auth/login", { email, password });
  return { status: res.status, body: await res.json() };
}

function reasonOf(err: { details?: unknown }): string | undefined {
  return (err.details as { reason?: string } | undefined)?.reason;
}

describe("S2.U6 :: restrict-account state-transitions", () => {
  test("Active → Restricted: status flippt + alle Sessions revoked", async () => {
    const { userId } = await seedAliceWithMembership();
    // Login um eine Session zu erzeugen.
    const loginRes = await login(ALICE_EMAIL, ALICE_PW);
    expect(loginRes.status).toBe(200);

    // Session-Row vorhanden + live (revokedAt=null).
    const sessionsBefore = (await selectMany(stack.db, userSessionTable, { userId })) as Array<{
      id: string;
      revokedAt: unknown;
    }>;
    expect(sessionsBefore.length).toBeGreaterThanOrEqual(1);
    expect(sessionsBefore.every((s) => s.revokedAt === null)).toBe(true);

    // Restrict-Account.
    const aliceUser = {
      id: userId,
      tenantId: TENANT,
      roles: ["Member"],
    };
    const result = await stack.http.writeOk<{ userId: string; status: string }>(
      RESTRICT,
      {},
      aliceUser,
    );
    expect(result.status).toBe(USER_STATUS.Restricted);
    expect(result.userId).toBe(userId);

    // DB-State: status=Restricted.
    const userRow = (await selectMany(stack.db, userTable, { id: userId })) as Array<{
      status: string;
    }>;
    expect(userRow[0]?.status).toBe(USER_STATUS.Restricted);

    // Alle Sessions revoked (revokedAt != null).
    const sessionsAfter = (await selectMany(stack.db, userSessionTable, { userId })) as Array<{
      revokedAt: unknown;
    }>;
    expect(sessionsAfter.every((s) => s.revokedAt !== null)).toBe(true);
  });

  test("Restricted → Restricted (Idempotenz-Guard): 422 already_restricted", async () => {
    const { userId } = await seedAliceWithMembership(USER_STATUS.Restricted);
    const aliceUser = { id: userId, tenantId: TENANT, roles: ["Member"] };
    const err = await stack.http.writeErr(RESTRICT, {}, aliceUser);
    expect(err.httpStatus).toBe(422);
    expect(reasonOf(err)).toBe("already_restricted");
  });

  test("DeletionRequested → restrict-account: 422 user_not_in_active_state", async () => {
    const { userId } = await seedAliceWithMembership(USER_STATUS.DeletionRequested);
    const aliceUser = { id: userId, tenantId: TENANT, roles: ["Member"] };
    const err = await stack.http.writeErr(RESTRICT, {}, aliceUser);
    expect(reasonOf(err)).toBe("user_not_in_active_state");
  });
});

describe("S2.U6 :: lift-restriction state-transitions", () => {
  test("Restricted → Active: status flippt zurueck", async () => {
    const { userId } = await seedAliceWithMembership(USER_STATUS.Restricted);
    const aliceUser = { id: userId, tenantId: TENANT, roles: ["Member"] };

    const result = await stack.http.writeOk<{ status: string }>(LIFT, {}, aliceUser);
    expect(result.status).toBe(USER_STATUS.Active);

    const userRow = (await selectMany(stack.db, userTable, { id: userId })) as Array<{
      status: string;
    }>;
    expect(userRow[0]?.status).toBe(USER_STATUS.Active);
  });

  test("Active → lift-restriction: 422 not_restricted (Idempotenz-Guard)", async () => {
    const { userId } = await seedAliceWithMembership(USER_STATUS.Active);
    const aliceUser = { id: userId, tenantId: TENANT, roles: ["Member"] };
    const err = await stack.http.writeErr(LIFT, {}, aliceUser);
    expect(reasonOf(err)).toBe("not_restricted");
  });

  test("DeletionRequested → lift-restriction: 422 not_restricted", async () => {
    const { userId } = await seedAliceWithMembership(USER_STATUS.DeletionRequested);
    const aliceUser = { id: userId, tenantId: TENANT, roles: ["Member"] };
    const err = await stack.http.writeErr(LIFT, {}, aliceUser);
    expect(reasonOf(err)).toBe("not_restricted");
  });
});

describe("S2.U6 :: Login-Block fuer Restricted/DeletionRequested/Deleted", () => {
  test("Active user login: 200 (regression check)", async () => {
    await seedAliceWithMembership(USER_STATUS.Active);
    const res = await login(ALICE_EMAIL, ALICE_PW);
    expect(res.status).toBe(200);
  });

  test("Restricted user login: 422 account_restricted (eigener Code, kein collapse)", async () => {
    await seedAliceWithMembership(USER_STATUS.Restricted);
    const res = await login(ALICE_EMAIL, ALICE_PW);
    expect(res.status).toBe(422);
    const body = res.body as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.accountRestricted);
  });

  test("DeletionRequested user login: 422 invalid_credentials (anti-enum collapse)", async () => {
    await seedAliceWithMembership(USER_STATUS.DeletionRequested);
    const res = await login(ALICE_EMAIL, ALICE_PW);
    expect(res.status).toBe(422);
    const body = res.body as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
  });

  test("Deleted user login: 422 invalid_credentials (anti-enum collapse)", async () => {
    await seedAliceWithMembership(USER_STATUS.Deleted);
    const res = await login(ALICE_EMAIL, ALICE_PW);
    expect(res.status).toBe(422);
    const body = res.body as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
  });

  test("Wrong password vor Status-Check (timing-equivalence): 422 invalid_credentials, NICHT account_restricted", async () => {
    // Restricted User mit FALSCHEM Passwort darf NICHT account_restricted
    // erfahren — invalid_credentials kommt zuerst (siehe login.write.ts:
    // Status-Check ist NACH password-verify). Sonst koennte ein Angreifer
    // ohne valid Credentials den Restricted-Status enumerieren.
    await seedAliceWithMembership(USER_STATUS.Restricted);
    const res = await login(ALICE_EMAIL, "wrong-password-here");
    expect(res.status).toBe(422);
    const body = res.body as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);
  });
});

describe("S2.U6 :: Cross-Feature sessions.revokeAllForUser direct", () => {
  test("Privileged-Caller revoked alle live sessions eines Users", async () => {
    const { userId } = await seedAliceWithMembership();
    // 2 Sessions erzeugen via Login + zweiter Login.
    const a = await login(ALICE_EMAIL, ALICE_PW);
    const b = await login(ALICE_EMAIL, ALICE_PW);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const liveBefore = (await selectMany(stack.db, userSessionTable, { userId })) as Array<{
      id: string;
    }>;
    expect(liveBefore.length).toBe(2);

    // System-Caller.
    const systemUser = {
      id: "00000000-0000-4000-8000-000000000000",
      tenantId: TENANT,
      roles: ["SystemAdmin"],
    };
    const result = await stack.http.writeOk<{ count: number; userId: string }>(
      SessionHandlers.revokeAllForUser,
      { userId },
      systemUser,
    );
    expect(result.count).toBe(2);
    expect(result.userId).toBe(userId);

    // Alle revoked.
    const revoked = (await selectMany(stack.db, userSessionTable, { userId })) as Array<{
      revokedAt: unknown;
    }>;
    expect(revoked.every((s) => s.revokedAt !== null)).toBe(true);
  });
});
