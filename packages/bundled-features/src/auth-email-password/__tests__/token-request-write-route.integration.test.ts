// The anonymous token-request handlers are also reachable through the generic
// POST /api/write. That route returns the handler result as-is, so the result
// itself must carry no secret and must not tell known from unknown addresses.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { createTestEnvelopeCipher, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
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
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenantMembership } from "../../tenant/testing.ts";
import { createUserFeature } from "../../user/feature.ts";
import { UserHandlers } from "../../user/index.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createAuthEmailPasswordFeature } from "../feature.ts";
import { AuthHandlers } from "../web/constants.ts";
import { authMailRendererFeatures, seedAuthMailTemplates } from "./auth-mail-stack.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const KNOWN_EMAIL = "alice@example.com";
const UNKNOWN_EMAIL = "ghost@example.com";

const emailTransport = createInMemoryTransport();
let stack: TestStack;

beforeAll(async () => {
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const secret = () => randomBytes(32).toString("base64");

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
          hmacSecret: secret(),
          tokenTtlMinutes: 15,
          appUrl: "https://app.example.com/reset",
        },
        emailVerification: {
          hmacSecret: secret(),
          tokenTtlMinutes: 60,
          mode: "strict",
          appUrl: "https://app.example.com/verify",
        },
        accountUnlock: {
          hmacSecret: secret(),
          tokenTtlMinutes: 15,
          appUrl: "https://app.example.com/unlock-account",
        },
        signup: { tokenTtlMinutes: 60, appUrl: "https://app.example.com/signup/complete" },
      }),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
    }),
    anonymousAccess: { defaultTenantId: TENANT_ID },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
  });
  await seedAuthMailTemplates(stack);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await resetTestTables(stack.db, [userTable, tenantMembershipsTable, eventsTable]);
  await stack.redis.flushNamespace();
  emailTransport.sent.length = 0;
  const hash = await hashPassword("pw-initial-1234");
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email: KNOWN_EMAIL, passwordHash: hash, displayName: "alice" },
    TestUsers.systemAdmin,
  );
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId: TENANT_ID,
    roles: ["User"],
  });
});

type WriteBody = { isSuccess: boolean; data?: Record<string, unknown> };

async function anonymousWrite(
  type: string,
  email: string,
): Promise<{ status: number; rawText: string; body: WriteBody }> {
  const res = await stack.http.raw("POST", "/api/write", { type, payload: { email } });
  const rawText = await res.text();
  return { status: res.status, rawText, body: JSON.parse(rawText) as WriteBody };
}

function tokenFromSentMail(): string {
  const sent = emailTransport.sent.at(-1);
  if (!sent) throw new Error("no mail sent");
  const token = /[?&]token=([\w.-]+)/.exec(sent.text ?? "")?.[1];
  if (!token) throw new Error("no token in mail");
  return token;
}

function expectNoSecretInResponse(result: { rawText: string; body: WriteBody }) {
  const token = tokenFromSentMail();
  expect(result.rawText).not.toContain(token);
  expect(result.body.data).toBeDefined();
  expect(result.body.data).not.toHaveProperty("token");
  expect(result.body.data).not.toHaveProperty("email");
}

describe("anonymous POST /api/write on token-request handlers", () => {
  test.each([
    ["request-password-reset", AuthHandlers.requestPasswordReset],
    ["request-email-verification", AuthHandlers.requestEmailVerification],
    ["request-account-unlock", AuthHandlers.requestAccountUnlock],
  ])(
    "%s: the result carries no token or email and is the same for unknown addresses",
    async (_name, qn) => {
      const known = await anonymousWrite(qn, KNOWN_EMAIL);
      expect(known.status).toBe(200);
      expect(known.body.isSuccess).toBe(true);
      expect(emailTransport.sent).toHaveLength(1);
      expectNoSecretInResponse(known);

      const unknown = await anonymousWrite(qn, UNKNOWN_EMAIL);
      expect(unknown.status).toBe(200);
      expect(unknown.body.isSuccess).toBe(true);
      expect(emailTransport.sent).toHaveLength(1);
      expect(unknown.body.data).toEqual(known.body.data);
    },
  );

  test("signup-request: the result carries no token or email", async () => {
    const result = await anonymousWrite(AuthHandlers.signupRequest, "newcomer@example.com");
    expect(result.status).toBe(200);
    expect(result.body.isSuccess).toBe(true);
    expect(emailTransport.sent).toHaveLength(1);
    expectNoSecretInResponse(result);
  });
});
