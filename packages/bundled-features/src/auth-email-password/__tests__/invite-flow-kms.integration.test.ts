// Auth-Flows mit aktivem PII-KMS + Blind-Index (#818 PR 2): user.email und
// invitation.email liegen als Ciphertext in der DB. Login und alle drei
// Invite-Accept-Branches müssen über die generierte email_bidx-Spalte
// (Equality-Lookup) bzw. decryptStoredEmail (Vergleich/Weiterverwendung)
// unverändert funktionieren — vor diesem PR war jeder dieser Pfade mit
// KMS silently broken.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configureBlindIndexKey,
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-framework/testing";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email";
import { createConfigFeature } from "../../config";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery";
import { notificationPreferencesTable } from "../../delivery/tables";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple";
import { decryptStoredPii, hashPassword } from "../../shared";
import { createTemplateResolverFeature } from "../../template-resolver/feature";
import { createTenantFeature } from "../../tenant";
import { tenantInvitationEntity, tenantInvitationsTable } from "../../tenant/invitation-table";
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant";
import { seedTenant, seedTenantMembership } from "../../tenant/seeding";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { tenantInvitationDeleteHook } from "../../user-data-rights-defaults";
import { AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";
import { seedUser } from "../seeding";

const APP_ACCEPT_URL = "https://app.example.com/invite/accept";
const BOB_EMAIL = "bob.kms@example.com";
const BOB_PASSWORD = "bob-existing-pw-1234";
const CAROL_EMAIL = "carol.kms@example.com";
const CAROL_PASSWORD = "carol-new-pw-1234";
const BIDX_KEY = Buffer.alloc(32, 7).toString("base64");

const emailTransport = createInMemoryTransport();

let stack: TestStack;
let kms: InMemoryKmsAdapter;
let aliceId: string;
let bobId: string;
let TENANT_A_ID: TenantId;
let TENANT_B_ID: TenantId;

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
  // KMS + bidx-Key MUESSEN vor den Seeds stehen — seedUser läuft über den
  // Executor, die Rows sollen den verschlüsselten Prod-Zustand abbilden.
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
  configureBlindIndexKey(BIDX_KEY);

  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantInvitationsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantTable.tableName}"`);
  emailTransport.sent.length = 0;
  const allKeys = await stack.redis.redis.keys("invite:*");
  if (allKeys.length > 0) await stack.redis.redis.del(...allKeys);

  TENANT_A_ID = crypto.randomUUID() as TenantId;
  TENANT_B_ID = crypto.randomUUID() as TenantId;
  await seedTenant(stack.db, {
    id: TENANT_A_ID,
    key: `kms-a-${TENANT_A_ID.slice(0, 8)}`,
    name: "KMS Tenant A",
  });
  await seedTenant(stack.db, {
    id: TENANT_B_ID,
    key: `kms-b-${TENANT_B_ID.slice(0, 8)}`,
    name: "KMS Tenant B",
  });

  ({ id: aliceId } = await seedUser(stack.db, {
    email: "alice.kms@example.com",
    displayName: "Alice",
    passwordHash: await hashPassword("alice-pw-1234"),
    emailVerified: true,
  }));
  await seedTenantMembership(stack.db, {
    userId: aliceId,
    tenantId: TENANT_A_ID,
    roles: ["Admin"],
  });

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

afterEach(() => {
  resetPiiSubjectKmsForTests();
  resetBlindIndexKeyForTests();
});

function aliceSession(): SessionUser {
  return { id: aliceId, tenantId: TENANT_A_ID, roles: ["Admin"] };
}

function bobSession(): SessionUser {
  return { id: bobId, tenantId: TENANT_B_ID, roles: ["User"] };
}

async function inviteEmail(email: string, role: string): Promise<string> {
  await stack.http.writeOk(AuthHandlers.inviteCreate, { email, role }, aliceSession());
  const sent = emailTransport.sent.at(-1);
  if (!sent) throw new Error("invite-create didn't send a mail");
  return extractTokenFromMail(sent.html);
}

async function rawUserRow(id: string): Promise<Record<string, unknown>> {
  const rows = await asRawClient(stack.db).unsafe<Record<string, unknown>>(
    `SELECT * FROM "${userTable.tableName}" WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw new Error(`no user row for ${id}`);
  return row;
}

describe("auth flows with active KMS + blind index", () => {
  test("seeded user row: ciphertext email + populated bidx column", async () => {
    const row = await rawUserRow(bobId);
    expect(isPiiCiphertext(row["email"])).toBe(true);
    expect(String(row["email_bidx"])).toStartWith("kumiko-bidx:v1:");
  });

  test("login with plaintext email finds the encrypted row via bidx", async () => {
    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: BOB_EMAIL,
      password: BOB_PASSWORD,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuccess: boolean; token?: string };
    expect(body.isSuccess).toBe(true);
    expect(body.token).toBeTruthy();
  });

  test("Branch 1: logged-in accept matches emails across two ciphertexts", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Editor");

    const invitations = await selectMany(stack.db, tenantInvitationsTable, { email: BOB_EMAIL });
    expect(invitations).toHaveLength(1);

    const result = (await stack.http.writeOk(
      AuthHandlers.inviteAccept,
      { token },
      bobSession(),
    )) as {
      tenantId: string;
      alreadyMember: boolean;
    };
    expect(result.tenantId).toBe(TENANT_A_ID);
    expect(result.alreadyMember).toBe(false);
  });

  test("Branch 2: invite-accept-with-login (anon + password)", async () => {
    const token = await inviteEmail(BOB_EMAIL, "Editor");

    const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: BOB_EMAIL,
      password: BOB_PASSWORD,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuccess: boolean; tenantId: string };
    expect(body.isSuccess).toBe(true);
    expect(body.tenantId).toBe(TENANT_A_ID);

    const memberships = await selectMany(stack.db, tenantMembershipsTable, { userId: bobId });
    expect(memberships).toHaveLength(2);
  });

  test("Branch 3: invite-signup-complete creates the user from the DECRYPTED invitation email", async () => {
    const token = await inviteEmail(CAROL_EMAIL, "Admin");

    const res = await stack.http.raw("POST", "/api/auth/invite-signup-complete", {
      token,
      password: CAROL_PASSWORD,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isSuccess: boolean; user: { id: string } };
    expect(body.isSuccess).toBe(true);

    // Carol-Row: eigener user-Subject-Ciphertext (nicht der invitation-
    // Ciphertext durchgereicht) + Klartext-abgeleiteter displayName.
    const row = await rawUserRow(body.user.id);
    expect(isPiiCiphertext(row["email"])).toBe(true);
    expect(String(row["email"])).toContain(body.user.id);
    const decrypted = await decryptPiiFieldValues(
      { displayName: row["display_name"] },
      ["displayName"],
      kms,
      { requestId: "test" },
    );
    expect(decrypted["displayName"]).toBe("carol.kms");

    const loginRes = await stack.http.raw("POST", "/api/auth/login", {
      email: CAROL_EMAIL,
      password: CAROL_PASSWORD,
    });
    expect(loginRes.status).toBe(200);
  });

  test("tenant:query:invitations decrypts the invited email under active KMS (#1931)", async () => {
    await inviteEmail(CAROL_EMAIL, "Editor");

    const list = (await stack.http.queryOk(
      "tenant:query:invitations",
      {},
      aliceSession(),
    )) as Array<{ email: string; invitedBy: string; status: string }>;

    expect(list).toHaveLength(1);
    expect(isPiiCiphertext(list[0]?.email)).toBe(false);
    expect(list[0]?.email).toBe(CAROL_EMAIL);
    expect(isPiiCiphertext(list[0]?.invitedBy)).toBe(false);
    expect(list[0]?.invitedBy).toBe(aliceId);
  });

  // fw-review #7: the inviter-forget arm compared a plaintext userId against
  // the encrypted `invitedBy` column via selectMany's equality filter — with
  // no lookupable/blind-index column on `invitedBy`, that filter matched
  // zero rows under active KMS, so Alice's Art.17 forget never anonymized
  // rows for invitations she sent. Fixed by loading the tenant's invitations
  // and decrypting `invitedBy` per row for comparison instead.
  test("Art.17 forget anonymizes invitedBy for an invite the requester sent, even under active KMS", async () => {
    await inviteEmail(CAROL_EMAIL, "Editor");

    const [rawBefore] = await asRawClient(stack.db).unsafe<Record<string, unknown>>(
      `SELECT * FROM "${tenantInvitationsTable.tableName}" WHERE tenant_id = $1`,
      [TENANT_A_ID],
    );
    if (!rawBefore) throw new Error("no invitation row seeded");
    expect(isPiiCiphertext(rawBefore["invited_by"])).toBe(true);

    await tenantInvitationDeleteHook(
      { db: stack.db, registry: stack.registry, tenantId: TENANT_A_ID, userId: aliceId },
      "delete",
    );

    const [rawAfter] = await asRawClient(stack.db).unsafe<Record<string, unknown>>(
      `SELECT * FROM "${tenantInvitationsTable.tableName}" WHERE tenant_id = $1`,
      [TENANT_A_ID],
    );
    if (!rawAfter)
      throw new Error("invitation row disappeared — inviter-forget only severs the link");
    // The invitee link is untouched — this row belongs to Carol, not Alice.
    expect(isPiiCiphertext(rawAfter["email"])).toBe(true);
    // invitedBy is re-encrypted on write, so assert on the decrypted value —
    // the sentinel itself lives as INVITED_BY_ANONYMIZED in the hook file.
    expect(isPiiCiphertext(rawAfter["invited_by"])).toBe(true);
    const decryptedInvitedBy = await decryptStoredPii(
      String(rawAfter["invited_by"]),
      "invitedBy",
      "test",
    );
    expect(decryptedInvitedBy).toBe("anonymized");
    expect(decryptedInvitedBy).not.toBe(aliceId);
  });
});
