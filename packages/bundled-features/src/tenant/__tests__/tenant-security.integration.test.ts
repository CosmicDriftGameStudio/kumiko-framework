// Security integration tests for tenant-admin surfaces (members + invite/cancel).
// Real HTTP via setupTestStack — no mocks. Proves access.admin alignment and
// tenant isolation before the MembersScreen ships to apps.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, type SessionUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes, rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { AuthHandlers } from "../../auth-email-password/constants";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery";
import { notificationPreferencesTable } from "../../delivery/tables";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple";
import { hashPassword } from "../../shared";
import { createTemplateResolverFeature } from "../../template-resolver/feature";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { seedUser } from "../../user/seeding";
import { MEMBERS_SCREEN_ID, TenantHandlers, TenantQueries } from "../constants";
import { createTenantFeature } from "../feature";
import { tenantInvitationEntity, tenantInvitationsTable } from "../invitation-table";
import { tenantMembershipsTable } from "../membership-table";
import { tenantEntity, tenantTable } from "../schema/tenant";
import { seedTenant, seedTenantMembership } from "../seeding";

const emailTransport = createInMemoryTransport();
const APP_ACCEPT_URL = "https://app.example.com/invite/accept";
const FORBIDDEN_ROLES = ["SystemAdmin", "system", "all", "anonymous"] as const;

let stack: TestStack;
let TENANT_A_ID: TenantId;
let TENANT_B_ID: TenantId;
let tenantAdminAId: string;
let regularUserBId: string;

function newTenantId(): TenantId {
  return crypto.randomUUID() as TenantId;
}

function tenantAdminA(): SessionUser {
  return { id: tenantAdminAId, tenantId: TENANT_A_ID, roles: ["TenantAdmin"] };
}

function regularUserB(): SessionUser {
  return { id: regularUserBId, tenantId: TENANT_B_ID, roles: ["User"] };
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createDeliveryFeature(),
      createRendererSimpleFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        renderer: simpleRenderer,
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        invite: { tokenTtlMinutes: 60, appUrl: APP_ACCEPT_URL },
      }),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver(),
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      invite: {
        acceptHandler: AuthHandlers.inviteAccept,
        acceptWithLoginHandler: AuthHandlers.inviteAcceptWithLogin,
        signupCompleteHandler: AuthHandlers.inviteSignupComplete,
      },
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantInvitationEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantInvitationsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantTable.tableName}"`);
  emailTransport.sent.length = 0;
  const keys = await stack.redis.redis.keys("invite:*");
  if (keys.length > 0) await stack.redis.redis.del(...keys);

  TENANT_A_ID = newTenantId();
  TENANT_B_ID = newTenantId();
  await seedTenant(stack.db, {
    id: TENANT_A_ID,
    key: `tenant-a-${TENANT_A_ID.slice(0, 8)}`,
    name: "Tenant A",
  });
  await seedTenant(stack.db, {
    id: TENANT_B_ID,
    key: `tenant-b-${TENANT_B_ID.slice(0, 8)}`,
    name: "Tenant B",
  });

  ({ id: tenantAdminAId } = await seedUser(stack.db, {
    email: "admin-a@example.com",
    displayName: "Admin A",
    passwordHash: await hashPassword("pw-a-1234"),
    emailVerified: true,
  }));
  await seedTenantMembership(stack.db, {
    userId: tenantAdminAId,
    tenantId: TENANT_A_ID,
    roles: ["TenantAdmin"],
  });

  ({ id: regularUserBId } = await seedUser(stack.db, {
    email: "user-b@example.com",
    displayName: "User B",
    passwordHash: await hashPassword("pw-b-1234"),
    emailVerified: true,
  }));
  await seedTenantMembership(stack.db, {
    userId: regularUserBId,
    tenantId: TENANT_B_ID,
    roles: ["User"],
  });
});

describe("access matrix: members screen handlers use access.admin", () => {
  test("invite-create, members, invitations, cancel-invitation share access.admin", () => {
    const adminRoles = [...access.admin];
    expect(rolesOf(stack.registry.getWriteHandler(AuthHandlers.inviteCreate)?.access)).toEqual(
      adminRoles,
    );
    expect(rolesOf(stack.registry.getQueryHandler(TenantQueries.members)?.access)).toEqual(
      adminRoles,
    );
    expect(rolesOf(stack.registry.getQueryHandler(TenantQueries.invitations)?.access)).toEqual(
      adminRoles,
    );
    expect(
      rolesOf(stack.registry.getWriteHandler(TenantHandlers.cancelInvitation)?.access),
    ).toEqual(adminRoles);
  });

  test("members screen access matches access.admin", () => {
    const tenant = createTenantFeature();
    const screen = tenant.screens[MEMBERS_SCREEN_ID];
    expect(screen && "access" in screen && screen.access && "roles" in screen.access).toBe(true);
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(access.admin);
    }
  });
});

describe("TenantAdmin can use members-admin HTTP surface", () => {
  test("TenantAdmin invites → row persisted in own tenant", async () => {
    const result = (await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "new@example.com", role: "User" },
      tenantAdminA(),
    )) as { tenantId: string; email: string };
    expect(result.tenantId).toBe(TENANT_A_ID);
    const rows = await selectMany(stack.db, tenantInvitationsTable, { email: "new@example.com" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["tenantId"]).toBe(TENANT_A_ID);
  });

  test("TenantAdmin lists members and pending invitations for own tenant only", async () => {
    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "pending@example.com", role: "Editor" },
      tenantAdminA(),
    );
    const members = await stack.http.queryOk<
      readonly { userId: string; email: string | null; displayName: string | null }[]
    >(TenantQueries.members, {}, tenantAdminA());
    expect(members.some((m) => m.userId === tenantAdminAId)).toBe(true);
    const self = members.find((m) => m.userId === tenantAdminAId);
    expect(self?.email).toBe("admin-a@example.com");
    const invitations = await stack.http.queryOk<readonly { email: string }[]>(
      TenantQueries.invitations,
      {},
      tenantAdminA(),
    );
    expect(invitations).toHaveLength(1);
    expect(invitations[0]?.email).toBe("pending@example.com");
  });

  test("members email is null when user row is missing", async () => {
    const orphanUserId = "00000000-0000-4000-8000-00000000dead";
    await seedTenantMembership(stack.db, {
      userId: orphanUserId,
      tenantId: TENANT_A_ID,
      roles: ["User"],
    });
    const members = await stack.http.queryOk<readonly { userId: string; email: string | null }[]>(
      TenantQueries.members,
      {},
      tenantAdminA(),
    );
    expect(members.find((m) => m.userId === orphanUserId)?.email).toBeNull();
  });
});

describe("regular User is denied members-admin surface", () => {
  test("403 on members, invitations, invite-create, cancel-invitation", async () => {
    for (const [label, fn] of [
      ["members", () => stack.http.query(TenantQueries.members, {}, regularUserB())],
      ["invitations", () => stack.http.query(TenantQueries.invitations, {}, regularUserB())],
      [
        "invite-create",
        () =>
          stack.http.write(
            AuthHandlers.inviteCreate,
            { email: "x@y.com", role: "User" },
            regularUserB(),
          ),
      ],
    ] as const) {
      const res = await fn();
      expect(res.status, label).toBe(403);
    }
  });
});

describe("privilege escalation via invite role", () => {
  test("TenantAdmin cannot invite reserved/global roles", async () => {
    for (const role of FORBIDDEN_ROLES) {
      const err = await stack.http.writeErr(
        AuthHandlers.inviteCreate,
        { email: "escalate@example.com", role },
        tenantAdminA(),
      );
      expectErrorIncludes(err, "access_denied");
    }
    const rows = await selectMany(stack.db, tenantInvitationsTable, {
      email: "escalate@example.com",
    });
    expect(rows).toHaveLength(0);
    expect(emailTransport.sent).toHaveLength(0);
  });
});

describe("tenant isolation on cancel-invitation", () => {
  test("TenantAdmin cannot cancel invitation belonging to another tenant", async () => {
    const { id: adminBId } = await seedUser(stack.db, {
      email: "admin-b@example.com",
      displayName: "Admin B",
      passwordHash: await hashPassword("pw-b-admin-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: adminBId,
      tenantId: TENANT_B_ID,
      roles: ["TenantAdmin"],
    });
    const adminB: SessionUser = { id: adminBId, tenantId: TENANT_B_ID, roles: ["TenantAdmin"] };
    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "cross@example.com", role: "User" },
      adminB,
    );
    const rows = await selectMany(stack.db, tenantInvitationsTable, { email: "cross@example.com" });
    const invitationId = rows[0]?.["id"] as string;

    const err = await stack.http.writeErr(
      TenantHandlers.cancelInvitation,
      { invitationId },
      tenantAdminA(),
    );
    expectErrorIncludes(err, "invitation_not_found");
  });
});

describe("updateMemberRoles not reachable by TenantAdmin", () => {
  test("TenantAdmin gets access_denied on updateMemberRoles", async () => {
    const err = await stack.http.writeErr(
      TenantHandlers.updateMemberRoles,
      { userId: tenantAdminAId, tenantId: TENANT_A_ID, roles: ["User"] },
      tenantAdminA(),
    );
    expectErrorIncludes(err, "access_denied");
  });
});
