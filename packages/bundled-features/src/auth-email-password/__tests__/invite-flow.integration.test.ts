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
  createSystemUser,
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
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery";
import { notificationPreferencesTable } from "../../delivery/tables";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple";
import { createTemplateResolverFeature } from "../../template-resolver/feature";
import { createTenantFeature } from "../../tenant";
import { tenantInvitationEntity, tenantInvitationsTable } from "../../tenant/invitation-table";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { seedTenant, seedTenantMembership } from "../../tenant/seeding";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthErrors, AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";
import { hashPassword } from "../password-hashing";
import { seedUser } from "../seeding";

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

const GUEST: SessionUser = {
  id: "00000000-0000-0000-0000-000000000000",
  tenantId: SYSTEM_TENANT_ID,
  roles: ["all"],
};

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
      createTenantFeature(),
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
  const allKeys = await stack.redis.redis.keys("invite:*");
  if (allKeys.length > 0) await stack.redis.redis.del(...allKeys);

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

  test("Resend: zweiter invite für selbe email → existing row updated, gleicher token", async () => {
    const firstToken = await inviteEmail(BOB_EMAIL, "Admin");
    const secondToken = await inviteEmail(BOB_EMAIL, "Editor");

    expect(secondToken).toBe(firstToken);

    // Eine Row, role updated
    const rows = await selectMany(stack.db, tenantInvitationsTable, { email: BOB_EMAIL });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["role"]).toBe("Editor");
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

  test("Already-Member: Bob ist schon Member → idempotent no-op + alreadyMember=true", async () => {
    // Bob direkt zu Tenant-A hinzufügen
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
  });

  test("Wrong password → 422 invalid_invite_token (anti-enum)", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Editor");
    const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: BOB_EMAIL,
      password: "wrong-pw-1234",
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error?: { details?: { reason?: string } } };
    expect(body.error?.details?.reason).toBe(AuthErrors.invalidInviteToken);
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

describe("Single-Use-Burn (alle Branches)", () => {
  test("Branch 1: zweiter accept mit gleichem Token → invalid", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Admin");
    await stack.http.writeOk(AuthHandlers.inviteAccept, { token }, bobSession());

    const res = await authedRaw("POST", "/api/auth/invite-accept", { token }, bobSession());
    expect(res.status).toBe(422);
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
  // Each forbidden value is a platform-global/reserved role that must never
  // reach a tenant membership. Proven exploitable before the fix: inviting
  // "SystemAdmin" gave the invitee a JWT carrying SystemAdmin flat, which
  // passed every SystemAdmin gate cross-tenant.
  const FORBIDDEN_ROLES = ["SystemAdmin", "system", "all", "anonymous"];

  test("invite-create rejects reserved/global roles — no invitation persisted, no mail", async () => {
    for (const role of FORBIDDEN_ROLES) {
      const err = await stack.http.writeErr(
        AuthHandlers.inviteCreate,
        { email: CAROL_EMAIL, role },
        aliceSession(),
      );
      expect(err.code).toBe("access_denied");
      const rows = await selectMany(stack.db, tenantInvitationsTable, { email: CAROL_EMAIL });
      expect(rows).toHaveLength(0);
    }
    // The forbidden-role check fires before the mail dispatch.
    expect(emailTransport.sent).toHaveLength(0);
  });

  test("legitimate tenant role still issues an invitation", async () => {
    const result = (await stack.http.writeOk(
      AuthHandlers.inviteCreate,
      { email: CAROL_EMAIL, role: "Editor" },
      aliceSession(),
    )) as { role: string };
    expect(result.role).toBe("Editor");
  });
});
