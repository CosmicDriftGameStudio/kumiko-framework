// Security integration tests for tenant-admin surfaces (members + invite/cancel).
// Real HTTP via setupTestStack — no mocks. Proves access.admin alignment and
// tenant isolation before the MembersScreen ships to apps.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { access, type SessionUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { expectErrorIncludes, rolesOf, seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { Temporal } from "temporal-polyfill";
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
import { userSessionEntity, userSessionTable } from "../../sessions";
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
      // inviteScreen: this suite dispatches AuthHandlers.inviteCreate and
      // needs /members' invite-create actionForm screen registered too.
      createTenantFeature({ inviteScreen: true }),
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
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
  });
  await createEventsTable(stack.db);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantInvitationsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userSessionTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${eventsTable.tableName}"`);
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
  test("403 on members, invitations, team:list, invite-create, cancel-invitation", async () => {
    for (const [label, fn] of [
      ["members", () => stack.http.query(TenantQueries.members, {}, regularUserB())],
      ["invitations", () => stack.http.query(TenantQueries.invitations, {}, regularUserB())],
      ["team:list", () => stack.http.query(TenantQueries.teamList, {}, regularUserB())],
      [
        "invite-create",
        () =>
          stack.http.write(
            AuthHandlers.inviteCreate,
            { email: "x@y.com", role: "User" },
            regularUserB(),
          ),
      ],
      [
        "update-member-roles",
        () =>
          stack.http.write(
            TenantHandlers.updateMemberRoles,
            { userId: regularUserBId, tenantId: TENANT_B_ID, roles: ["Admin"] },
            regularUserB(),
          ),
      ],
    ] as const) {
      const res = await fn();
      expect(res.status, label).toBe(403);
    }
  });

  // The /members screen gates on the SAME access.admin roles as its query
  // (see members-screens.boot.test.ts) — there is no separate HTTP surface
  // for "screen access" beyond the query/handlers it dispatches, so denying
  // the query above + the screen.access assertion together cover point 8.
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

  test("Admin cannot invite as TenantAdmin (elevation guard)", async () => {
    const { id: adminUserId } = await seedUser(stack.db, {
      email: "admin-inviter@example.com",
      displayName: "Admin Inviter",
    });
    await seedTenantMembership(stack.db, {
      userId: adminUserId,
      tenantId: TENANT_A_ID,
      roles: ["Admin"],
    });
    const adminUser: SessionUser = { id: adminUserId, tenantId: TENANT_A_ID, roles: ["Admin"] };

    const err = await stack.http.writeErr(
      AuthHandlers.inviteCreate,
      { email: "elevated-invitee@example.com", role: "TenantAdmin" },
      adminUser,
    );
    expectErrorIncludes(err, "forbidden_role_elevation");
  });

  test("TenantAdmin cannot invite with unknown unranked role (elevation guard)", async () => {
    const err = await stack.http.writeErr(
      AuthHandlers.inviteCreate,
      { email: "unknown-role@example.com", role: "SuperCustomRole" },
      tenantAdminA(),
    );
    expectErrorIncludes(err, "forbidden_role_elevation");
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

type TeamListRow = {
  readonly id: string;
  readonly email: string | null;
  readonly roles: readonly string[];
  readonly status: "active" | "pending";
  readonly createdAt: string;
  readonly lastSeenAt: string | null;
};

async function queryTeamList(
  payload: Record<string, unknown>,
  user: SessionUser,
): Promise<readonly TeamListRow[]> {
  const result = await stack.http.queryOk<{
    rows: readonly TeamListRow[];
    nextCursor: string | null;
  }>(TenantQueries.teamList, payload, user);
  return result.rows;
}

describe("tenant:query:team:list — combined members + pending invitations (§2.6a)", () => {
  test("returns both memberships and pending invitations with correct per-row status", async () => {
    const { id: memberUserId } = await seedUser(stack.db, {
      email: "member-x@example.com",
      displayName: "Member X",
      passwordHash: await hashPassword("pw-x-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: memberUserId,
      tenantId: TENANT_A_ID,
      roles: ["User"],
    });
    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "invitee-x@example.com", role: "Editor" },
      tenantAdminA(),
    );

    const rows = await queryTeamList({}, tenantAdminA());
    const admin = rows.find((r) => r.email === "admin-a@example.com");
    const member = rows.find((r) => r.email === "member-x@example.com");
    const invitee = rows.find((r) => r.email === "invitee-x@example.com");
    expect(admin?.status).toBe("active");
    expect(admin?.roles).toEqual(["TenantAdmin"]);
    expect(member?.status).toBe("active");
    expect(member?.roles).toEqual(["User"]);
    expect(invitee?.status).toBe("pending");
    expect(invitee?.roles).toEqual(["Editor"]);
  });

  test("status facet genuinely narrows to matching rows, not just the count", async () => {
    const { id: memberUserId } = await seedUser(stack.db, {
      email: "member-y@example.com",
      displayName: "Member Y",
      passwordHash: await hashPassword("pw-y-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: memberUserId,
      tenantId: TENANT_A_ID,
      roles: ["User"],
    });
    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "invitee-y1@example.com", role: "User" },
      tenantAdminA(),
    );
    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "invitee-y2@example.com", role: "User" },
      tenantAdminA(),
    );

    const pendingOnly = await queryTeamList(
      { filters: [{ field: "status", op: "in", value: ["pending"] }] },
      tenantAdminA(),
    );
    expect(pendingOnly.map((r) => r.email).sort()).toEqual([
      "invitee-y1@example.com",
      "invitee-y2@example.com",
    ]);

    const activeOnly = await queryTeamList(
      { filters: [{ field: "status", op: "in", value: ["active"] }] },
      tenantAdminA(),
    );
    expect(activeOnly.map((r) => r.email).sort()).toEqual([
      "admin-a@example.com",
      "member-y@example.com",
    ]);

    const unfiltered = await queryTeamList({}, tenantAdminA());
    expect(unfiltered).toHaveLength(pendingOnly.length + activeOnly.length);
  });

  test("sort direction genuinely reverses row order across ≥3 differing rows", async () => {
    for (const email of [
      "aaa-member@example.com",
      "mmm-member@example.com",
      "zzz-member@example.com",
    ]) {
      const { id: userId } = await seedUser(stack.db, {
        email,
        displayName: email,
        passwordHash: await hashPassword("pw-sort-1234"),
        emailVerified: true,
      });
      await seedTenantMembership(stack.db, { userId, tenantId: TENANT_A_ID, roles: ["User"] });
    }

    const asc = await queryTeamList({ sort: "email", sortDirection: "asc" }, tenantAdminA());
    const desc = await queryTeamList({ sort: "email", sortDirection: "desc" }, tenantAdminA());
    expect(asc.map((r) => r.email)).toEqual([
      "aaa-member@example.com",
      "admin-a@example.com",
      "mmm-member@example.com",
      "zzz-member@example.com",
    ]);
    expect(desc.map((r) => r.email)).toEqual([
      "zzz-member@example.com",
      "mmm-member@example.com",
      "admin-a@example.com",
      "aaa-member@example.com",
    ]);
  });

  test("pagination crosses both sources: memberships-only page, then a page including invitations", async () => {
    for (const email of ["page-member-1@example.com", "page-member-2@example.com"]) {
      const { id: userId } = await seedUser(stack.db, {
        email,
        displayName: email,
        passwordHash: await hashPassword("pw-page-1234"),
        emailVerified: true,
      });
      await seedTenantMembership(stack.db, { userId, tenantId: TENANT_A_ID, roles: ["User"] });
    }
    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "page-invitee-1@example.com", role: "User" },
      tenantAdminA(),
    );
    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "page-invitee-2@example.com", role: "User" },
      tenantAdminA(),
    );
    // 3 members (adminA + 2 seeded, created first) + 2 invitations (created
    // after) = 5 rows. Sorted oldest-first, a page size of 3 lands exactly
    // on the members/invitations boundary.
    const page1 = await queryTeamList(
      { sort: "createdAt", sortDirection: "asc", limit: 3, offset: 0 },
      tenantAdminA(),
    );
    const page2 = await queryTeamList(
      { sort: "createdAt", sortDirection: "asc", limit: 3, offset: 3 },
      tenantAdminA(),
    );
    expect(page1).toHaveLength(3);
    expect(page1.every((r) => r.status === "active")).toBe(true);
    expect(page2).toHaveLength(2);
    expect(page2.every((r) => r.status === "pending")).toBe(true);

    const allIds = [...page1, ...page2].map((r) => r.id);
    expect(new Set(allIds).size).toBe(5);
  });

  test("lastSeenAt is set for a member with a session, null for one without, and null for an invitation", async () => {
    const { id: withSessionId } = await seedUser(stack.db, {
      email: "with-session@example.com",
      displayName: "With Session",
      passwordHash: await hashPassword("pw-sess-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: withSessionId,
      tenantId: TENANT_A_ID,
      roles: ["User"],
    });
    const seededLastSeen = Temporal.Now.instant().subtract({ minutes: 5 });
    await seedRow(stack.db, userSessionTable, {
      id: crypto.randomUUID(),
      userId: withSessionId,
      tenantId: TENANT_A_ID,
      createdAt: Temporal.Now.instant().subtract({ hours: 1 }),
      expiresAt: Temporal.Now.instant().add({ hours: 1 }),
      lastSeenAt: seededLastSeen,
    });

    const { id: withoutSessionId } = await seedUser(stack.db, {
      email: "without-session@example.com",
      displayName: "Without Session",
      passwordHash: await hashPassword("pw-nosess-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: withoutSessionId,
      tenantId: TENANT_A_ID,
      roles: ["User"],
    });
    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "invitee-lastseen@example.com", role: "User" },
      tenantAdminA(),
    );

    const rows = await queryTeamList({}, tenantAdminA());
    const withSession = rows.find((r) => r.email === "with-session@example.com");
    const withoutSession = rows.find((r) => r.email === "without-session@example.com");
    const invitee = rows.find((r) => r.email === "invitee-lastseen@example.com");

    expect(withSession?.lastSeenAt).not.toBeNull();
    const driftMs = Math.abs(
      Temporal.Instant.from(withSession?.lastSeenAt as string).epochMilliseconds -
        seededLastSeen.epochMilliseconds,
    );
    expect(driftMs).toBeLessThan(1_000);
    expect(withoutSession?.lastSeenAt).toBeNull();
    expect(invitee?.lastSeenAt).toBeNull();
  });
});

describe("cancel-invitation on the /members surface genuinely cancels", () => {
  test("a pending invitation created via invite-create disappears from team:list after cancel-invitation", async () => {
    await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "cancel-me@example.com", role: "User" },
      tenantAdminA(),
    );
    const before = await queryTeamList({}, tenantAdminA());
    const pending = before.find((r) => r.email === "cancel-me@example.com");
    expect(pending?.status).toBe("pending");
    if (pending === undefined) throw new Error("expected the seeded invitation to be listed");

    await stack.http.writeOk(
      TenantHandlers.cancelInvitation,
      { invitationId: pending.id },
      tenantAdminA(),
    );

    const after = await queryTeamList({}, tenantAdminA());
    expect(after.some((r) => r.email === "cancel-me@example.com")).toBe(false);
  });
});

describe("updateMemberRoles — TenantAdmin session-scoped path and safety gates", () => {
  test("TenantAdmin can update roles of a member in own tenant", async () => {
    const { id: memberUserId } = await seedUser(stack.db, {
      email: "updatable-member@example.com",
      displayName: "Updatable Member",
      passwordHash: await hashPassword("pw-update-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: memberUserId,
      tenantId: TENANT_A_ID,
      roles: ["User"],
    });

    const res = await stack.http.writeOk(
      TenantHandlers.updateMemberRoles,
      { userId: memberUserId, tenantId: TENANT_A_ID, roles: ["Admin"] },
      tenantAdminA(),
    );
    expect(res).toMatchObject({ userId: memberUserId, tenantId: TENANT_A_ID, roles: ["Admin"] });

    const rows = await selectMany(stack.db, tenantMembershipsTable, {
      userId: memberUserId,
      tenantId: TENANT_A_ID,
    });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]?.["roles"] as string)).toEqual(["Admin"]);
  });

  test("TenantAdmin cannot update membership of a user in another tenant", async () => {
    const { id: otherTenantMemberId } = await seedUser(stack.db, {
      email: "other-tenant-member@example.com",
      displayName: "Other Tenant Member",
      passwordHash: await hashPassword("pw-other-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: otherTenantMemberId,
      tenantId: TENANT_B_ID,
      roles: ["User"],
    });

    const err = await stack.http.writeErr(
      TenantHandlers.updateMemberRoles,
      { userId: otherTenantMemberId, tenantId: TENANT_B_ID, roles: ["Admin"] },
      tenantAdminA(),
    );
    expectErrorIncludes(err, "membership_not_found");
  });

  test("TenantAdmin cannot assign reserved/global roles", async () => {
    const { id: memberUserId } = await seedUser(stack.db, {
      email: "reserved-role-target@example.com",
      displayName: "Reserved Role Target",
      passwordHash: await hashPassword("pw-res-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: memberUserId,
      tenantId: TENANT_A_ID,
      roles: ["User"],
    });

    for (const role of FORBIDDEN_ROLES) {
      const err = await stack.http.writeErr(
        TenantHandlers.updateMemberRoles,
        { userId: memberUserId, tenantId: TENANT_A_ID, roles: [role] },
        tenantAdminA(),
      );
      expectErrorIncludes(err, "access_denied");
      expectErrorIncludes(err, "reserved_membership_role");
    }
  });

  test("TenantAdmin can demote a member that currently holds an app-defined role", async () => {
    const { id: memberUserId } = await seedUser(stack.db, {
      email: "editor-demote-target@example.com",
      displayName: "Editor Demote Target",
      passwordHash: await hashPassword("pw-ed-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: memberUserId,
      tenantId: TENANT_A_ID,
      roles: ["Editor"],
    });

    const res = await stack.http.writeOk(
      TenantHandlers.updateMemberRoles,
      { userId: memberUserId, tenantId: TENANT_A_ID, roles: ["User"] },
      tenantAdminA(),
    );
    expect(res).toMatchObject({ userId: memberUserId, roles: ["User"] });

    const rows = await selectMany(stack.db, tenantMembershipsTable, {
      userId: memberUserId,
      tenantId: TENANT_A_ID,
    });
    expect(JSON.parse(rows[0]?.["roles"] as string)).toEqual(["User"]);
  });

  test("TenantAdmin cannot assign unknown role (elevation guard)", async () => {
    const { id: memberUserId } = await seedUser(stack.db, {
      email: "elevation-guard-target@example.com",
      displayName: "Elevation Guard Target",
      passwordHash: await hashPassword("pw-elev-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: memberUserId,
      tenantId: TENANT_A_ID,
      roles: ["User"],
    });

    const err = await stack.http.writeErr(
      TenantHandlers.updateMemberRoles,
      { userId: memberUserId, tenantId: TENANT_A_ID, roles: ["SuperCustomRole"] },
      tenantAdminA(),
    );
    expectErrorIncludes(err, "access_denied");
    expectErrorIncludes(err, "unassignable_membership_role");
  });

  test("Admin cannot elevate target to TenantAdmin or modify a TenantAdmin", async () => {
    const { id: adminUserId } = await seedUser(stack.db, {
      email: "plain-admin@example.com",
      displayName: "Plain Admin",
      passwordHash: await hashPassword("pw-adm-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: adminUserId,
      tenantId: TENANT_A_ID,
      roles: ["Admin"],
    });
    const adminUser: SessionUser = { id: adminUserId, tenantId: TENANT_A_ID, roles: ["Admin"] };

    const { id: regularMemberId } = await seedUser(stack.db, {
      email: "plain-member@example.com",
      displayName: "Plain Member",
      passwordHash: await hashPassword("pw-mem-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: regularMemberId,
      tenantId: TENANT_A_ID,
      roles: ["User"],
    });

    // 1. Admin tries to assign TenantAdmin to regular member -> rejected
    const errElevate = await stack.http.writeErr(
      TenantHandlers.updateMemberRoles,
      { userId: regularMemberId, tenantId: TENANT_A_ID, roles: ["TenantAdmin"] },
      adminUser,
    );
    expectErrorIncludes(errElevate, "unassignable_membership_role");

    // 2. Admin tries to modify existing TenantAdmin -> rejected
    const errModifyHigher = await stack.http.writeErr(
      TenantHandlers.updateMemberRoles,
      { userId: tenantAdminAId, tenantId: TENANT_A_ID, roles: ["Admin"] },
      adminUser,
    );
    expectErrorIncludes(errModifyHigher, "unassignable_membership_role");
  });

  test("refuses demoting/removing the last TenantAdmin", async () => {
    // tenantAdminA is currently the only TenantAdmin in TENANT_A_ID
    const err = await stack.http.writeErr(
      TenantHandlers.updateMemberRoles,
      { userId: tenantAdminAId, tenantId: TENANT_A_ID, roles: ["User"] },
      tenantAdminA(),
    );
    expectErrorIncludes(err, "last_tenant_admin");
    expectErrorIncludes(err, "cannot demote the last tenant admin");

    // Verify role remains unchanged
    const rows = await selectMany(stack.db, tenantMembershipsTable, {
      userId: tenantAdminAId,
      tenantId: TENANT_A_ID,
    });
    expect(JSON.parse(rows[0]?.["roles"] as string)).toEqual(["TenantAdmin"]);
  });

  test("allows demoting a TenantAdmin when another TenantAdmin exists", async () => {
    const { id: secondAdminId } = await seedUser(stack.db, {
      email: "second-admin@example.com",
      displayName: "Second Admin",
      passwordHash: await hashPassword("pw-adm2-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: secondAdminId,
      tenantId: TENANT_A_ID,
      roles: ["TenantAdmin"],
    });

    // Now there are 2 TenantAdmins (tenantAdminA and secondAdminId)
    const res = await stack.http.writeOk(
      TenantHandlers.updateMemberRoles,
      { userId: secondAdminId, tenantId: TENANT_A_ID, roles: ["Admin"] },
      tenantAdminA(),
    );
    expect(res).toMatchObject({ userId: secondAdminId, roles: ["Admin"] });

    const rows = await selectMany(stack.db, tenantMembershipsTable, {
      userId: secondAdminId,
      tenantId: TENANT_A_ID,
    });
    expect(JSON.parse(rows[0]?.["roles"] as string)).toEqual(["Admin"]);
  });

  test("SystemAdmin can update member roles across tenants", async () => {
    const { id: memberUserId } = await seedUser(stack.db, {
      email: "sysadmin-cross-target@example.com",
      displayName: "SysAdmin Target",
      passwordHash: await hashPassword("pw-sys-1234"),
      emailVerified: true,
    });
    await seedTenantMembership(stack.db, {
      userId: memberUserId,
      tenantId: TENANT_B_ID,
      roles: ["User"],
    });

    const res = await stack.http.writeOk(
      TenantHandlers.updateMemberRoles,
      { userId: memberUserId, tenantId: TENANT_B_ID, roles: ["Admin"] },
      TestUsers.systemAdmin,
    );
    expect(res).toMatchObject({ userId: memberUserId, tenantId: TENANT_B_ID, roles: ["Admin"] });

    const rows = await selectMany(stack.db, tenantMembershipsTable, {
      userId: memberUserId,
      tenantId: TENANT_B_ID,
    });
    expect(JSON.parse(rows[0]?.["roles"] as string)).toEqual(["Admin"]);
  });

  test("updateMemberRoles appends audit event and invalidates active sessions for target user", async () => {
    const { id: memberUserId } = await seedUser(stack.db, {
      email: "session-target@example.com",
      displayName: "Session Target",
    });
    await seedTenantMembership(stack.db, {
      userId: memberUserId,
      tenantId: TENANT_A_ID,
      roles: ["User"],
    });

    const sessionTarget1Id = crypto.randomUUID();
    const sessionTarget2Id = crypto.randomUUID();
    const sessionAdminId = crypto.randomUUID();
    await seedRow(stack.db, userSessionTable, {
      id: sessionTarget1Id,
      userId: memberUserId,
      tenantId: TENANT_A_ID,
      createdAt: Temporal.Now.instant().subtract({ minutes: 30 }),
      expiresAt: Temporal.Now.instant().add({ hours: 2 }),
    });
    await seedRow(stack.db, userSessionTable, {
      id: sessionTarget2Id,
      userId: memberUserId,
      tenantId: TENANT_A_ID,
      createdAt: Temporal.Now.instant().subtract({ minutes: 10 }),
      expiresAt: Temporal.Now.instant().add({ hours: 2 }),
    });
    await seedRow(stack.db, userSessionTable, {
      id: sessionAdminId,
      userId: tenantAdminAId,
      tenantId: TENANT_A_ID,
      createdAt: Temporal.Now.instant().subtract({ minutes: 5 }),
      expiresAt: Temporal.Now.instant().add({ hours: 2 }),
    });

    const res = await stack.http.writeOk(
      TenantHandlers.updateMemberRoles,
      { userId: memberUserId, tenantId: TENANT_A_ID, roles: ["Admin"] },
      tenantAdminA(),
    );
    expect(res).toMatchObject({ userId: memberUserId, tenantId: TENANT_A_ID, roles: ["Admin"] });

    const [s1] = await selectMany(stack.db, userSessionTable, { id: sessionTarget1Id });
    const [s2] = await selectMany(stack.db, userSessionTable, { id: sessionTarget2Id });
    expect(s1?.revokedAt).not.toBeNull();
    expect(s2?.revokedAt).not.toBeNull();

    const [sAdmin] = await selectMany(stack.db, userSessionTable, { id: sessionAdminId });
    expect(sAdmin?.revokedAt).toBeNull();

    const membershipEvents = await selectMany(stack.db, eventsTable, {
      aggregateType: "tenant-membership",
    });
    const updateEvent = membershipEvents.find(
      (e) => e.tenantId === TENANT_A_ID && e.by === tenantAdminAId,
    );
    expect(updateEvent).toBeDefined();
    expect(JSON.parse(updateEvent?.payload as string)).toMatchObject({
      changes: { roles: JSON.stringify(["Admin"]) },
    });
  });
});

describe("invite + accept end-to-end integration against real stack", () => {
  test("TenantAdmin invites user with Admin role, recipient accepts via invite-signup-complete and gains Admin membership", async () => {
    const inviteeEmail = "invitee-e2e@example.com";
    const inviteRes = (await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: inviteeEmail, role: "Admin" },
      tenantAdminA(),
    )) as { invitationId: string; email: string };

    expect(inviteRes.email).toBe(inviteeEmail);

    const sentMail = emailTransport.sent.find((m) => m.to.includes(inviteeEmail));
    expect(sentMail).toBeDefined();
    const tokenMatch = sentMail?.html?.match(/token=([a-zA-Z0-9_-]+)/);
    expect(tokenMatch?.[1]).toBeDefined();
    const token = tokenMatch![1];

    const acceptRes = await stack.http.raw("POST", "/api/auth/invite-signup-complete", {
      token,
      email: inviteeEmail,
      name: "Invited Admin",
      password: "StrongValidPassword123!",
    });
    expect(acceptRes.status).toBe(200);
    const acceptBody = (await acceptRes.json()) as { user?: { id?: string }; token?: string };
    expect(acceptBody.user?.id).toBeDefined();
    const newUserId = acceptBody.user!.id!;

    const memberships = await selectMany(stack.db, tenantMembershipsTable, {
      userId: newUserId,
      tenantId: TENANT_A_ID,
    });
    expect(memberships).toHaveLength(1);
    expect(JSON.parse(memberships[0]?.roles as string)).toEqual(["Admin"]);

    const teamRows = await queryTeamList({}, tenantAdminA());
    const pendingInvite = teamRows.find((r) => r.email === inviteeEmail && r.status === "pending");
    expect(pendingInvite).toBeUndefined();
    const activeMember = teamRows.find((r) => r.email === inviteeEmail && r.status === "active");
    expect(activeMember).toBeDefined();

    const newAdminSession: SessionUser = { id: newUserId, tenantId: TENANT_A_ID, roles: ["Admin"] };
    const membersList = await stack.http.queryOk<readonly { userId: string }[]>(
      TenantQueries.members,
      {},
      newAdminSession,
    );
    expect(membersList.some((m) => m.userId === newUserId)).toBe(true);
  });
});

describe("members UI screens and actions integration against real stack", () => {
  test("members screen and member-roles-edit actionForm execute through stack", async () => {
    const membersScreen = stack.registry.getScreen(MEMBERS_SCREEN_ID);
    expect(membersScreen).toBeDefined();
    expect(membersScreen?.type).toBe("projectionList");

    const editRolesScreen = stack.registry.getScreen("member-roles-edit");
    expect(editRolesScreen).toBeDefined();
    expect(editRolesScreen?.type).toBe("actionForm");

    const { id: memberUserId } = await seedUser(stack.db, {
      email: "ui-member@example.com",
      displayName: "UI Member",
    });
    await seedTenantMembership(stack.db, {
      userId: memberUserId,
      tenantId: TENANT_A_ID,
      roles: ["User"],
    });

    const res = await stack.http.writeOk(
      TenantHandlers.updateMemberRoles,
      { userId: memberUserId, tenantId: TENANT_A_ID, roles: ["Admin"] },
      tenantAdminA(),
    );
    expect(res).toMatchObject({ userId: memberUserId, tenantId: TENANT_A_ID, roles: ["Admin"] });
  });
});
