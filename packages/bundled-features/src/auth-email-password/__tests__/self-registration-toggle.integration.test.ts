// Runtime on/off switch for self-signup (#self-registration-toggle). Pins:
//   1. Default (no override row) → signup-request works.
//   2. runtime.apply(off) → signup-request 403 feature_disabled, no mail sent.
//   3. runtime.apply(on) → works again.
// Mirrors samples/recipes/feature-toggles' runtime.apply() pattern — flips the
// in-memory snapshot directly instead of going through the set-handler/HTTP,
// since that wiring is already covered by feature-toggles' own tests.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  createFeatureTogglesFeature,
  GlobalFeatureToggleRuntime,
  globalFeatureStateTable,
} from "@cosmicdrift/kumiko-bundled-features/feature-toggles";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { createLateBoundHolder } from "@cosmicdrift/kumiko-framework/testing";
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
import {
  AUTH_SELF_REGISTRATION_FEATURE,
  createAuthSelfRegistrationToggleFeature,
} from "../self-registration-toggle";

const APP_ACTIVATION_URL = "https://app.example.com/signup/complete";
const emailTransport = createInMemoryTransport();

let stack: TestStack;
let runtime: GlobalFeatureToggleRuntime;

beforeAll(async () => {
  let effective: () => ReadonlySet<string> = () => new Set();
  const runtimeHolder = createLateBoundHolder<GlobalFeatureToggleRuntime>("runtime");

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
      }),
      createAuthSelfRegistrationToggleFeature(),
      createFeatureTogglesFeature({ getRuntime: () => runtimeHolder.get() }),
    ],
    effectiveFeatures: () => effective(),
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver(),
    }),
    systemHooks: [],
    anonymousAccess: { defaultTenantId: SYSTEM_TENANT_ID },
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      signup: {
        requestHandler: AuthHandlers.signupRequest,
        confirmHandler: AuthHandlers.signupConfirm,
      },
    },
  });

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
    globalFeatureStateTable,
  });

  runtime = new GlobalFeatureToggleRuntime(stack.db, stack.registry);
  await runtime.initialize();
  effective = runtime.effectiveFeatures;
  runtimeHolder.set(runtime);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${userTable.tableName}"`);
  await asRawClient(stack.db).unsafe(`DELETE FROM "${globalFeatureStateTable.tableName}"`);
  await runtime.refresh();
  emailTransport.sent.length = 0;
  const allKeys = await stack.redis.redis.keys("signup:*");
  if (allKeys.length > 0) await stack.redis.redis.del(...allKeys);
});

async function postSignupRequest(email: string): Promise<Response> {
  return stack.http.raw("POST", "/api/auth/signup-request", { email });
}

describe("auth-self-registration toggle", () => {
  test("default (no override) → signup-request works", async () => {
    const res = await postSignupRequest("alice@example.com");
    expect(res.status).toBe(200);
    expect(emailTransport.sent).toHaveLength(1);
  });

  test("runtime off → signup-request still 200 (anti-enumeration silent-success) but no mail sent", async () => {
    runtime.apply(AUTH_SELF_REGISTRATION_FEATURE, false);

    const res = await postSignupRequest("blocked@example.com");
    expect(res.status).toBe(200);
    expect(emailTransport.sent).toHaveLength(0);
  });

  test("runtime back on → mail sends again", async () => {
    runtime.apply(AUTH_SELF_REGISTRATION_FEATURE, false);
    await postSignupRequest("still-blocked@example.com");
    expect(emailTransport.sent).toHaveLength(0);

    runtime.apply(AUTH_SELF_REGISTRATION_FEATURE, true);
    const res = await postSignupRequest("reenabled@example.com");
    expect(res.status).toBe(200);
    expect(emailTransport.sent).toHaveLength(1);
  });

  test("status query reflects the runtime flip", async () => {
    const onRes = await stack.http.raw("POST", "/api/query", {
      type: "auth-email-password:query:signup-registration-status",
      payload: {},
    });
    expect((await onRes.json()) as { data?: { enabled: boolean } }).toMatchObject({
      data: { enabled: true },
    });

    runtime.apply(AUTH_SELF_REGISTRATION_FEATURE, false);
    const offRes = await stack.http.raw("POST", "/api/query", {
      type: "auth-email-password:query:signup-registration-status",
      payload: {},
    });
    expect((await offRes.json()) as { data?: { enabled: boolean } }).toMatchObject({
      data: { enabled: false },
    });
  });
});
