// Proves the L2 rate-limit (authEndpointRateLimit, Sprint G.5) actually
// covers the public password-reset + email-verification routes. Without
// this test the commit message's "Rate-Limit via L2" claim is just a
// comment — a regression that silently moves the routes out of /api/auth/*
// or tightens loginRateLimit but forgets these would sail through.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { createEncryptionProvider } from "@cosmicdrift/kumiko-framework/db";
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
import { tenantMembershipsTable } from "../../tenant/membership-table";
import { tenantEntity } from "../../tenant/schema/tenant";
import { createUserFeature } from "../../user/feature";
import { userEntity, userTable } from "../../user/schema/user";
import { AuthHandlers } from "../constants";
import { createAuthEmailPasswordFeature } from "../feature";

let stack: TestStack;
// delivery is a hard dep of the reset/verify flows now; mount it so boot
// passes. These tests hit unknown emails → no-op → no mail is actually sent.
const emailTransport = createInMemoryTransport();
const encryptionKey = randomBytes(32).toString("base64");
const resetSecret = randomBytes(32).toString("base64");
const verifySecret = randomBytes(32).toString("base64");

beforeAll(async () => {
  const encryption = createEncryptionProvider(encryptionKey);
  const resolver = createConfigResolver({ encryption });

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
          hmacSecret: resetSecret,
          tokenTtlMinutes: 15,
          appUrl: "https://app.example.com/reset",
        },
        emailVerification: {
          hmacSecret: verifySecret,
          tokenTtlMinutes: 60,
          mode: "strict",
          appUrl: "https://app.example.com/verify",
        },
      }),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: resolver,
      configEncryption: encryption,
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      passwordReset: {
        requestHandler: AuthHandlers.requestPasswordReset,
        confirmHandler: AuthHandlers.resetPassword,
      },
      emailVerification: {
        requestHandler: AuthHandlers.requestEmailVerification,
        confirmHandler: AuthHandlers.verifyEmail,
      },
    },
    // Tight limit so the test trips it with a small number of requests,
    // short window so a flaky re-run doesn't keep the bucket full.
    rateLimit: {
      auth: { limit: 2, windowSeconds: 60, onFailClosed: () => {} },
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
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
});

// Unique IP per test so buckets don't cross-contaminate. L2 default bucket
// is ip+path; we rely on that to keep password-reset and verify-email
// independent in their own test.
function withIp(ip: string): HeadersInit {
  return { "Content-Type": "application/json", "x-forwarded-for": ip };
}

async function postFrom(path: string, ip: string, body: unknown): Promise<Response> {
  return stack.app.request(path, {
    method: "POST",
    headers: withIp(ip),
    body: JSON.stringify(body),
  });
}

describe("L2 rate-limit covers public token routes", () => {
  test("/auth/request-password-reset → 429 after 2 hits from same IP", async () => {
    const ip = "10.50.0.1";
    const path = "/api/auth/request-password-reset";

    const a = await postFrom(path, ip, { email: "a@example.com" });
    const b = await postFrom(path, ip, { email: "b@example.com" });
    const c = await postFrom(path, ip, { email: "c@example.com" });

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(c.status).toBe(429);
  });

  test("/auth/verify-email → 429 after 2 hits from same IP", async () => {
    const ip = "10.50.0.2";
    const path = "/api/auth/verify-email";

    const a = await postFrom(path, ip, { token: "not-a-real-token.1.sig" });
    const b = await postFrom(path, ip, { token: "not-a-real-token.1.sig" });
    const c = await postFrom(path, ip, { token: "not-a-real-token.1.sig" });

    // 422 / 400 for the first two — the handler rejects the garbage token.
    // The important assertion: the THIRD hit comes back 429 before reaching
    // the handler, proving the L2 middleware is in front of the route.
    expect(a.status).not.toBe(429);
    expect(b.status).not.toBe(429);
    expect(c.status).toBe(429);
  });

  test("different IPs buckets independently — one flooder doesn't lock out another", async () => {
    const attacker = "10.50.0.100";
    const victim = "10.50.0.101";
    const path = "/api/auth/request-password-reset";

    // Burn the attacker's quota.
    await postFrom(path, attacker, { email: "bad@example.com" });
    await postFrom(path, attacker, { email: "bad@example.com" });
    const attackerBlocked = await postFrom(path, attacker, { email: "bad@example.com" });
    expect(attackerBlocked.status).toBe(429);

    // Victim IP still has a fresh bucket.
    const victimFirst = await postFrom(path, victim, { email: "good@example.com" });
    expect(victimFirst.status).toBe(200);
  });
});
