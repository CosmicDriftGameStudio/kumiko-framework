// A runDevApp binds database-backed revokers onto the module-level APP_FEATURES instances. After
// stop() a stack built from the same instances must not reach that closed connection:
// auth-mfa enable-confirm calls the bound session and PAT revokers.

import { afterAll, beforeAll, describe, test } from "bun:test";
import {
  AuthHandlers,
  hashPassword,
} from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
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
import { runDevApp } from "@cosmicdrift/kumiko-dev-server";
import { configureEntityFieldEncryption } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { composeFeatures } from "@cosmicdrift/kumiko-server-runtime/compose-features";
import { PLAYWRIGHT_DEMO_ENV } from "@cosmicdrift/kumiko-testing/e2e/constants";
import { createTestEnvelopeCipher, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { devAppOptions } from "../app/dev-app-options";
import { APP_FEATURES, AUTH_COMPOSE_OPTIONS } from "../run-config";

const TENANT: TenantId = "00000000-0000-4000-8000-000000000021" as TenantId;
const ENV_KEYS = [
  "JWT_SECRET",
  "KUMIKO_SECRETS_MASTER_KEY_V1",
  "KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION",
] as const;
const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

let stack: TestStack;

beforeAll(async () => {
  process.env["JWT_SECRET"] = PLAYWRIGHT_DEMO_ENV.JWT_SECRET;
  process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = PLAYWRIGHT_DEMO_ENV.KUMIKO_SECRETS_MASTER_KEY_V1;
  process.env["KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION"] = "1";
  const {
    clientEntry: _client,
    htmlPath: _html,
    watchDirs: _watch,
    seeds: _seeds,
    ...options
  } = devAppOptions;
  const firstApp = await runDevApp({
    ...options,
    port: 0,
    installSignalHandlers: false,
    stylesheet: false,
  });
  await firstApp.stop();

  configureEntityFieldEncryption(createTestEnvelopeCipher());
  const features = composeFeatures([...APP_FEATURES], {
    includeBundled: true,
    authOptions: AUTH_COMPOSE_OPTIONS,
  });
  stack = await setupTestStack({
    features,
    extraContext: () => ({ configResolver: createConfigResolver() }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      mfaVerifyHandler: AuthMfaHandlers.verify,
      switchTenantMfaGateHandler: AuthHandlers.switchTenantMfaGate,
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
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("runDevApp stop releases the late-bound revokers", () => {
  test("a later stack on the same feature instances confirms MFA without reaching the closed database", async () => {
    await resetTestTables(stack.db, [userTable, tenantMembershipsTable, eventsTable]);
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      {
        email: "late-bind@use-all.test",
        passwordHash: await hashPassword("super-long-password"),
        displayName: "late-bind",
      },
      TestUsers.systemAdmin,
    );
    await seedTenantMembership(stack.db, { userId: created.id, tenantId: TENANT, roles: ["User"] });
    const sessionUser = { id: created.id, tenantId: TENANT, roles: ["User"] };

    const start = await stack.http.writeOk<{ setupToken: string; otpauthUri: string }>(
      AuthMfaHandlers.enableStart,
      { accountLabel: "late-bind@use-all.test" },
      sessionUser,
    );
    const secretParam = new URLSearchParams(start.otpauthUri.split("?")[1]).get("secret") ?? "";
    await stack.http.writeOk(
      AuthMfaHandlers.enableConfirm,
      { setupToken: start.setupToken, code: currentTotpCode(base32Decode(secretParam)) },
      sessionUser,
    );
  });
});
