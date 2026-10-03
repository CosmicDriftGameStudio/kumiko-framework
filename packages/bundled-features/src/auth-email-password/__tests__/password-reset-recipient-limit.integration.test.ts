// Per-recipient limit on request-password-reset (additionalRateLimits): the
// public /api/auth route answers { isSuccess: true } for every outcome, so the
// cap on mails per address is only observable at the mail transport.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { authFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-framework/testing";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.js";
import { notificationPreferencesTable } from "../../delivery/tables.js";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.js";
import { createRendererSimpleFeature, simpleRenderer } from "../../renderer-simple/index.js";
import { createSessionsFeature, userSessionTable } from "../../sessions/index.js";
import { hashPassword } from "../../shared/index.js";
import { createTemplateResolverFeature } from "../../template-resolver/feature.js";
import { createTenantFeature } from "../../tenant/index.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { seedTenantMembership } from "../../tenant/testing.js";
import { createUserFeature } from "../../user/feature.js";
import { UserHandlers } from "../../user/index.js";
import { userEntity } from "../../user/schema/user.js";
import { AuthHandlers } from "../constants.js";
import { createAuthEmailPasswordFeature } from "../feature.js";

const emailTransport = createInMemoryTransport();
const MAILS_PER_ADDRESS = 5;
const REQUESTS = MAILS_PER_ADDRESS + 1;

let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
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
        passwordReset: {
          hmacSecret: randomBytes(32).toString("base64"),
          tokenTtlMinutes: 15,
          appUrl: "https://app.example.com/reset",
        },
      }),
      authFoundationFeature,
      createSessionsFeature({ autoRevokeOnPasswordChange: async () => 0 }),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      passwordReset: {
        requestHandler: AuthHandlers.requestPasswordReset,
        confirmHandler: AuthHandlers.resetPassword,
      },
    },
    trustedProxyHops: 1,
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    userSessionTable,
    notificationPreferencesTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
});

test("six reset requests for one address from six IPs all answer 200 but mail at most five", async () => {
  const email = "flooded-reset@example.com";
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    {
      email,
      passwordHash: await hashPassword("initial-pw!"),
      displayName: "Flooded",
    },
    TestUsers.systemAdmin,
  );
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId: "00000000-0000-4000-8000-000000000001",
    roles: ["User"],
  });

  for (let i = 0; i < REQUESTS; i += 1) {
    const res = await stack.http.raw(
      "POST",
      "/api/auth/request-password-reset",
      { email },
      { "x-forwarded-for": `10.84.0.${i + 1}` },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isSuccess: true });
  }

  expect(emailTransport.sent.filter((mail) => mail.to === email)).toHaveLength(MAILS_PER_ADDRESS);
});
