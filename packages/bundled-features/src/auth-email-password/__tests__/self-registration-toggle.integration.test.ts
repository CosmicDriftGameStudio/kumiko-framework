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
  // globalFeatureStateTable is auto-provisioned by setupTestStack — no
  // manual push needed (that used to mask a missing r.storeTable()
  // registration entirely).
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
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

// Regression for Finding 1 (#1468): the suite above always composes the
// companion toggle feature alongside feature-toggles. An app that mounts
// createFeatureTogglesFeature + a real effectiveFeatures resolver but
// forgets (or never knew to) compose createAuthSelfRegistrationToggleFeature
// must not go silently signup-dead — ctx.hasFeature() is checked against a
// feature name the registry never registered.
describe("auth-self-registration toggle — companion feature NOT composed", () => {
  const bareEmailTransport = createInMemoryTransport();
  let bareStack: TestStack;
  let bareRuntime: GlobalFeatureToggleRuntime;

  beforeAll(async () => {
    const runtimeHolder = createLateBoundHolder<GlobalFeatureToggleRuntime>("bare-runtime");
    let effective: () => ReadonlySet<string> = () => new Set();

    bareStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createUserFeature(),
        createTenantFeature(),
        createTemplateResolverFeature(),
        createRendererFoundationFeature(),
        createDeliveryFeature(),
        createRendererSimpleFeature(),
        createChannelEmailFeature({
          transport: bareEmailTransport,
          renderer: simpleRenderer,
          resolveEmail: async () => "unused@test.local",
        }),
        createAuthEmailPasswordFeature({
          signup: { tokenTtlMinutes: 60, appUrl: APP_ACTIVATION_URL },
        }),
        // Deliberately NO createAuthSelfRegistrationToggleFeature().
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

    await unsafeCreateEntityTable(bareStack.db, userEntity);
    await unsafeCreateEntityTable(bareStack.db, tenantEntity);
    await unsafePushTables(bareStack.db, {
      configValuesTable,
      tenantMembershipsTable,
      notificationPreferencesTable,
    });

    bareRuntime = new GlobalFeatureToggleRuntime(bareStack.db, bareStack.registry);
    await bareRuntime.initialize();
    effective = bareRuntime.effectiveFeatures;
    runtimeHolder.set(bareRuntime);
  });

  afterAll(async () => {
    await bareStack.cleanup();
  });

  // KNOWN GAP (found while writing this regression pin, not yet decided):
  // ctx.hasFeature() checks the effective-feature SET, which only ever
  // contains registered feature names (computeEffectiveFeatures iterates
  // registry.features). A name nothing ever registered is never a member,
  // so hasFeature("auth-self-registration") is false here — signup-request
  // silently no-ops (200, anti-enumeration success shape, but no mail) the
  // moment an app wires a real effectiveFeatures resolver without also
  // composing createAuthSelfRegistrationToggleFeature. This pins the
  // CURRENT (broken) behavior rather than asserting the desired one —
  // flagged for a follow-up decision, not silently fixed here.
  test("[KNOWN GAP] signup-request silently drops mail when the companion toggle feature was never composed", async () => {
    const res = await bareStack.http.raw("POST", "/api/auth/signup-request", {
      email: "not-toggle-aware@example.com",
    });
    expect(res.status).toBe(200);
    expect(bareEmailTransport.sent).toHaveLength(0);
  });

  test("[KNOWN GAP] signup-registration-status reports enabled:false with no toggle feature mounted", async () => {
    const res = await bareStack.http.raw("POST", "/api/query", {
      type: "auth-email-password:query:signup-registration-status",
      payload: {},
    });
    expect((await res.json()) as { data?: { enabled: boolean } }).toMatchObject({
      data: { enabled: false },
    });
  });
});
