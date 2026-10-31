import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAuthEmailPasswordFeature } from "@cosmicdrift/kumiko-bundled-features/auth-email-password";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { createComplianceProfilesFeature } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import {
  configValuesTable,
  createConfigFeature,
  createConfigResolver,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createDeliveryFeature,
  createDeliveryTestContext,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import {
  createSessionCallbacks,
  createSessionsFeature,
  type SessionCallbacks,
} from "@cosmicdrift/kumiko-bundled-features/sessions";
import {
  sessionCallbacksFromLateBound,
  withMintedSession,
} from "@cosmicdrift/kumiko-bundled-features/sessions/testing";
import { createTenantFeature, TenantHandlers } from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createTenantInactivityFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-inactivity";
import { createTenantLifecycleFeature } from "@cosmicdrift/kumiko-bundled-features/tenant-lifecycle";
import { createUserFeature } from "@cosmicdrift/kumiko-bundled-features/user";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { createLateBoundHolder, createManualClock } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";

const START = Temporal.Instant.from("2030-01-15T10:00:00Z");
const clock = createManualClock(START);
const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");

let stack: TestStack;

beforeAll(async () => {
  const bound = sessionCallbacksFromLateBound(callbacks);
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createUserFeature(),
      createComplianceProfilesFeature(),
      createDeliveryFeature(),
      createAuthFoundationFeature(),
      createAuthEmailPasswordFeature(),
      createSessionsFeature({ clock }),
      createTenantLifecycleFeature(),
      createTenantInactivityFeature({
        rule: { after: { months: 12 }, warnings: [{ days: 30 }, { days: 7 }] },
        keepAccountUrl: "https://app.example.test/keep-account",
      }),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver({ cipher: undefined }),
      clock,
    }),
    authConfig: { ...bound.asAuthConfig(), membershipQuery: "tenant:query:memberships" },
    jobs: { consumerLane: "worker" },
  });
  callbacks.set(createSessionCallbacks({ db: stack.db, clock }));
  await unsafePushTables(stack.db, { configValuesTable });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("tenant-inactivity recipe", () => {
  test("the daily job plans the first warning from the last activity", async () => {
    const creator = sessionCallbacksFromLateBound(callbacks).asAuthConfig().sessionCreator;
    if (!creator) throw new Error("no sessionCreator");
    const systemAdmin = () =>
      withMintedSession(creator, { ...TestUsers.systemAdmin, tenantId: SYSTEM_TENANT_ID });
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: TestUsers.admin.tenantId, key: "acme", name: "Acme Corp" },
      await systemAdmin(),
    );

    await stack.jobRunner?.dispatch("tenant-inactivity:job:check-inactive-tenants", {});
    await stack.drainJobs();

    const outlook = await stack.http.queryOk<Record<string, unknown>>(
      "tenant-inactivity:query:state",
      { tenantIdOverride: TestUsers.admin.tenantId },
      await systemAdmin(),
    );
    const deadline = START.toZonedDateTimeISO("UTC").add({ months: 12 }).toInstant();
    expect(outlook["exempt"]).toBe(false);
    expect(outlook["nextStep"]).toBe("warning");
    expect(outlook["nextStepAt"]).toBe(deadline.subtract({ hours: 30 * 24 }).toString());
  });
});
