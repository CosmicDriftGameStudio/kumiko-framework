// Tenant-Invite-Flow Full-Stack Integration-Test. Spec für die 3
// Accept-Branches via stack.http (echte HTTP-Routes durch).
//
// Setup:
//   - Tenant-A mit Admin "alice@" als Admin-Member
//   - Tenant-B mit User "bob@" als Member (für Branch 1: Bob ist
//     eingeloggt in Tenant-B und akzeptiert ein Tenant-A-Invite)
//   - "carol@" existiert NICHT (für Branch 3: neue Email)
//
// Flow pro Test:
//   1. Admin invitet email → invite-create (Admin-Auth)
//   2. Invite-Mail via delivery (in-memory transport) an den Invitee
//   3. Token aus dem Mail-HTML extrahieren (NICHT aus dem Admin-Result)
//   4. Branch-spezifischer Accept-Endpoint
//   5. DB-State + Membership + Cookies/JWT verifizieren

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  createAnonymousUser,
  createSystemUser,
  defineFeature,
  EXT_ASSIGNABLE_ROLE,
  type SessionUser,
  SYSTEM_TENANT_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { seedRow } from "@cosmicdrift/kumiko-framework/testing";
import { parseRoles } from "@cosmicdrift/kumiko-framework/utils";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.js";
import { notificationPreferencesTable } from "../../delivery/tables.js";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.js";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple/index.js";
import { hashPassword } from "../../shared/index.js";
import { createTemplateResolverFeature } from "../../template-resolver/feature.js";
import {
  collectAssignableAppRoles,
  createTenantFeature,
  TenantErrors,
  TenantHandlers,
} from "../../tenant/index.js";
import {
  INVITATION_STATUS,
  tenantInvitationEntity,
  tenantInvitationsTable,
} from "../../tenant/invitation-table.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.js";
import { seedTenant, seedTenantMembership } from "../../tenant/seeding.js";
import { createUserFeature } from "../../user/feature.js";
import { userEntity, userTable } from "../../user/schema/user.js";
import { AuthErrors, AuthHandlers, AuthQueries } from "../constants.js";
import { createAuthEmailPasswordFeature } from "../feature.js";
import { storeInviteToken } from "../invite-token-store.js";
import { seedUser } from "../seeding.js";

const APP_ACCEPT_URL = "https://app.example.com/invite/accept";
const ALICE_EMAIL = "alice@example.com";
const BOB_EMAIL = "bob@example.com";
const CAROL_EMAIL = "carol@example.com";
const BOB_PASSWORD = "bob-existing-pw-1234";
const CAROL_PASSWORD = "carol-new-pw-1234";

// Invite mails now go through delivery (ctx.notify → channel-email). The
// in-memory transport captures what would be sent; route:{email} delivers
// directly (no jobRunner in the test stack → inline send).
const emailTransport = createInMemoryTransport();

// Declares one role Admin may grant (default) and one only TenantAdmin may grant.
const assignableRolesAppFeature = defineFeature("invite-assignable-roles-app", (r) => {
  r.requires("tenant");
  r.useExtension(EXT_ASSIGNABLE_ROLE, "PropertyManager");
  r.useExtension(EXT_ASSIGNABLE_ROLE, "Auditor", { assignableFrom: "TenantAdmin" });
});

let stack: TestStack;
let aliceId: string;
let bobId: string;
// Pro Test frische Tenant-IDs damit der event-store-stream beim
// db.delete-cleanup nicht mit version_conflict beim Re-seed feuert.
let TENANT_A_ID: TenantId;
let TENANT_B_ID: TenantId;

function newTenantId(_suffix: string): TenantId {
  // UUIDv4 + suffix für Lesbarkeit in Logs.
  const rand = crypto.randomUUID();
  return rand as TenantId;
}

const GUEST: SessionUser = createAnonymousUser(SYSTEM_TENANT_ID);

function extractTokenFromMail(html: string): string {
  const match = html.match(/[?&]token=([^&"'<\s]+)/);
  if (!match?.[1]) throw new Error(`No token in invite mail html: ${html.slice(0, 200)}`);
  return decodeURIComponent(match[1]);
}

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature({
        assignableAppRoles: collectAssignableAppRoles([assignableRolesAppFeature]),
      }),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createDeliveryFeature(),
      createRendererSimpleFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        renderer: simpleRenderer,
        // route:{email} delivers directly — resolveEmail (userId→address) is
        // never hit by the invite flow, but the channel requires it.
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        invite: { tokenTtlMinutes: 60, appUrl: APP_ACCEPT_URL },
      }),
      assignableRolesAppFeature,
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
        infoHandler: AuthQueries.inviteInfo,
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
  // Also clears rate-limit buckets: trustedProxyHops defaults to 0, so
  // every call in this file shares one unknown-IP bucket per handler —
  // without this, earlier invite-info calls would count toward the
  // rate-limit test's own budget.
  await stack.redis.flushNamespace();

  // Pro Test frische Tenant-IDs + tenant.key (sonst unique-violation
  // auf read_tenants_key_unique beim 2. Run).
  TENANT_A_ID = newTenantId("a");
  TENANT_B_ID = newTenantId("b");
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

  // Alice = Admin von Tenant-A
  ({ id: aliceId } = await seedUser(stack.db, {
    email: ALICE_EMAIL,
    displayName: "Alice",
    passwordHash: await hashPassword("alice-pw-1234"),
    emailVerified: true,
  }));
  await seedTenantMembership(stack.db, {
    userId: aliceId,
    tenantId: TENANT_A_ID,
    roles: ["Admin"],
  });

  // Bob = Member von Tenant-B (für Branch 1 + 2 tests)
  ({ id: bobId } = await seedUser(stack.db, {
    email: BOB_EMAIL,
    displayName: "Bob",
    passwordHash: await hashPassword(BOB_PASSWORD),
    emailVerified: true,
  }));
  await seedTenantMembership(stack.db, {
    userId: bobId,
    tenantId: TENANT_B_ID,
    roles: ["User"],
  });
});

function aliceSession(): SessionUser {
  return { id: aliceId, tenantId: TENANT_A_ID, roles: ["Admin"] };
}

function bobSession(): SessionUser {
  return { id: bobId, tenantId: TENANT_B_ID, roles: ["User"] };
}

async function authedRaw(
  method: string,
  path: string,
  body: unknown,
  user: SessionUser,
): Promise<Response> {
  const token = await stack.jwt.sign(user);
  return stack.http.raw(method, path, body, { Authorization: `Bearer ${token}` });
}

async function membershipRowOf(userId: string, tenantId: TenantId) {
  const [row] = await selectMany(stack.db, tenantMembershipsTable, { userId, tenantId });
  if (!row) throw new Error(`no membership for ${userId} in ${tenantId}`);
  return row;
}

async function membershipRolesOf(userId: string, tenantId: TenantId): Promise<string[]> {
  return [...parseRoles((await membershipRowOf(userId, tenantId))["roles"])].sort();
}

async function membershipVersionOf(userId: string, tenantId: TenantId): Promise<unknown> {
  return (await membershipRowOf(userId, tenantId))["version"];
}

async function changeBobRolesInTenantA(roles: readonly string[]): Promise<void> {
  await stack.http.writeOk(
    TenantHandlers.updateMemberRoles,
    { userId: bobId, roles },
    aliceSession(),
  );
}

async function expectInvitationSuperseded(res: Response): Promise<void> {
  expect(res.status).toBe(409);
  const body = (await res.json()) as { error?: { details?: { reason?: string } } };
  expect(body.error?.details?.reason).toBe(TenantErrors.invitationSuperseded);
}

async function inviteEmail(email: string, role: string): Promise<string> {
  // invite-create geht via /api/write (Admin-Auth via JWT). Der Handler
  // dispatcht die Invite-Mail via delivery; der Token erreicht den Invitee
  // NUR über die Mail (das Admin-Result enthält ihn nicht mehr).
  await stack.http.writeOk(AuthHandlers.inviteCreate, { email, role }, aliceSession());
  const sent = emailTransport.sent.at(-1);
  if (!sent) throw new Error("invite-create didn't send a mail");
  return extractTokenFromMail(sent.html);
}

describe("invite-create", () => {
  test("Admin invitet → invitation row + delivery sends mail with token URL", async () => {
    const result = (await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: BOB_EMAIL, role: "Admin" },
      aliceSession(),
    )) as { invitationId: string; email: string; role: string };

    expect(result.email).toBe(BOB_EMAIL);
    expect(result.role).toBe("Admin");
    // Der Token geht NICHT an den Admin zurück (er soll die Annahme nicht
    // impersonieren können) — nur an den Invitee per Mail.
    expect((result as { token?: string }).token).toBeUndefined();

    expect(emailTransport.sent).toHaveLength(1);
    const sent = emailTransport.sent[0];
    if (!sent) throw new Error("no mail sent");
    expect(sent.to).toBe(BOB_EMAIL);
    expect(sent.html).toContain(`${APP_ACCEPT_URL}?token=`);
    expect(sent.html).toContain("Admin");

    const rows = await selectMany(stack.db, tenantInvitationsTable, { email: BOB_EMAIL });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["status"]).toBe("pending");
    expect(rows[0]?.["role"]).toBe("Admin");
    expect(rows[0]?.["tenantId"]).toBe(TENANT_A_ID);
  });

  test("Resend: second invite for the same email reuses the row but mints a new token and invalidates the previous one (#2174)", async () => {
    const firstToken = await inviteEmail(BOB_EMAIL, "Admin");
    const secondToken = await inviteEmail(BOB_EMAIL, "Editor");

    expect(secondToken).not.toBe(firstToken);

    // Same row, role updated
    const rows = await selectMany(stack.db, tenantInvitationsTable, { email: BOB_EMAIL });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["role"]).toBe("Editor");

    // inviteEmail() only reads emailTransport.sent.at(-1) — a silent second-
    // dispatch failure would still leave sent.length===1, making the
    // not-equal check above pass for the wrong reason. Assert an actual
    // second dispatch happened.
    expect(emailTransport.sent).toHaveLength(2);

    // The first mail's link must actually stop working (not just look
    // different) — this is what catches a double-hash bug in invalidation.
    const firstRes = await authedRaw(
      "POST",
      "/api/auth/invite-accept",
      { token: firstToken },
      bobSession(),
    );
    expect(firstRes.status).toBe(422);
    const firstBody = (await firstRes.json()) as { error?: { details?: { reason?: string } } };
    expect(firstBody.error?.details?.reason).toBe(AuthErrors.invalidInviteToken);

    const secondRes = await authedRaw(
      "POST",
      "/api/auth/invite-accept",
      { token: secondToken },
      bobSession(),
    );
    expect(secondRes.status).toBe(200);
  });
});

describe("invite-accept (Branch 1: logged-in)", () => {
  test("Bob (logged-in in Tenant-B) accepts Tenant-A invite → membership added", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Admin");

    const result = (await stack.http.writeOk(
      AuthHandlers.inviteAccept,
      { token },
      bobSession(),
    )) as { tenantId: string; role: string; alreadyMember: boolean };

    expect(result.tenantId).toBe(TENANT_A_ID);
    expect(result.role).toBe("Admin");
    expect(result.alreadyMember).toBe(false);

    // Bob hat jetzt 2 Memberships
    const memberships = await selectMany(stack.db, tenantMembershipsTable, { userId: bobId });
    expect(memberships).toHaveLength(2);
    const tenantIds = memberships.map((m) => m["tenantId"]).sort();
    expect(tenantIds).toEqual([TENANT_A_ID, TENANT_B_ID].sort());

    // Invitation status = accepted
    const inv = await selectMany(stack.db, tenantInvitationsTable, { email: BOB_EMAIL });
    expect(inv[0]?.["status"]).toBe("accepted");
  });

  test("Email-Mismatch: Bob klickt Carol's Invite-Link → inviteEmailMismatch", async () => {
    const token = await inviteEmail(CAROL_EMAIL, "Admin");

    const res = await authedRaw("POST", "/api/auth/invite-accept", { token }, bobSession());
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.inviteEmailMismatch);
  });

  test("Already-Member: Bob ist schon Member → invited role is added, existing role kept, alreadyMember=true", async () => {
    await seedTenantMembership(stack.db, {
      userId: bobId,
      tenantId: TENANT_A_ID,
      roles: ["User"],
      by: createSystemUser(TENANT_A_ID),
    });

    const token = await inviteEmail(BOB_EMAIL, "Admin");

    const result = (await stack.http.writeOk(
      AuthHandlers.inviteAccept,
      { token },
      bobSession(),
    )) as { alreadyMember: boolean };
    expect(result.alreadyMember).toBe(true);
    expect(await membershipRolesOf(bobId, TENANT_A_ID)).toEqual(["Admin", "User"]);
  });

  test("bare member of the inviting tenant, logged in there, gets the invited role", async () => {
    await seedTenantMembership(stack.db, { userId: bobId, tenantId: TENANT_A_ID, roles: [] });
    const token = await inviteEmail(BOB_EMAIL, "Editor");

    const result = (await stack.http.writeOk(
      AuthHandlers.inviteAccept,
      { token },
      { id: bobId, tenantId: TENANT_A_ID, roles: [] },
    )) as { alreadyMember: boolean };

    expect(result.alreadyMember).toBe(true);
    expect(await membershipRolesOf(bobId, TENANT_A_ID)).toEqual(["Editor"]);
  });

  test("member who already holds the invited role keeps an unchanged membership stream", async () => {
    await seedTenantMembership(stack.db, {
      userId: bobId,
      tenantId: TENANT_A_ID,
      roles: ["Admin"],
    });
    const versionBefore = await membershipVersionOf(bobId, TENANT_A_ID);
    const token = await inviteEmail(BOB_EMAIL, "Admin");

    await stack.http.writeOk(AuthHandlers.inviteAccept, { token }, bobSession());

    expect(await membershipRolesOf(bobId, TENANT_A_ID)).toEqual(["Admin"]);
    expect(await membershipVersionOf(bobId, TENANT_A_ID)).toBe(versionBefore);
  });

  test("roles changed after the invitation was issued → accept rejected, roles unchanged", async () => {
    await seedTenantMembership(stack.db, {
      userId: bobId,
      tenantId: TENANT_A_ID,
      roles: ["Editor"],
    });
    const token = await inviteEmail(BOB_EMAIL, "Admin");
    await changeBobRolesInTenantA(["User"]);

    const res = await authedRaw("POST", "/api/auth/invite-accept", { token }, bobSession());

    await expectInvitationSuperseded(res);
    expect(await membershipRolesOf(bobId, TENANT_A_ID)).toEqual(["User"]);
  });

  test("invitation re-issued after a role change is accepted again", async () => {
    await seedTenantMembership(stack.db, {
      userId: bobId,
      tenantId: TENANT_A_ID,
      roles: ["Editor"],
    });
    await inviteEmail(BOB_EMAIL, "Admin");
    await changeBobRolesInTenantA(["User"]);
    const reissuedToken = await inviteEmail(BOB_EMAIL, "Admin");

    await stack.http.writeOk(AuthHandlers.inviteAccept, { token: reissuedToken }, bobSession());

    expect(await membershipRolesOf(bobId, TENANT_A_ID)).toEqual(["Admin", "User"]);
  });

  // The tenant-admin path deliberately resets even an accepted invitation:
  // re-inviting a member is how an admin hands out further roles. Only the
  // system path (waitlist provisioning) refuses accepted invitations.
  test("tenant admin re-inviting a member with an accepted invitation still grants the new role", async () => {
    const firstToken = await inviteEmail(BOB_EMAIL, "Editor");
    await stack.http.writeOk(AuthHandlers.inviteAccept, { token: firstToken }, bobSession());
    expect(await membershipRolesOf(bobId, TENANT_A_ID)).toEqual(["Editor"]);

    const reissuedToken = await inviteEmail(BOB_EMAIL, "Admin");
    await stack.http.writeOk(AuthHandlers.inviteAccept, { token: reissuedToken }, bobSession());

    expect(await membershipRolesOf(bobId, TENANT_A_ID)).toEqual(["Admin", "Editor"]);
  });
});

describe("invite-accept-with-login (Branch 2: anon + existing email)", () => {
  test("Bob (nicht eingeloggt) accepts mit email+password → JWT + membership", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Editor");

    const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: BOB_EMAIL,
      password: BOB_PASSWORD,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      isSuccess: boolean;
      tenantId: string;
      role: string;
      token?: string;
    };
    expect(body.isSuccess).toBe(true);
    expect(body.tenantId).toBe(TENANT_A_ID);
    expect(body.role).toBe("Editor");
    expect(body.token).toBeTruthy();
    const setCookies = res.headers.get("set-cookie") ?? "";
    expect(setCookies).toContain("kumiko_auth=");

    // Membership added
    const memberships = await selectMany(stack.db, tenantMembershipsTable, { userId: bobId });
    expect(memberships).toHaveLength(2);

    // fw#2333 — Bob has no stored locale, so the JWT must carry no locale
    // claim at all (not null, not "").
    const payload = await stack.jwt.verify(body.token as string);
    expect(payload.locale).toBeUndefined();
  });

  test("bare member of the inviting tenant accepts with login → membership and session carry the invited role", async () => {
    await seedTenantMembership(stack.db, { userId: bobId, tenantId: TENANT_A_ID, roles: [] });
    const token = await inviteEmail(BOB_EMAIL, "Editor");

    const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: BOB_EMAIL,
      password: BOB_PASSWORD,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { roles: string[] } };

    expect(await membershipRolesOf(bobId, TENANT_A_ID)).toEqual(["Editor"]);
    expect(body.user.roles).toContain("Editor");
  });

  test("an existing Admin invited as Editor keeps Admin (accepting never demotes)", async () => {
    await seedTenantMembership(stack.db, {
      userId: bobId,
      tenantId: TENANT_A_ID,
      roles: ["Admin"],
    });
    const token = await inviteEmail(BOB_EMAIL, "Editor");

    const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: BOB_EMAIL,
      password: BOB_PASSWORD,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { roles: string[] } };

    expect(await membershipRolesOf(bobId, TENANT_A_ID)).toEqual(["Admin", "Editor"]);
    expect(body.user.roles).toEqual(expect.arrayContaining(["Admin", "Editor"]));
  });

  test("roles changed after the invitation was issued → accept with login rejected, roles unchanged", async () => {
    await seedTenantMembership(stack.db, {
      userId: bobId,
      tenantId: TENANT_A_ID,
      roles: ["Editor"],
    });
    const token = await inviteEmail(BOB_EMAIL, "Admin");
    await changeBobRolesInTenantA(["User"]);

    const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: BOB_EMAIL,
      password: BOB_PASSWORD,
    });

    await expectInvitationSuperseded(res);
    expect(await membershipRolesOf(bobId, TENANT_A_ID)).toEqual(["User"]);
  });

  test("Bob accepts with a locale → JWT retains the locale", async () => {
    await asRawClient(stack.db).unsafe(
      `UPDATE "${userTable.tableName}" SET locale = $1 WHERE id = $2`,
      ["de-DE", bobId],
    );
    try {
      const token = await inviteEmail(BOB_EMAIL, "Editor");

      const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
        token,
        email: BOB_EMAIL,
        password: BOB_PASSWORD,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token?: string };
      expect(body.token).toBeTypeOf("string");
      if (!body.token) throw new Error("invite acceptance did not return a token");

      const payload = await stack.jwt.verify(body.token);
      expect(payload.locale).toBe("de-DE");
    } finally {
      // Bob is shared across this describe block (other tests rely on his
      // membership state persisting) — restore his locale so later tests
      // don't silently inherit it.
      await asRawClient(stack.db).unsafe(
        `UPDATE "${userTable.tableName}" SET locale = NULL WHERE id = $1`,
        [bobId],
      );
    }
  });

  test("Bob accepts with a timezone → JWT retains the timezone", async () => {
    await asRawClient(stack.db).unsafe(
      `UPDATE "${userTable.tableName}" SET timezone = $1 WHERE id = $2`,
      ["Europe/Berlin", bobId],
    );
    try {
      const token = await inviteEmail(BOB_EMAIL, "Editor");

      const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
        token,
        email: BOB_EMAIL,
        password: BOB_PASSWORD,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token?: string };
      expect(body.token).toBeTypeOf("string");
      if (!body.token) throw new Error("invite acceptance did not return a token");

      const payload = await stack.jwt.verify(body.token);
      expect(payload.timezone).toBe("Europe/Berlin");
    } finally {
      // Bob is shared across this describe block (other tests rely on his
      // membership state persisting) — restore his timezone so later tests
      // don't silently inherit it.
      await asRawClient(stack.db).unsafe(
        `UPDATE "${userTable.tableName}" SET timezone = NULL WHERE id = $1`,
        [bobId],
      );
    }
  });

  test("Wrong password → 422 invalid_credentials, invite stays acceptable", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Editor");
    const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: BOB_EMAIL,
      password: "wrong-pw-1234",
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidCredentials);

    // Token was released on failure (existing finally/unburn) — the same
    // invite must still be acceptable with the correct password.
    const retryRes = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: BOB_EMAIL,
      password: BOB_PASSWORD,
    });
    expect(retryRes.status).toBe(200);
  });

  test("common password → 400 (schema rejects breach-list password) (#1340)", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Editor");
    const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: BOB_EMAIL,
      password: "password1",
    });
    expect(res.status).toBe(400);
    // A 400 for a completely different reason (bad token format, email
    // shape) would also pass a bare status assertion — pin the field-level
    // reason so the test actually proves the breach-list rejection fired.
    const body = (await res.json()) as {
      error?: { details?: { fields?: ReadonlyArray<{ path?: string; code?: string }> } };
    };
    expect(body.error?.details?.fields).toContainEqual(
      expect.objectContaining({ path: "password", code: "custom" }),
    );
  });
});

describe("invite-signup-complete (Branch 3: anon + new email)", () => {
  test("Carol (no account) accepts → user + membership entstehen, JWT", async () => {
    const token = await inviteEmail(CAROL_EMAIL, "Admin");

    const res = await stack.http.raw("POST", "/api/auth/invite-signup-complete", {
      token,
      password: CAROL_PASSWORD,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      isSuccess: boolean;
      user: { id: string };
      tenantId: string;
      role: string;
    };
    expect(body.isSuccess).toBe(true);
    expect(body.tenantId).toBe(TENANT_A_ID);
    expect(body.role).toBe("Admin");

    // Carol entstanden in users
    const carolRows = await selectMany(stack.db, userTable, { email: CAROL_EMAIL });
    expect(carolRows).toHaveLength(1);
    expect(carolRows[0]?.["emailVerified"]).toBe(true);
    expect(carolRows[0]?.["id"]).toBe(body.user.id);

    // Login funktioniert
    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: CAROL_EMAIL,
      password: CAROL_PASSWORD,
    });
    expect(loginRes.status).toBe(200);
  });

  test("a registration request with X-Locale stores the locale and the first JWT carries it", async () => {
    const token = await inviteEmail("dora-locale@example.com", "Admin");

    const res = await stack.http.raw(
      "POST",
      "/api/auth/invite-signup-complete",
      { token, password: CAROL_PASSWORD },
      { "x-locale": "de-DE" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };

    const payload = await stack.jwt.verify(body.token);
    expect(payload.locale).toBe("de-DE");
    const rows = await selectMany(stack.db, userTable, { email: "dora-locale@example.com" });
    expect(rows[0]?.["locale"]).toBe("de-DE");
  });

  test("common password → 400 (schema rejects breach-list password) (#1340)", async () => {
    const token = await inviteEmail(CAROL_EMAIL, "Editor");
    const res = await stack.http.raw("POST", "/api/auth/invite-signup-complete", {
      token,
      password: "password1",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error?: { details?: { fields?: ReadonlyArray<{ path?: string; code?: string }> } };
    };
    expect(body.error?.details?.fields).toContainEqual(
      expect.objectContaining({ path: "password", code: "custom" }),
    );
  });

  test("Existing email → invalid_invite_token (User soll Branch 2 nutzen)", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Admin");

    const res = await stack.http.raw("POST", "/api/auth/invite-signup-complete", {
      token,
      password: "new-pw-1234",
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidInviteToken);

    // Bob hat keine zweite Membership erworben
    const memberships = await selectMany(stack.db, tenantMembershipsTable, { userId: bobId });
    expect(memberships).toHaveLength(1);
    void GUEST;
  });
});

describe("invite-info (anonymous, read-only lookup)", () => {
  test("open invite for an existing account → {email, hasAccount:true}, token stays acceptable afterwards", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Editor");

    const res = await stack.http.raw("POST", "/api/auth/invite-info", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email?: string; hasAccount?: boolean };
    expect(body.email).toBe(BOB_EMAIL);
    expect(body.hasAccount).toBe(true);

    // Token was never consumed — the same invite can still be accepted.
    const acceptRes = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: BOB_EMAIL,
      password: BOB_PASSWORD,
    });
    expect(acceptRes.status).toBe(200);
  });

  test("open invite for a new email → hasAccount:false", async () => {
    const token = await inviteEmail(CAROL_EMAIL, "Admin");

    const res = await stack.http.raw("POST", "/api/auth/invite-info", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email?: string; hasAccount?: boolean };
    expect(body.email).toBe(CAROL_EMAIL);
    expect(body.hasAccount).toBe(false);
  });

  test("unknown token → 422 invalid_invite_token", async () => {
    const res = await stack.http.raw("POST", "/api/auth/invite-info", {
      token: "not-a-real-token",
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidInviteToken);
  });

  test("error body has the same shape as the write routes' — invalid_invite_token sits at error.details.reason on both", async () => {
    const infoRes = await stack.http.raw("POST", "/api/auth/invite-info", {
      token: "not-a-real-token",
    });
    const writeRes = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token: "not-a-real-token",
      email: BOB_EMAIL,
      password: BOB_PASSWORD,
    });
    expect(infoRes.status).toBe(422);
    expect(writeRes.status).toBe(422);
    type ErrorBody = {
      isSuccess?: boolean;
      error?: {
        code?: string;
        httpStatus?: number;
        i18nKey?: string;
        details?: { reason?: string };
      };
    };
    const infoBody = (await infoRes.json()) as ErrorBody;
    const writeBody = (await writeRes.json()) as ErrorBody;
    expect(Object.keys(infoBody).sort()).toEqual(Object.keys(writeBody).sort());
    expect(Object.keys(infoBody.error ?? {}).sort()).toEqual(
      Object.keys(writeBody.error ?? {}).sort(),
    );
    expect(infoBody.error?.details?.reason).toBe(AuthErrors.invalidInviteToken);
    expect(writeBody.error?.details?.reason).toBe(AuthErrors.invalidInviteToken);
  });

  test("already-accepted invitation → 422 invalid_invite_token", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Editor");
    const acceptRes = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: BOB_EMAIL,
      password: BOB_PASSWORD,
    });
    expect(acceptRes.status).toBe(200);

    const res = await stack.http.raw("POST", "/api/auth/invite-info", { token });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidInviteToken);
  });

  test("token in the query string instead of the body → invalid_body", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Editor");
    const res = await stack.http.raw(
      "POST",
      `/api/auth/invite-info?token=${encodeURIComponent(token)}`,
      {},
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("invalid_body");
  });

  test("rate limit: the 21st call in a window is rejected with 429", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Editor");
    for (let i = 0; i < 20; i++) {
      const res = await stack.http.raw("POST", "/api/auth/invite-info", { token });
      expect(res.status).toBe(200);
    }
    const limited = await stack.http.raw("POST", "/api/auth/invite-info", { token });
    expect(limited.status).toBe(429);
  });
});

describe("invite-accept defense-in-depth (assertAssignableMembershipRoles)", () => {
  test("a forbidden role planted directly on the invitation row (bug/migration) is rejected, not silently granted", async () => {
    // Simulates the ONE scenario this depth-layer exists for: a forbidden role
    // reaching the invitation row through some path OTHER than invite-create
    // (which already validates at request time — see "privilege escalation"
    // below). A DB migration or direct write is the only realistic vector.
    const fakeInvitationId = crypto.randomUUID();
    await seedRow(stack.db, tenantInvitationsTable, {
      id: fakeInvitationId,
      tenantId: TENANT_A_ID,
      email: BOB_EMAIL,
      role: "SystemAdmin",
      status: INVITATION_STATUS.pending,
      invitedBy: aliceId,
      expiresAt: "2030-01-01T00:00:00Z",
    });
    const token = crypto.randomUUID();
    await storeInviteToken(stack.redis.redis, {
      invitationId: fakeInvitationId,
      token,
      ttlSeconds: 3600,
    });

    const res = await authedRaw("POST", "/api/auth/invite-accept", { token }, bobSession());
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("access_denied");

    // No membership was granted.
    const memberships = await selectMany(stack.db, tenantMembershipsTable, { userId: bobId });
    expect(memberships).toHaveLength(1); // only the seeded Tenant-B membership
  });
});

describe("invite-accept-with-login/signup-complete defense-in-depth (637/1)", () => {
  // The already-member path writes the invitation role too, so it needs the
  // create path's reserved-role guard, not just the session-mint strip.
  test("invite-accept-with-login: already-member path rejects a forbidden invitation role and leaves the membership untouched", async () => {
    await seedTenantMembership(stack.db, {
      userId: bobId,
      tenantId: TENANT_A_ID,
      roles: ["User"],
    });

    // Create through the real command (valid role → real stream + version),
    // then corrupt the row directly — the migration/DB-surgery scenario this
    // depth-layer guards against, same framing as the Branch-1 test above.
    const token = await inviteEmail(BOB_EMAIL, "Admin");
    await asRawClient(stack.db).unsafe(
      `UPDATE "${tenantInvitationsTable.tableName}" SET "role" = 'SystemAdmin' WHERE "email" = $1`,
      [BOB_EMAIL],
    );

    const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: BOB_EMAIL,
      password: BOB_PASSWORD,
    });
    expect(res.status).toBe(403);
    expect(await membershipRolesOf(bobId, TENANT_A_ID)).toEqual(["User"]);
  });

  test("invite-signup-complete: a brand-new user always hits seedTenantMembership's guard — forbidden role rejected, not silently stripped", async () => {
    // Unlike Branch 2, a brand-new user can never be "already a member" —
    // seedTenantMembership (and its assertAssignableMembershipRoles guard)
    // runs unconditionally. Pins that this branch is NOT exposed to the
    // Branch-2 gap, so a future refactor that adds an alreadyMember-style
    // skip here would be caught immediately.
    const daveEmail = "dave@example.com";
    const token = await inviteEmail(daveEmail, "Admin");
    await asRawClient(stack.db).unsafe(
      `UPDATE "${tenantInvitationsTable.tableName}" SET "role" = 'SystemAdmin' WHERE "email" = $1`,
      [daveEmail],
    );

    const res = await stack.http.raw("POST", "/api/auth/invite-signup-complete", {
      token,
      password: "dave-new-pw-1234",
    });
    expect(res.status).toBe(403);

    // No user or membership was created — the whole write rolled back.
    const daveRows = await selectMany(stack.db, userTable, { email: daveEmail });
    expect(daveRows).toHaveLength(0);
  });
});

describe("Single-Use-Burn (alle Branches)", () => {
  test("Branch 1: zweiter accept mit gleichem Token → invalid", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Admin");
    await stack.http.writeOk(AuthHandlers.inviteAccept, { token }, bobSession());

    const res = await authedRaw("POST", "/api/auth/invite-accept", { token }, bobSession());
    expect(res.status).toBe(422);
  });
});

describe("remove-member cancels the removed member's open invitations", () => {
  async function removeBobFromTenantA(): Promise<void> {
    await stack.http.writeOk(
      TenantHandlers.removeMember,
      { userId: bobId, tenantId: TENANT_A_ID },
      { id: "system-admin", tenantId: TENANT_A_ID, roles: ["SystemAdmin"] },
    );
  }

  async function invitationStatusOf(email: string): Promise<unknown> {
    const [row] = await selectMany(stack.db, tenantInvitationsTable, {
      email,
      tenantId: TENANT_A_ID,
    });
    return row?.["status"];
  }

  test("removed member cannot rejoin via an invitation issued before removal", async () => {
    await seedTenantMembership(stack.db, {
      userId: bobId,
      tenantId: TENANT_A_ID,
      roles: ["Editor"],
    });
    const token = await inviteEmail(BOB_EMAIL, "Admin");

    await removeBobFromTenantA();

    const res = await authedRaw("POST", "/api/auth/invite-accept", { token }, bobSession());
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidInviteToken);
    expect(await invitationStatusOf(BOB_EMAIL)).toBe(INVITATION_STATUS.cancelled);
    const memberships = await selectMany(stack.db, tenantMembershipsTable, {
      userId: bobId,
      tenantId: TENANT_A_ID,
    });
    expect(memberships).toHaveLength(0);
  });

  test("invitations to other emails stay pending", async () => {
    await seedTenantMembership(stack.db, {
      userId: bobId,
      tenantId: TENANT_A_ID,
      roles: ["Editor"],
    });
    await inviteEmail(CAROL_EMAIL, "Editor");

    await removeBobFromTenantA();

    expect(await invitationStatusOf(CAROL_EMAIL)).toBe(INVITATION_STATUS.pending);
  });
});

describe("cancel-invitation", () => {
  test("Admin cancellt → status=cancelled + token weg, accept wird invalid", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Admin");

    // Find invitationId
    const rows = await selectMany(stack.db, tenantInvitationsTable, { email: BOB_EMAIL });
    const invitationId = rows[0]?.["id"] as string;

    await stack.http.writeOk("tenant:write:cancel-invitation", { invitationId }, aliceSession());

    const updated = await selectMany(stack.db, tenantInvitationsTable, { id: invitationId });
    expect(updated[0]?.["status"]).toBe("cancelled");

    // Accept mit dem gecancelten Token → invalid
    const res = await authedRaw("POST", "/api/auth/invite-accept", { token }, bobSession());
    expect(res.status).toBe(422);
  });
});

describe("invitations-query (pending list)", () => {
  test("Admin sieht nur pending invitations", async () => {
    await inviteEmail(BOB_EMAIL, "Admin");
    await inviteEmail(CAROL_EMAIL, "Editor");

    // Cancel das erste
    const allRows = await selectMany(stack.db, tenantInvitationsTable);
    const bobInv = allRows.find((r) => r["email"] === BOB_EMAIL);
    if (!bobInv) throw new Error("bob invitation missing");
    await stack.http.writeOk(
      "tenant:write:cancel-invitation",
      { invitationId: bobInv["id"] },
      aliceSession(),
    );

    const list = (await stack.http.queryOk(
      "tenant:query:invitations",
      {},
      aliceSession(),
    )) as Array<{ email: string; status: string }>;
    expect(list).toHaveLength(1);
    expect(list[0]?.email).toBe(CAROL_EMAIL);
    expect(list[0]?.status).toBe("pending");
  });
});

// Privilege-escalation regression: a Tenant-Admin must not be able to seed a
// platform-global/reserved role (SystemAdmin, system, all, anonymous) into a
// tenant membership via the invite flow — once it lands in membership.roles it
// merges flat into the session and unlocks the SystemAdmin-gated cross-tenant
// handler surface (hasAccess can't tell membership roles from global ones).
describe("privilege escalation via invite role", () => {
  // Reserved / global roles: must NEVER reach a tenant invitation. hasAccess
  // is flat, so a tenant-member invite for SystemAdmin would escalate on
  // login/switch without any cross-tenant check.
  const FORBIDDEN_ROLES = ["SystemAdmin", "system", "all", "anonymous"];

  test("invite-create rejects reserved/global roles — no invitation persisted, no mail", async () => {
    for (const role of FORBIDDEN_ROLES) {
      const err = await stack.http.writeErr(
        AuthHandlers.inviteCreate,
        { email: CAROL_EMAIL, role },
        aliceSession(),
      );
      expect(err.details).toMatchObject({ reason: "reserved_membership_role", role });
      const rows = await selectMany(stack.db, tenantInvitationsTable, { email: CAROL_EMAIL });
      expect(rows).toHaveLength(0);
      expect(emailTransport.sent).toHaveLength(0);
    }
  });

  test("legitimate tenant role still issues an invitation", async () => {
    const result = (await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: CAROL_EMAIL, role: "Admin" },
      aliceSession(),
    )) as { role: string };
    expect(result.role).toBe("Admin");
  });

  test("TenantAdmin can invite TenantAdmin, Admin, Editor, and User", async () => {
    const tenantAdminSession: SessionUser = {
      id: aliceId,
      tenantId: TENANT_A_ID,
      roles: ["TenantAdmin"],
    };
    for (const role of ["TenantAdmin", "Admin", "Editor", "User"]) {
      const email = `target-${role.toLowerCase()}@example.com`;
      const result = (await stack.http.writeOk(
        AuthHandlers.inviteCreate,
        { email, role },
        tenantAdminSession,
      )) as { role: string };
      expect(result.role).toBe(role);
    }
  });

  test("app roles declared via EXT_ASSIGNABLE_ROLE follow their assignableFrom", async () => {
    const result = (await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "property-manager@example.com", role: "PropertyManager" },
      aliceSession(), // roles: ["Admin"]
    )) as { role: string };
    expect(result.role).toBe("PropertyManager");

    const err = await stack.http.writeErr(
      AuthHandlers.inviteCreate,
      { email: "auditor@example.com", role: "Auditor" },
      aliceSession(),
    );
    expect(err.details).toMatchObject({ reason: "unassignable_membership_role", role: "Auditor" });

    const undeclared = await stack.http.writeErr(
      AuthHandlers.inviteCreate,
      { email: "undeclared@example.com", role: "Undeclared" },
      aliceSession(),
    );
    expect(undeclared.details).toMatchObject({ reason: "unassignable_membership_role" });
  });

  test("Admin cannot invite TenantAdmin (elevation guard default)", async () => {
    const err = await stack.http.writeErr(
      AuthHandlers.inviteCreate,
      { email: "elevate-target@example.com", role: "TenantAdmin" },
      aliceSession(), // roles: ["Admin"]
    );
    expect(err.details).toMatchObject({
      reason: "unassignable_membership_role",
      role: "TenantAdmin",
    });
    const rows = await selectMany(stack.db, tenantInvitationsTable, {
      email: "elevate-target@example.com",
    });
    expect(rows).toHaveLength(0);
    expect(emailTransport.sent).toHaveLength(0);
  });

  test("TenantAdmin cannot invite SystemAdmin (rejected by reserved role guard)", async () => {
    const tenantAdminSession: SessionUser = {
      id: aliceId,
      tenantId: TENANT_A_ID,
      roles: ["TenantAdmin"],
    };
    const err = await stack.http.writeErr(
      AuthHandlers.inviteCreate,
      { email: "sysadmin-target@example.com", role: "SystemAdmin" },
      tenantAdminSession,
    );
    expect(err.details).toMatchObject({
      reason: "reserved_membership_role",
      role: "SystemAdmin",
    });
    const rows = await selectMany(stack.db, tenantInvitationsTable, {
      email: "sysadmin-target@example.com",
    });
    expect(rows).toHaveLength(0);
  });

  test("rejects unknown/unranked roles fail-closed", async () => {
    const err = await stack.http.writeErr(
      AuthHandlers.inviteCreate,
      { email: "unknown-role@example.com", role: "CustomRole" },
      aliceSession(),
    );
    expect(err.details).toMatchObject({
      reason: "unassignable_membership_role",
      role: "CustomRole",
    });
  });
});

// canAssignRole further restricts ranked roles after the default elevation
// guard — a separate stack mounts the invite feature WITH the hook.
describe("invite-create role-hierarchy gate (opt-in canAssignRole)", () => {
  let gateStack: TestStack;
  let gateAliceId: string;
  let gateTenantId: TenantId;
  const gateTransport = createInMemoryTransport();

  function gateAliceSession(roles: readonly string[] = ["TenantAdmin"]): SessionUser {
    return { id: gateAliceId, tenantId: gateTenantId, roles: [...roles] };
  }

  beforeAll(async () => {
    gateStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createTemplateResolverFeature(),
        createRendererFoundationFeature(),
        createDeliveryFeature(),
        createRendererSimpleFeature(),
        createChannelEmailFeature({
          transport: gateTransport,
          renderer: simpleRenderer,
          resolveEmail: async () => "unused@test.local",
        }),
        createAuthEmailPasswordFeature({
          invite: {
            tokenTtlMinutes: 60,
            appUrl: APP_ACCEPT_URL,
            // Custom app policy: only TenantAdmin with special flag may grant "Admin"
            canAssignRole: (inviterRoles, targetRole) =>
              targetRole !== "Admin" || inviterRoles.includes("SpecialAdmin"),
          },
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

    await unsafeCreateEntityTable(gateStack.db, userEntity);
    await unsafeCreateEntityTable(gateStack.db, tenantEntity);
    await unsafeCreateEntityTable(gateStack.db, tenantInvitationEntity);
    await unsafePushTables(gateStack.db, {
      configValuesTable,
      tenantMembershipsTable,
      notificationPreferencesTable,
    });

    gateTenantId = newTenantId("gate");
    await seedTenant(gateStack.db, {
      id: gateTenantId,
      key: `tenant-gate-${gateTenantId.slice(0, 8)}`,
      name: "Tenant Gate",
    });
    ({ id: gateAliceId } = await seedUser(gateStack.db, {
      email: "gate-alice@example.com",
      displayName: "Gate Alice",
      passwordHash: await hashPassword("gate-alice-pw-1234"),
      emailVerified: true,
    }));
    await seedTenantMembership(gateStack.db, {
      userId: gateAliceId,
      tenantId: gateTenantId,
      roles: ["TenantAdmin"],
    });
  });

  afterAll(async () => {
    await gateStack.cleanup();
  });

  test("canAssignRole → false blocks invite-create with a role-hierarchy error, no invitation persisted", async () => {
    // TenantAdmin clears the handler's own access.admin gate and default elevation
    // guard for "Admin", but canAssignRole blocks "Admin" because Alice lacks "SpecialAdmin".
    const err = await gateStack.http.writeErr(
      AuthHandlers.inviteCreate,
      { email: "blocked-target@example.com", role: "Admin" },
      gateAliceSession(),
    );
    expect(err.details).toMatchObject({ reason: "unassignable_membership_role", role: "Admin" });
    const rows = await selectMany(gateStack.db, tenantInvitationsTable, {
      email: "blocked-target@example.com",
    });
    expect(rows).toHaveLength(0);
    expect(gateTransport.sent).toHaveLength(0);
  });

  test("canAssignRole → true allows invite-create through", async () => {
    // Elevation alone would allow TenantAdmin → Admin; hook requires SpecialAdmin.
    const result = (await gateStack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: "allowed-target@example.com", role: "Admin" },
      gateAliceSession(["TenantAdmin", "SpecialAdmin"]),
    )) as { role: string };
    expect(result.role).toBe("Admin");
  });
});
