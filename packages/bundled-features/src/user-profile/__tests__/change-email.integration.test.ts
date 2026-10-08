// user-profile change-email — Re-Auth + Uniqueness + Verified-Reset,
// bewiesen über echten Login (alte Email 401, neue Email 200). Plus
// QN-Pin der user-data-rights-Konstanten (Danger-Zone des ProfileScreen
// dispatcht genau diese Strings).

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { fetchOne } from "@cosmicdrift/kumiko-framework/bun-db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes, resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { AuthErrors, AuthHandlers } from "../../auth-email-password/constants.js";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.js";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import { configValuesTable } from "../../config/table.js";
import { createDataRetentionFeature } from "../../data-retention/index.js";
import { createFilesFeature } from "../../files/index.js";
import { createSessionsFeature } from "../../sessions/index.js";
import { hashPassword } from "../../shared/index.js";
import { createTenantFeature } from "../../tenant/index.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { seedTenantMembership } from "../../tenant/testing.js";
import { createUserFeature } from "../../user/feature.js";
import { UserErrors, UserHandlers, UserQueries } from "../../user/index.js";
import { userEntity, userTable } from "../../user/schema/user.js";
import { createUserDataRightsFeature } from "../../user-data-rights/index.js";
import { createUserDataRightsDefaultsFeature } from "../../user-data-rights-defaults/index.js";
import {
  UserDataRightsHandlers,
  UserProfileErrors,
  UserProfileHandlers,
  UserProfileQueries,
} from "../constants.js";
import { createUserProfileFeature } from "../feature.js";

let stack: TestStack;

const systemAdmin = TestUsers.systemAdmin;
const TENANT: TenantId = "00000000-0000-4000-8000-000000000001" as TenantId; // @cast-boundary test-fixture

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      createDataRetentionFeature(),
      createComplianceProfilesFeature(),
      authFoundationFeature,
      createSessionsFeature(),
      createFilesFeature(),
      createUserDataRightsFeature(),
      createUserDataRightsDefaultsFeature(),
      createUserProfileFeature(),
    ],
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      loginErrorStatusMap: {
        [AuthErrors.invalidCredentials]: 401,
        [AuthErrors.noMembership]: 403,
      },
    },
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    tenantMembershipsTable,
    tenantComplianceProfileTable,
    eventsTable,
  ]);
});

async function seedLoginUser(opts: {
  email: string;
  password: string;
}): Promise<{ id: string; tenantId: TenantId }> {
  const hash = await hashPassword(opts.password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    {
      email: opts.email,
      passwordHash: hash,
      displayName: opts.email.split("@")[0] ?? "user",
    },
    systemAdmin,
  );
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId: TENANT,
    roles: ["User"],
  });
  return { id: created.id, tenantId: TENANT };
}

describe("change-email happy path", () => {
  test("re-auth ok → Login nur noch mit neuer Email, emailVerified=false", async () => {
    const seed = await seedLoginUser({ email: "old@example.com", password: "secret-pw-1" });
    const signedIn = createTestUser({ id: seed.id, tenantId: seed.tenantId, roles: ["User"] });

    const result = await stack.http.writeOk<{ kind: string; email: string }>(
      UserProfileHandlers.changeEmail,
      { currentPassword: "secret-pw-1", newEmail: "New@Example.com" },
      signedIn,
    );
    expect(result.kind).toBe("email-changed");
    expect(result.email).toBe("new@example.com");

    const row = (await fetchOne(stack.db, userTable, { id: seed.id })) as {
      email: string;
      emailVerified: boolean | null;
    } | null;
    expect(row?.email).toBe("new@example.com");
    expect(row?.emailVerified).toBe(false);

    const oldLogin = await stack.http.raw("POST", "/api/auth/login", {
      email: "old@example.com",
      password: "secret-pw-1",
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await stack.http.raw("POST", "/api/auth/login", {
      email: "new@example.com",
      password: "secret-pw-1",
    });
    expect(newLogin.status).toBe(200);
  });
});

describe("change-email access", () => {
  test("a tenant member whose only role is TenantAdmin can change their own email", async () => {
    const seed = await seedLoginUser({ email: "tadmin@example.com", password: "secret-pw-1" });
    const signedIn = createTestUser({
      id: seed.id,
      tenantId: seed.tenantId,
      roles: ["TenantAdmin"],
    });

    const result = await stack.http.writeOk<{ kind: string; email: string }>(
      UserProfileHandlers.changeEmail,
      { currentPassword: "secret-pw-1", newEmail: "tadmin-new@example.com" },
      signedIn,
    );
    expect(result.email).toBe("tadmin-new@example.com");
  });
});

describe("change-email guards", () => {
  test("falsches Passwort → invalid_credentials, Email unverändert", async () => {
    const seed = await seedLoginUser({ email: "guard@example.com", password: "secret-pw-1" });
    const signedIn = createTestUser({ id: seed.id, tenantId: seed.tenantId, roles: ["User"] });

    const error = await stack.http.writeErr(
      UserProfileHandlers.changeEmail,
      { currentPassword: "wrong", newEmail: "other@example.com" },
      signedIn,
    );
    expectErrorIncludes(error, AuthErrors.invalidCredentials);

    const row = (await fetchOne(stack.db, userTable, { id: seed.id })) as {
      email: string;
    } | null;
    expect(row?.email).toBe("guard@example.com");
  });

  test("Email bereits vergeben → email_already_exists", async () => {
    await seedLoginUser({ email: "taken@example.com", password: "secret-pw-2" });
    const seed = await seedLoginUser({ email: "me@example.com", password: "secret-pw-1" });
    const signedIn = createTestUser({ id: seed.id, tenantId: seed.tenantId, roles: ["User"] });

    const error = await stack.http.writeErr(
      UserProfileHandlers.changeEmail,
      { currentPassword: "secret-pw-1", newEmail: "taken@example.com" },
      signedIn,
    );
    expectErrorIncludes(error, UserErrors.emailAlreadyExists);
  });

  test("gleiche Email → email_unchanged", async () => {
    const seed = await seedLoginUser({ email: "same@example.com", password: "secret-pw-1" });
    const signedIn = createTestUser({ id: seed.id, tenantId: seed.tenantId, roles: ["User"] });

    const error = await stack.http.writeErr(
      UserProfileHandlers.changeEmail,
      { currentPassword: "secret-pw-1", newEmail: "Same@example.com" },
      signedIn,
    );
    expectErrorIncludes(error, UserProfileErrors.emailUnchanged);
  });
});

describe("QN-Drift-Pins (client-Konstanten vs. Feature-Originale)", () => {
  test("UserProfileQueries.me spiegelt UserQueries.me", () => {
    // Der ProfileScreen darf das runtime-Barrel des user-Features nicht
    // importieren (Runtime-Isolation) und pinnt die QN lokal — dieser
    // Vergleich macht stillen Drift unmöglich.
    expect(UserProfileQueries.me).toBe(UserQueries.me);
  });
});

describe("danger-zone QN-Pin (ProfileScreen-Konstanten)", () => {
  test("request-deletion + cancel-deletion sind unter den gepinnten QNs dispatchbar", async () => {
    const seed = await seedLoginUser({ email: "danger@example.com", password: "secret-pw-1" });
    const signedIn = createTestUser({ id: seed.id, tenantId: seed.tenantId, roles: ["User"] });

    const requested = await stack.http.writeOk<{ status: string }>(
      UserDataRightsHandlers.requestDeletion,
      {},
      signedIn,
    );
    expect(requested.status).toBe("deletionRequested");

    const cancelled = await stack.http.writeOk<{ status: string }>(
      UserDataRightsHandlers.cancelDeletion,
      {},
      signedIn,
    );
    expect(cancelled.status).toBe("active");
  });
});
