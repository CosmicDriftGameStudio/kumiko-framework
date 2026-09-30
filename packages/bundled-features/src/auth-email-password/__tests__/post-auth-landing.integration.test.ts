// auth.postAuthLanding full-stack integration: login, signup-confirm, and
// the invite-accept branches all consult the SAME resolver and thread the
// same args through the real HTTP routes — plus the open-redirect / throw
// protections from post-auth-landing.ts, proven through the wire instead of
// just at the unit level.
//
// currentResolver is a module-local mutable slot behind one thin
// authConfig.postAuthLanding indirection — beforeEach resets it to an
// offlot-artige default rule; individual tests override it to capture args
// or exercise the safety rails.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type {
  PostAuthLandingArgs,
  PostAuthLandingResolver,
} from "@cosmicdrift/kumiko-framework/api";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import type { SessionUser, TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
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
import { createTenantFeature } from "../../tenant/index.js";
import { tenantInvitationEntity, tenantInvitationsTable } from "../../tenant/invitation-table.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.js";
import { seedTenant, seedTenantMembership } from "../../tenant/seeding.js";
import { createUserFeature } from "../../user/feature.js";
import { userEntity, userTable } from "../../user/schema/user.js";
import { AuthHandlers } from "../constants.js";
import { createAuthEmailPasswordFeature } from "../feature.js";
import { seedUser } from "../seeding.js";

const APP_ACTIVATION_URL = "https://app.example.com/signup/complete";
const APP_ACCEPT_URL = "https://app.example.com/invite/accept";

const emailTransport = createInMemoryTransport();

let stack: TestStack;

// offlot-style default rule: invite routes by the inviting tenant (not the
// role); otherwise the highest role wins.
function defaultResolver(args: PostAuthLandingArgs): string | undefined {
  if (args.flow === "invite") return `/a/invited/${args.tenantId}`;
  if (args.roles.includes("SystemAdmin")) return "/a/waitlist-list";
  if (args.roles.includes("TenantAdmin") || args.roles.includes("Admin"))
    return "/a/vehicle-create";
  return "/a/profile";
}

let currentResolver: PostAuthLandingResolver = defaultResolver;

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
        signup: { tokenTtlMinutes: 60, appUrl: APP_ACTIVATION_URL },
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
      signup: {
        requestHandler: AuthHandlers.signupRequest,
        confirmHandler: AuthHandlers.signupConfirm,
      },
      invite: {
        acceptHandler: AuthHandlers.inviteAccept,
        acceptWithLoginHandler: AuthHandlers.inviteAcceptWithLogin,
        signupCompleteHandler: AuthHandlers.inviteSignupComplete,
      },
      postAuthLanding: (args) => currentResolver(args),
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
  currentResolver = defaultResolver;
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantMembershipsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantInvitationsTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantTable.tableName}"`);
  emailTransport.sent.length = 0;
  const signupKeys = await stack.redis.redis.keys("signup:*");
  if (signupKeys.length > 0) await stack.redis.redis.del(...signupKeys);
  const inviteKeys = await stack.redis.redis.keys("invite:*");
  if (inviteKeys.length > 0) await stack.redis.redis.del(...inviteKeys);
});

function newTenantId(): TenantId {
  return crypto.randomUUID() as TenantId;
}

async function postLogin(email: string, password: string): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/login", { email, password });
}

async function seedTenantAdmin(
  email: string,
  password: string,
  roles: readonly string[],
): Promise<TenantId> {
  const tenantId = newTenantId();
  await seedTenant(stack.db, { id: tenantId, key: `tenant-${tenantId.slice(0, 8)}`, name: "T" });
  const { id: userId } = await seedUser(stack.db, {
    email,
    displayName: "Landing Test User",
    passwordHash: await hashPassword(password),
    emailVerified: true,
  });
  await seedTenantMembership(stack.db, { userId, tenantId, roles: [...roles] });
  return tenantId;
}

function extractTokenFromMail(html: string): string {
  const match = html.match(/[?&]token=([^&"'<\s]+)/);
  if (!match?.[1]) throw new Error(`No token in mail html: ${html.slice(0, 200)}`);
  return decodeURIComponent(match[1]);
}

async function requestSignupAndCaptureToken(email: string): Promise<string> {
  emailTransport.sent.length = 0;
  const res = await stack.http.raw("POST", "/api/auth/signup-request", { email });
  expect(res.status).toBe(200);
  const sent = emailTransport.sent[0];
  if (!sent) throw new Error("signup-request fixture didn't send mail");
  return extractTokenFromMail(sent.html);
}

async function aliceSession(): Promise<{ session: SessionUser; tenantId: TenantId }> {
  const tenantId = newTenantId();
  await seedTenant(stack.db, {
    id: tenantId,
    key: `tenant-alice-${tenantId.slice(0, 8)}`,
    name: "A",
  });
  const { id: userId } = await seedUser(stack.db, {
    email: "alice-landing@example.com",
    displayName: "Alice",
    passwordHash: await hashPassword("alice-landing-pw-1234"),
    emailVerified: true,
  });
  await seedTenantMembership(stack.db, { userId, tenantId, roles: ["Admin"] });
  return { session: { id: userId, tenantId, roles: ["Admin"] }, tenantId };
}

async function inviteEmail(admin: SessionUser, email: string, role: string): Promise<string> {
  await stack.http.writeOk(AuthHandlers.inviteCreate, { email, role }, admin);
  const sent = emailTransport.sent.at(-1);
  if (!sent) throw new Error("invite-create didn't send a mail");
  return extractTokenFromMail(sent.html);
}

describe("login", () => {
  test("TenantAdmin role → /a/vehicle-create", async () => {
    await seedTenantAdmin("landing-tenantadmin@example.com", "landing-pw-1234", ["TenantAdmin"]);
    const res = await postLogin("landing-tenantadmin@example.com", "landing-pw-1234");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { landingPath?: string };
    expect(body.landingPath).toBe("/a/vehicle-create");
  });

  test("plain User role → /a/profile", async () => {
    await seedTenantAdmin("landing-user@example.com", "landing-pw-1234", ["User"]);
    const res = await postLogin("landing-user@example.com", "landing-pw-1234");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { landingPath?: string };
    expect(body.landingPath).toBe("/a/profile");
  });
});

describe("signup-confirm", () => {
  test("INITIAL_SIGNUP_ROLES path with tenantKey passed to resolver", async () => {
    let receivedArgs: PostAuthLandingArgs | undefined;
    currentResolver = (args) => {
      receivedArgs = args;
      return defaultResolver(args);
    };

    const token = await requestSignupAndCaptureToken("landing-signup@example.com");
    const res = await stack.http.raw("POST", "/api/auth/signup-confirm", {
      token,
      password: "landing-signup-pw-1234",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenantKey?: string; landingPath?: string };

    // INITIAL_SIGNUP_ROLES grants TenantAdmin → same branch as the login test.
    expect(body.landingPath).toBe("/a/vehicle-create");
    expect(receivedArgs?.flow).toBe("signup");
    expect(receivedArgs?.tenantKey).toBe(body.tenantKey);
  });
});

describe("invite", () => {
  test("invite-signup-complete (Branch 3) → /a/invited/<tenantId>", async () => {
    const { session } = await aliceSession();
    const token = await inviteEmail(session, "landing-invite-new@example.com", "Editor");

    const res = await stack.http.raw("POST", "/api/auth/invite-signup-complete", {
      token,
      password: "landing-invite-pw-1234",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenantId?: string; landingPath?: string };
    expect(body.landingPath).toBe(`/a/invited/${body.tenantId}`);
  });

  test("invite-accept-with-login (Branch 2) → /a/invited/<tenantId> — uses the invited tenant, not the acceptor's own", async () => {
    const { session } = await aliceSession();
    const bobTenantId = await seedTenantAdmin(
      "landing-invite-bob@example.com",
      "landing-bob-pw-1234",
      ["User"],
    );
    const token = await inviteEmail(session, "landing-invite-bob@example.com", "Editor");

    const res = await stack.http.raw("POST", "/api/auth/invite-accept-with-login", {
      token,
      email: "landing-invite-bob@example.com",
      password: "landing-bob-pw-1234",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenantId?: string; landingPath?: string };
    expect(body.tenantId).not.toBe(bobTenantId);
    expect(body.landingPath).toBe(`/a/invited/${body.tenantId}`);
  });
});

describe("open-redirect / throwing resolver protections", () => {
  const unsafeCandidates: ReadonlyArray<[string, string]> = [
    ["protocol-relative", "//evil.com"],
    ["absolute URL", "https://evil.com"],
    ["backslash", "/\\evil.com"],
    ["empty string", ""],
  ];

  for (const [label, candidate] of unsafeCandidates) {
    test(`${label} candidate → login stays 200 with token, landingPath omitted`, async () => {
      currentResolver = () => candidate;
      await seedTenantAdmin("landing-unsafe@example.com", "landing-unsafe-pw-1234", ["User"]);

      const res = await postLogin("landing-unsafe@example.com", "landing-unsafe-pw-1234");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { token?: string; landingPath?: string };
      expect(body.token).toBeTruthy();
      expect(res.headers.get("set-cookie") ?? "").toContain("kumiko_auth=");
      expect(body).not.toHaveProperty("landingPath");
    });
  }

  test("rejecting async resolver → login stays 200 with token, landingPath omitted", async () => {
    // @cast-boundary test — simulates a JS consumer bypassing the sync signature
    currentResolver = (async () => {
      throw new Error("boom");
    }) as unknown as PostAuthLandingResolver;
    await seedTenantAdmin("landing-async@example.com", "landing-async-pw-1234", ["User"]);

    const res = await postLogin("landing-async@example.com", "landing-async-pw-1234");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string; landingPath?: string };
    expect(body.token).toBeTruthy();
    expect(body).not.toHaveProperty("landingPath");
  });

  test("throwing resolver → login stays 200 with token, landingPath omitted", async () => {
    currentResolver = () => {
      throw new Error("boom");
    };
    await seedTenantAdmin("landing-throw@example.com", "landing-throw-pw-1234", ["User"]);

    const res = await postLogin("landing-throw@example.com", "landing-throw-pw-1234");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string; landingPath?: string };
    expect(body.token).toBeTruthy();
    expect(res.headers.get("set-cookie") ?? "").toContain("kumiko_auth=");
    expect(body).not.toHaveProperty("landingPath");
  });
});
