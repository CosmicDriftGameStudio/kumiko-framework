import { randomBytes } from "node:crypto";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  createLateBoundHolder,
  createTestEnvelopeCipher,
  resetTestTables,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createAuthEmailPasswordFeature } from "../../auth-email-password/feature.ts";
import { AuthHandlers } from "../../auth-email-password/web/constants.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createConfigResolver } from "../../config/resolver.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../../tenant/index.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createSessionsFeature } from "../feature.ts";
import { userSessionEntity, userSessionTable } from "../schema/user-session.ts";
import { createSessionCallbacks, type SessionCallbacks } from "../session-callbacks.ts";
import { sessionCallbacksFromLateBound } from "../testing.ts";
import { makeSessionHelpers } from "./test-helpers.ts";

export const SESSIONS_TEST_TENANT: TenantId = testTenantId(1);

export type SessionsTestCallbacks = ReturnType<typeof createLateBoundHolder<SessionCallbacks>>;

export type SessionsTestStack = {
  readonly stack: TestStack;
  readonly h: ReturnType<typeof makeSessionHelpers>;
  readonly callbacks: SessionsTestCallbacks;
  readonly resetBetweenTests: () => Promise<void>;
};

export async function setupSessionsTestStack(): Promise<SessionsTestStack> {
  const callbacks = createLateBoundHolder<SessionCallbacks>("session-callbacks");
  const encryption = createTestEnvelopeCipher(randomBytes(32).toString("base64"));
  const resolver = createConfigResolver({ cipher: encryption });
  const bound = sessionCallbacksFromLateBound(callbacks);

  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuthEmailPasswordFeature(),
      createAuthFoundationFeature(),
      createSessionsFeature(),
    ],
    extraContext: { configResolver: resolver, configEncryption: encryption },
    authConfig: {
      ...bound.asAuthConfig(),
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
    },
  });
  callbacks.set(createSessionCallbacks({ db: stack.db }));
  const h = makeSessionHelpers(stack, SESSIONS_TEST_TENANT, bound.asAuthConfig().sessionCreator);

  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, userSessionEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });

  const resetBetweenTests = async () => {
    await resetTestTables(stack.db, [
      userTable,
      tenantMembershipsTable,
      userSessionTable,
      eventsTable,
    ]);
    // login.write.ts is `per: "ip+handler"` rate-limited (20/60s). h.login()
    // goes through stack.http.raw with no socket address, so every test in
    // a file shares one "unknown" IP bucket — flush it per test so the
    // file's cumulative login() calls can't push a later test over the cap.
    await stack.redis.flushNamespace();
  };

  return { stack, h, callbacks, resetBetweenTests };
}
