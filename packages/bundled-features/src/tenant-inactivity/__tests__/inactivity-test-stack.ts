import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createLateBoundHolder,
  createManualClock,
  createTestEnvelopeCipher,
  type ManualClock,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  authMailRendererFeatures,
  seedAuthMailTemplates,
} from "../../auth-email-password/__tests__/auth-mail-stack.ts";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { AuthHandlers } from "../../auth-email-password/web/constants.ts";
import { createChannelEmailFeature } from "../../channel-email/feature.ts";
import { createInMemoryTransport } from "../../channel-email/types.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileTable,
} from "../../compliance-profiles/index.ts";
import {
  configValuesTable,
  createConfigFeature,
  createConfigResolver,
} from "../../config/index.ts";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.ts";
import { deliveryAttemptsTable, notificationPreferencesTable } from "../../delivery/tables.ts";
import { makeSessionHelpers } from "../../sessions/__tests__/test-helpers.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { userSessionTable } from "../../sessions/schema/user-session.ts";
import { createSessionCallbacks, type SessionCallbacks } from "../../sessions/session-callbacks.ts";
import { sessionCallbacksFromLateBound, withMintedSession } from "../../sessions/testing.ts";
import { hashPassword } from "../../shared/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantTable } from "../../tenant/schema/tenant.ts";
import { seedTenantMembership } from "../../tenant/seeding.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { resetTenantLifecycleGateCacheForTests } from "../../tenant-lifecycle/lifecycle-gate.ts";
import { createUserFeature, UserHandlers, userTable } from "../../user/index.ts";
import { createTenantInactivityFeature } from "../feature.ts";
import type { TenantInactivityOptions } from "../options.ts";
import { tenantInactivityStateTable } from "../state-table.ts";

export const INACTIVITY_TENANT: TenantId = TestUsers.admin.tenantId;
export const OWNER_PASSWORD = "correct-horse-battery";
export const KEEP_URL = "https://app.test/keep-account";
export const KEEP_SECRET = "k".repeat(40);
const OWNER_EMAIL = "owner@inactivity.test";

export type InactivityTestStack = {
  readonly stack: TestStack;
  readonly clock: ManualClock;
  readonly sent: ReturnType<typeof createInMemoryTransport>["sent"];
  readonly reset: () => Promise<void>;
  readonly seedTenantWithOwner: (tenantId?: TenantId) => Promise<void>;
  readonly runJob: () => Promise<void>;
  readonly loginOwner: () => Promise<string>;
  readonly keepAccount: (token: string) => Promise<Response>;
  readonly tokenInMail: (mailIndex: number) => string;
  readonly seedTenant: (tenantId: TenantId) => Promise<void>;
  readonly queryState: (tenantIdOverride?: string) => Promise<Record<string, unknown>>;
  readonly queryStateWithToken: (token: string, tenantIdOverride?: string) => Promise<Response>;
  readonly tenantRow: (tenantId?: TenantId) => Promise<Record<string, unknown> | undefined>;
  readonly stateRows: () => Promise<readonly Record<string, unknown>[]>;
};

export async function setupInactivityStack(
  optionsFor: (clock: ManualClock) => TenantInactivityOptions,
  startAt: Temporal.Instant = Temporal.Instant.from("2030-01-15T10:00:00Z"),
): Promise<InactivityTestStack> {
  const clock = createManualClock(startAt);
  const transport = createInMemoryTransport();
  const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");
  const bound = sessionCallbacksFromLateBound(callbacks);
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const ownerIds = new Map<string, string>();

  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createUserFeature(),
      createComplianceProfilesFeature(),
      ...authMailRendererFeatures(),
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport,
        resolveEmail: async (userId) =>
          [...ownerIds.entries()].find(([, id]) => id === userId)?.[0] ?? null,
      }),
      createAuthFoundationFeature(),
      createAuthEmailPasswordFeature(),
      createSessionsFeature({ clock }),
      createTenantLifecycleFeature(),
      createTenantInactivityFeature(optionsFor(clock)),
    ],
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps),
      configResolver: createConfigResolver({ cipher: encryption }),
      configEncryption: encryption,
      clock,
    }),
    authConfig: {
      ...bound.asAuthConfig(),
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
    anonymousAccess: { defaultTenantId: INACTIVITY_TENANT },
    jobs: { consumerLane: "worker" },
  });
  callbacks.set(createSessionCallbacks({ db: stack.db, clock }));
  await unsafePushTables(stack.db, { configValuesTable, notificationPreferencesTable });
  await seedAuthMailTemplates(stack);
  const sessionCreator = bound.asAuthConfig().sessionCreator;
  if (!sessionCreator) throw new Error("session callbacks provide no sessionCreator");
  const helpers = makeSessionHelpers(stack, INACTIVITY_TENANT, sessionCreator);
  // Pinned to the system tenant: a session minted in the tenant under test would count as its activity.
  const asSystemAdmin = () =>
    withMintedSession(sessionCreator, { ...TestUsers.systemAdmin, tenantId: SYSTEM_TENANT_ID });

  const reset = async () => {
    resetTenantLifecycleGateCacheForTests();
    await resetTestTables(stack.db, [
      tenantTable,
      tenantComplianceProfileTable,
      tenantMembershipsTable,
      userTable,
      userSessionTable,
      tenantInactivityStateTable,
      deliveryAttemptsTable,
      eventsTable,
    ]);
    await stack.redis.flushNamespace();
    transport.sent.length = 0;
    ownerIds.clear();
    clock.set(startAt);
  };

  const seedTenant = async (tenantId: TenantId) => {
    await stack.http.writeOk(
      TenantHandlers.create,
      { id: tenantId, key: `acme-${tenantId.slice(-4)}`, name: "Acme Corp" },
      await asSystemAdmin(),
    );
  };

  const seedTenantWithOwner = async (tenantId: TenantId = INACTIVITY_TENANT) => {
    await seedTenant(tenantId);
    const created = await stack.http.writeOk<{ id: string }>(
      UserHandlers.create,
      {
        email: OWNER_EMAIL,
        passwordHash: await hashPassword(OWNER_PASSWORD),
        displayName: "Owner",
      },
      await asSystemAdmin(),
    );
    ownerIds.set(OWNER_EMAIL, created.id);
    await seedTenantMembership(stack.db, {
      userId: created.id,
      tenantId,
      roles: ["TenantOwner"],
    });
  };

  return {
    stack,
    clock,
    sent: transport.sent,
    reset,
    seedTenantWithOwner,
    seedTenant,
    runJob: async () => {
      await stack.jobRunner?.dispatch("tenant-inactivity:job:check-inactive-tenants", {});
      await stack.drainJobs();
    },
    keepAccount: async (token) => {
      // The anonymous handler is rate limited per IP; every call here shares the "unknown" bucket.
      await stack.redis.flushNamespace();
      return stack.http.raw("POST", "/api/write", {
        type: "tenant-inactivity:write:keep-account",
        payload: { token },
      });
    },
    tokenInMail: (mailIndex) => {
      // The mail renderer HTML-escapes "=" in the link as "&#x3D;".
      const match = /#token(?:=|&#x3D;)([^"<&\s]+)/.exec(transport.sent[mailIndex]?.html ?? "");
      if (!match?.[1]) throw new Error(`no keep-account token in mail ${mailIndex}`);
      return match[1];
    },
    loginOwner: async () => (await helpers.login(OWNER_EMAIL, OWNER_PASSWORD)).token,
    queryState: async (tenantIdOverride = INACTIVITY_TENANT) =>
      stack.http.queryOk<Record<string, unknown>>(
        "tenant-inactivity:query:state",
        { tenantIdOverride },
        await asSystemAdmin(),
      ),
    queryStateWithToken: (token, tenantIdOverride) =>
      stack.http.raw(
        "POST",
        "/api/query",
        {
          type: "tenant-inactivity:query:state",
          payload: tenantIdOverride === undefined ? {} : { tenantIdOverride },
        },
        { Authorization: `Bearer ${token}` },
      ),
    tenantRow: async (tenantId = INACTIVITY_TENANT) =>
      (await selectMany<Record<string, unknown>>(stack.db, tenantTable, { id: tenantId }))[0],
    stateRows: () => selectMany<Record<string, unknown>>(stack.db, tenantInactivityStateTable, {}),
  };
}
