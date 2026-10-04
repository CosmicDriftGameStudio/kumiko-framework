import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAuthMfaFeature } from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { TenantHandlers } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { type KumikoServerHandle, runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { ROLES } from "@cosmicdrift/kumiko-framework/auth";
import { type APIRequestContext, request as playwrightRequest } from "@playwright/test";
import { createHttpApi, csrfFetch, loginViaApi } from "../e2e/auth-kit";
import {
  PLAYWRIGHT_DEMO_ENV,
  SEED_ENABLE_ENV,
  SEED_ROUTES,
  SEED_TOKEN_ENV,
  SEED_TOKEN_HEADER,
} from "../e2e/constants";
import { seedTenantResponseSchema } from "../e2e/seed-contract";
import { createE2eSeedRoutes } from "../e2e/seed-route";
import { type ProvideSeedTenantDeps, provideSeedTenant } from "../e2e/seeded-tenant-fixture";
import { NOTE_CREATE, NOTE_LIST, noteFeature } from "./note-feature";

const TOKEN = "mfa-required-test-token";
const ADMIN = {
  email: "mfa-required-admin@example.test",
  password: "mfa-required-admin-pw-1234",
  displayName: "Admin",
  memberships: [],
};

const savedEnv = {
  jwt: process.env["JWT_SECRET"],
  seed: process.env[SEED_ENABLE_ENV],
  token: process.env[SEED_TOKEN_ENV],
  masterKey: process.env["KUMIKO_SECRETS_MASTER_KEY_V1"],
  masterKeyVersion: process.env["KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION"],
};
let handle: KumikoServerHandle;
let baseURL: string;
const contexts: APIRequestContext[] = [];

function newContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL }).then((context) => {
    contexts.push(context);
    return context;
  });
}

beforeAll(async () => {
  process.env["JWT_SECRET"] = PLAYWRIGHT_DEMO_ENV.JWT_SECRET;
  process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = PLAYWRIGHT_DEMO_ENV.KUMIKO_SECRETS_MASTER_KEY_V1;
  process.env["KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION"] = "1";
  process.env[SEED_ENABLE_ENV] = "1";
  process.env[SEED_TOKEN_ENV] = TOKEN;
  handle = await runDevApp({
    features: [
      noteFeature,
      createAuthMfaFeature({
        setupTokenSecret: "mfa-required-setup-token-secret-at-least-32-bytes",
        challengeTokenSecret: "mfa-required-challenge-secret-at-least-32-bytes",
        issuer: "Kumiko Test",
        requiredPolicy: "admins",
      }),
    ],
    port: 0,
    auth: { admin: ADMIN },
    extraRoutes: createE2eSeedRoutes(),
  });
  const port = handle.server?.port;
  if (port === undefined) throw new Error("runDevApp did not open a socket under Bun");
  baseURL = `http://localhost:${port}`;
});

afterAll(async () => {
  await Promise.all(contexts.map((context) => context.dispose()));
  await handle.stop();
  for (const [key, value] of [
    ["JWT_SECRET", savedEnv.jwt],
    [SEED_ENABLE_ENV, savedEnv.seed],
    [SEED_TOKEN_ENV, savedEnv.token],
    ["KUMIKO_SECRETS_MASTER_KEY_V1", savedEnv.masterKey],
    ["KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION", savedEnv.masterKeyVersion],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function withSeedFixture(
  body: (
    seed: Parameters<Parameters<typeof provideSeedTenant>[1]>[0],
    browserRequest: APIRequestContext,
  ) => Promise<void>,
): Promise<void> {
  const request = await newContext();
  const browserRequest = await newContext();
  await provideSeedTenant(
    {
      request,
      // @cast-boundary engine-bridge — the fixture only reads context.request and playwright.request.newContext
      context: { request: browserRequest } as unknown as ProvideSeedTenantDeps["context"],
      playwright: { request: playwrightRequest } as unknown as ProvideSeedTenantDeps["playwright"],
      baseURL,
    },
    (seed) => body(seed, browserRequest),
  );
}

describe("e2e kit under an MFA-required policy", () => {
  test("seedTenant({ mfa: 'totp' }) enrolls the admin; every login answers the MFA challenge", async () => {
    await withSeedFixture(async (seedTenant) => {
      const tenant = await seedTenant({ mfa: "totp" });

      expect(tenant.admin.mfaTotpSecret).toMatch(/^[A-Z2-7]+$/);
      // The fixture's own login plus a fresh one through tenant.api each pass the MFA step.
      expect(await tenant.api.queryOk<string[]>(NOTE_LIST, {})).toEqual([]);
      await tenant.api.writeOk(NOTE_CREATE, { title: "behind mfa" });
      expect(await tenant.api.queryOk<string[]>(NOTE_LIST, {})).toEqual(["behind mfa"]);

      const again = await newContext();
      await loginViaApi(again, tenant.admin);
      expect(await createHttpApi(again).queryOk<string[]>(NOTE_LIST, {})).toEqual(["behind mfa"]);
    });
  });

  test("without the secret loginViaApi fails loudly on the unanswered MFA challenge", async () => {
    await withSeedFixture(async (seedTenant) => {
      const tenant = await seedTenant({ mfa: "totp" });
      const context = await newContext();

      await expect(
        loginViaApi(context, { email: tenant.admin.email, password: tenant.admin.password }),
      ).rejects.toThrow(/needs MFA/);
    });
  });

  test("addUser({ mfa: 'totp' }) enrolls a member in-session; once promoted to admin it logs in with the secret and the seeded admin keeps its session", async () => {
    await withSeedFixture(async (seedTenant, browserRequest) => {
      const tenant = await seedTenant({ mfa: "totp" });

      const member = await tenant.addUser([ROLES.Member], { mfa: "totp" });
      expect(member.mfaTotpSecret).toMatch(/^[A-Z2-7]+$/);

      // The admin's own cookie jar (the fixture's context) survived the member's enrollment.
      expect(await createHttpApi(browserRequest).queryOk<string[]>(NOTE_LIST, {})).toEqual([]);

      await tenant.api.writeOk(TenantHandlers.updateMemberRoles, {
        userId: member.id,
        roles: [ROLES.TenantAdmin],
      });

      const context = await newContext();
      await loginViaApi(context, member);
      await createHttpApi(context).writeOk(NOTE_CREATE, { title: "by promoted member" });
      expect(await createHttpApi(context).queryOk<string[]>(NOTE_LIST, {})).toEqual([
        "by promoted member",
      ]);
    });
  });

  test("seedTenant() without options enrolls the admin when the policy demands MFA", async () => {
    await withSeedFixture(async (seedTenant) => {
      const tenant = await seedTenant();

      expect(tenant.admin.mfaTotpSecret).toMatch(/^[A-Z2-7]+$/);
      await tenant.api.writeOk(NOTE_CREATE, { title: "auto enrolled" });
      expect(await tenant.api.queryOk<string[]>(NOTE_LIST, {})).toEqual(["auto enrolled"]);
    });
  });

  test("an admin seeded without mfa is blocked by the policy until enrolled", async () => {
    const anon = await newContext();
    const seeded = seedTenantResponseSchema.parse(
      await (
        await anon.post(SEED_ROUTES.seedTenant, {
          headers: { [SEED_TOKEN_HEADER]: TOKEN },
          data: {},
        })
      ).json(),
    );
    const context = await newContext();

    await expect(loginViaApi(context, seeded.admin)).rejects.toThrow(/needs MFA/);

    const denied = await csrfFetch(context, "/api/query", { type: NOTE_LIST, payload: {} });
    expect(denied.status()).toBeGreaterThanOrEqual(401);
  });
});
