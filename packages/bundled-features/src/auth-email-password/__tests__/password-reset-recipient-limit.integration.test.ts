// Per-recipient limit on request-password-reset (additionalRateLimits): the
// public /api/auth route answers { isSuccess: true } for every outcome, so the
// cap on mails per address is only observable at the mail transport.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { notificationPreferencesTable } from "../../delivery/tables.ts";
import { createSessionsFeature, userSessionTable } from "../../sessions/index.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenantMembership } from "../../tenant/testing.ts";
import { createUserFeature } from "../../user/feature.ts";
import { UserHandlers } from "../../user/index.ts";
import { userEntity } from "../../user/schema/user.ts";
import { AuthHandlers } from "../constants.ts";
import {
  AUTH_EMAIL_RATE_LIMIT_MAX_REQUESTS,
  AUTH_EMAIL_RATE_LIMIT_WINDOW_SECONDS,
} from "../email-rate-limits.ts";
import { createAuthEmailPasswordFeature } from "../feature.ts";
import { authMailRendererFeatures, seedAuthMailTemplates } from "./auth-mail-stack.ts";

const emailTransport = createInMemoryTransport();
const MAILS_PER_ADDRESS = AUTH_EMAIL_RATE_LIMIT_MAX_REQUESTS;
const REQUESTS = MAILS_PER_ADDRESS + 1;

let stack: TestStack;
let nowMs = 1_700_000_000_000;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      ...authMailRendererFeatures(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        passwordReset: {
          hmacSecret: randomBytes(32).toString("base64"),
          tokenTtlMinutes: 15,
          appUrl: "https://app.example.com/reset",
        },
      }),
      createAuthFoundationFeature(),
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
    rateLimitNowMs: () => nowMs,
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    userSessionTable,
    notificationPreferencesTable,
  });
  await seedAuthMailTemplates(stack);
});

afterAll(async () => {
  await stack.cleanup();
});

test("reset requests for one address from rotating IPs all answer 200 but mail at most the cap, and the address is usable again after the short window", async () => {
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

  nowMs += AUTH_EMAIL_RATE_LIMIT_WINDOW_SECONDS * 1000;
  const afterWindow = await stack.http.raw(
    "POST",
    "/api/auth/request-password-reset",
    { email },
    { "x-forwarded-for": "10.84.1.1" },
  );
  expect(afterWindow.status).toBe(200);
  expect(emailTransport.sent.filter((mail) => mail.to === email)).toHaveLength(
    MAILS_PER_ADDRESS + 1,
  );
});
