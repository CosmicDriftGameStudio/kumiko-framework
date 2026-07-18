// Mount-order guard: APP_FEATURES (incl. auth-mfa + sessions) via composeFeatures
// must complete login and the MFA challenge path. Full createKumikoServer boot
// stays in full-stack-boot.integration.test.ts.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { AuthHandlers, hashPassword } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import {
  AuthMfaHandlers,
  base32Decode,
  userMfaEntity,
} from "@cosmicdrift/kumiko-bundled-features/auth-mfa";
import { currentTotpCode } from "@cosmicdrift/kumiko-bundled-features/auth-mfa/testing";
import {
  configValuesTable,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import { tenantEntity, tenantMembershipsTable } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { seedTenantMembership } from "@cosmicdrift/kumiko-bundled-features/tenant/seeding";
import { UserHandlers, userEntity, userTable } from "@cosmicdrift/kumiko-bundled-features/user";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createTestEnvelopeCipher, deleteRows } from "@cosmicdrift/kumiko-framework/testing";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { APP_FEATURES } from "../run-config";

const TENANT: TenantId = "00000000-0000-4000-8000-000000000020" as TenantId;

let stack: TestStack;

beforeAll(async () => {
  configureEntityFieldEncryption(createTestEnvelopeCipher());
  const features = composeFeatures([...APP_FEATURES], { includeBundled: true });
  stack = await setupTestStack({
    features,
    extraContext: () => ({ configResolver: createConfigResolver() }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      mfaVerifyHandler: AuthMfaHandlers.verify,
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userMfaEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

afterAll(async () => {
  await stack.cleanup();
  configureEntityFieldEncryption(undefined);
});

beforeEach(async () => {
  await deleteRows(stack.db, userTable, {});
  await deleteRows(stack.db, tenantMembershipsTable, {});
});

async function seedUser(email: string, password: string): Promise<{ id: string }> {
  const hash = await hashPassword(password);
  const created = await stack.http.writeOk<{ id: string }>(
    UserHandlers.create,
    { email, passwordHash: hash, displayName: email.split("@")[0] ?? "u" },
    TestUsers.systemAdmin,
  );
  await seedTenantMembership(stack.db, {
    userId: created.id,
    tenantId: TENANT,
    roles: ["User"],
  });
  return { id: created.id };
}

describe("use-all-bundled identity workflows", () => {
  test("login without MFA returns JWT", async () => {
    await seedUser("plain@use-all.test", "super-long-password");
    const res = await stack.http.raw("POST", "/api/auth/login", {
      email: "plain@use-all.test",
      password: "super-long-password",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string; mfaRequired?: boolean };
    expect(body.token).toBeTypeOf("string");
    expect(body.mfaRequired).toBeUndefined();
  });

  test("MFA enrolled → challenge → verify mints JWT", async () => {
    const user = await seedUser("mfa@use-all.test", "super-long-password");
    const sessionUser = { id: user.id, tenantId: TENANT, roles: ["User"] };

    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "mfa@use-all.test" },
      sessionUser,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    const secret = base32Decode(secretParam);
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(secret) },
      sessionUser,
    );

    const login = await stack.http.raw("POST", "/api/auth/login", {
      email: "mfa@use-all.test",
      password: "super-long-password",
    });
    expect(login.status).toBe(200);
    const challenge = (await login.json()) as {
      mfaRequired?: boolean;
      challengeToken?: string;
      token?: string;
    };
    expect(challenge.mfaRequired).toBe(true);
    expect(challenge.token).toBeUndefined();

    const verify = await stack.http.raw("POST", "/api/auth/mfa/verify", {
      challengeToken: challenge.challengeToken,
      code: currentTotpCode(secret),
    });
    expect(verify.status).toBe(200);
    const { token } = (await verify.json()) as { token: string };
    expect(token).toBeTypeOf("string");
  });
});
