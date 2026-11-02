// The auth.admin seed is an operator-created account: under strict email verification it must log in
// without a verification mail.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  AuthErrors,
  AuthHandlers,
  createAuthEmailPasswordFeature,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { seedAdminGuarded } from "@cosmicdrift/kumiko-bundled-features/auth-email-password/seeding";
import {
  createChannelEmailFeature,
  createInMemoryTransport,
} from "@cosmicdrift/kumiko-bundled-features/channel-email";
import { createConfigFeature } from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createDeliveryFeature,
  createDeliveryTestContext,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import { createRendererFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/renderer-foundation";
import { createTemplateResolverFeature } from "@cosmicdrift/kumiko-bundled-features/template-resolver";
import { createTenantFeature } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import type { TenantId } from "@cosmicdrift/kumiko-types/identifiers";
import { resolveSeedShortcuts } from "../../boot-options/seed-shortcuts.ts";
import { applyStandardBootSeeds } from "../shared-boot-steps.ts";

const TENANT_ID = "00000000-0000-4000-8000-0000000000a1" as TenantId;
const ADMIN_EMAIL = "seed-admin@example.com";
const ADMIN_PASSWORD = "seed-admin-pw-1234567";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createTemplateResolverFeature(),
      createRendererFoundationFeature(),
      createRendererMailHtmlFeature(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: createInMemoryTransport(),
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        emailVerification: {
          hmacSecret: Buffer.alloc(32, 7).toString("base64"),
          tokenTtlMinutes: 60,
          mode: "strict",
          appUrl: "https://app.example.com/verify",
        },
      }),
    ],
    extraContext: (deps) => createDeliveryTestContext(deps),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("auth.admin seed under emailVerificationMode strict", () => {
  test("the seeded admin logs in", async () => {
    await applyStandardBootSeeds({
      db: stack.db,
      registry: stack.registry,
      admin: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        displayName: "Admin",
        memberships: [
          { tenantId: TENANT_ID, tenantKey: "seed", tenantName: "Seed", roles: ["Admin"] },
        ],
      },
      shortcutSeeds: [],
      cipher: undefined,
      processName: "test",
    });

    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).token).toBe("string");
  });

  test.each([
    { name: "demoAdminFromEnv", seeds: { demoAdminFromEnv: true }, prefix: "DEMO_ADMIN" },
    { name: "sysadminFromEnv", seeds: { sysadminFromEnv: true }, prefix: "DEMO_SYSADMIN" },
  ] as const)("the $name shortcut account logs in", async ({ seeds, prefix }) => {
    const email = `${prefix.toLowerCase()}@example.com`;
    const password = `${prefix.toLowerCase()}-pw-1234567`;
    const shortcutSeeds = resolveSeedShortcuts(
      { demoTenant: { id: TENANT_ID, key: "demo", name: "Demo" }, ...seeds },
      {
        envSource: { [`${prefix}_EMAIL`]: email, [`${prefix}_PASSWORD`]: password },
        hasAuth: true,
        hasAuthAdmin: false,
      },
    );
    await applyStandardBootSeeds({
      db: stack.db,
      registry: stack.registry,
      admin: undefined,
      shortcutSeeds,
      cipher: undefined,
      processName: "test",
    });

    const res = await stack.http.raw("POST", "/api/auth/login", { email, password });
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).token).toBe("string");
  });

  describe("demoAdminFromEnv on an account seeded earlier", () => {
    const DEMO_TENANT = { id: TENANT_ID, key: "demo", name: "Demo" };

    async function seedUnverifiedDemoAdmin(email: string, password: string) {
      await seedAdminGuarded(stack.db, {
        email,
        password,
        displayName: "Admin",
        emailVerified: false,
        memberships: [
          { tenantId: TENANT_ID, tenantKey: "demo", tenantName: "Demo", roles: ["Admin"] },
        ],
      });
    }

    async function bootDemoAdmin(
      email: string,
      password: string,
      demoAdminFromEnv: boolean | { readonly emailVerified: boolean },
    ) {
      const shortcutSeeds = resolveSeedShortcuts(
        { demoTenant: DEMO_TENANT, demoAdminFromEnv },
        {
          envSource: { DEMO_ADMIN_EMAIL: email, DEMO_ADMIN_PASSWORD: password },
          hasAuth: true,
          hasAuthAdmin: false,
        },
      );
      await applyStandardBootSeeds({
        db: stack.db,
        registry: stack.registry,
        admin: undefined,
        shortcutSeeds,
        cipher: undefined,
        processName: "test",
      });
    }

    test("an unverified account becomes verified on the next boot", async () => {
      const email = "earlier-unverified@example.com";
      const password = ADMIN_PASSWORD;
      await seedUnverifiedDemoAdmin(email, password);
      const before = await stack.http.raw("POST", "/api/auth/login", { email, password });
      expect(before.status).toBe(422);

      await bootDemoAdmin(email, password, true);

      const res = await stack.http.raw("POST", "/api/auth/login", { email, password });
      expect(res.status).toBe(200);
    });

    test("emailVerified: false keeps the account locked under strict verification", async () => {
      const email = "explicit-unverified@example.com";
      const password = ADMIN_PASSWORD;

      await bootDemoAdmin(email, password, { emailVerified: false });

      const res = await stack.http.raw("POST", "/api/auth/login", { email, password });
      expect(res.status).toBe(422);
      expect((await res.json()).error?.details?.reason).toBe(AuthErrors.emailNotVerified);
    });
  });
});
