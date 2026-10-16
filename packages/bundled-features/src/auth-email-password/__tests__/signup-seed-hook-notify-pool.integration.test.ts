// ctx.notify from a seed hook (tenant-membership:seed, inTransaction phase) runs inside the
// self-signup write transaction. With every app-pool slot held by a waiting signup tx, a notify
// that touched the app pool would deadlock; it must defer until after the commit instead.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { defineFeature, HookPhases, type NotifyFn } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { createChannelEmailFeature, createInMemoryTransport } from "../../channel-email/index.js";
import { createChannelInAppFeature } from "../../channel-in-app/feature.js";
import { inAppMessagesTable } from "../../channel-in-app/tables.js";
import { createConfigFeature } from "../../config/index.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { createDeliveryFeature, createDeliveryTestContext } from "../../delivery/index.js";
import { notificationPreferencesTable } from "../../delivery/tables.js";
import { TenantQueries } from "../../tenant/constants.js";
import { createTenantFeature } from "../../tenant/index.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { createUserFeature } from "../../user/feature.js";
import { userEntity } from "../../user/schema/user.js";
import { AuthHandlers } from "../constants.js";
import { createAuthEmailPasswordFeature } from "../feature.js";
import { authMailRendererFeatures, seedAuthMailTemplates } from "./auth-mail-stack.js";

const PARALLEL_SIGNUPS = 2;
const NOTIFICATION_TYPE = "app:notify:signup-welcome";
const IMMEDIATE_NOTIFICATION_TYPE = "app:notify:signup-welcome-immediate";
const emailTransport = createInMemoryTransport();
let notifyImmediately = false;
const notifyOutcomeKinds: string[] = [];

function createBarrier(parties: number): () => Promise<void> {
  let arrived = 0;
  let release!: () => void;
  const allArrived = new Promise<void>((resolve) => {
    release = resolve;
  });
  return () => {
    arrived += 1;
    if (arrived === parties) release();
    return allArrived;
  };
}

let waitForAllSignups = createBarrier(PARALLEL_SIGNUPS);

const welcomeHookFeature = defineFeature("signup-welcome-hook-test", (r) => {
  r.requires("tenant");
  r.requires("delivery");
  r.hook(
    "postSave",
    { allOf: "tenant-membership" },
    async (result, context) => {
      if (!result.isNew) return;
      await waitForAllSignups();
      const notify = context.notify as NotifyFn;
      const notificationType = notifyImmediately ? IMMEDIATE_NOTIFICATION_TYPE : NOTIFICATION_TYPE;
      // An immediate tenant broadcast resolves members on the outside-tx pool, which cannot see
      // the membership this uncommitted signup tx just wrote, so it addresses the user directly.
      const outcome = await notify(notificationType, {
        to: notifyImmediately
          ? (result.data["userId"] as string)
          : { tenant: result.data["tenantId"] as string },
        data: { title: notificationType },
        ...(notifyImmediately && { immediate: true }),
      });
      notifyOutcomeKinds.push(outcome.kind);
    },
    { phase: HookPhases.inTransaction },
  );
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      ...authMailRendererFeatures(),
      createDeliveryFeature(),
      createChannelInAppFeature(),
      createChannelEmailFeature({
        transport: emailTransport,
        resolveEmail: async () => "unused@test.local",
      }),
      createAuthEmailPasswordFeature({
        signup: { tokenTtlMinutes: 60, appUrl: "https://app.example.com/signup/complete" },
      }),
      welcomeHookFeature,
    ],
    dbPoolMax: PARALLEL_SIGNUPS,
    outsideTransactionPoolMax: PARALLEL_SIGNUPS,
    extraContext: (deps) => ({
      ...createDeliveryTestContext(deps, { tenantUserIdsQuery: TenantQueries.resolveUserIds }),
      configResolver: createConfigResolver(),
    }),
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      loginHandler: AuthHandlers.login,
      signup: {
        requestHandler: AuthHandlers.signupRequest,
        confirmHandler: AuthHandlers.signupConfirm,
      },
    },
    trustedProxyHops: 1,
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
    inAppMessagesTable,
  });
  await seedAuthMailTemplates(stack);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  emailTransport.sent.length = 0;
  const allKeys = await stack.redis.redis.keys("signup:*");
  if (allKeys.length > 0) await stack.redis.redis.del(...allKeys);
});

function extractTokenFromMail(text: string): string {
  const match = text.match(/[?&]token=([^&"'<\s\]]+)/);
  if (!match?.[1]) throw new Error(`No token in mail text: ${text.slice(0, 200)}`);
  return decodeURIComponent(match[1]);
}

async function requestSignupToken(email: string): Promise<string> {
  const res = await stack.http.raw(
    "POST",
    "/api/auth/signup-request",
    { email },
    { "x-forwarded-for": email },
  );
  expect(res.status).toBe(200);
  const sent = emailTransport.sent.find((mail) => mail.to === email);
  if (!sent) throw new Error(`no activation mail for ${email}`);
  return extractTokenFromMail(sent.text ?? "");
}

async function confirmSignupsInParallel(emailPrefix: string): Promise<void> {
  waitForAllSignups = createBarrier(PARALLEL_SIGNUPS);
  notifyOutcomeKinds.length = 0;
  const emails = Array.from(
    { length: PARALLEL_SIGNUPS },
    (_, i) => `${emailPrefix}-${i}@example.com`,
  );
  const tokens: string[] = [];
  for (const email of emails) tokens.push(await requestSignupToken(email));

  const responses = await Promise.all(
    tokens.map((token) =>
      stack.http.raw("POST", "/api/auth/signup-confirm", {
        token,
        password: "fresh-secure-pw-1234",
      }),
    ),
  );
  for (const res of responses) expect(res.status).toBe(200);
}

describe("self-signup with seed-hook notifications and an exhausted app pool", () => {
  test("parallel signups complete and deliver the hook notification after commit", async () => {
    notifyImmediately = false;
    await confirmSignupsInParallel("hook");

    expect(notifyOutcomeKinds).toEqual(Array(PARALLEL_SIGNUPS).fill("deferred"));
    await waitFor(async () => {
      const inbox = await selectMany(stack.db, inAppMessagesTable, {
        notificationType: NOTIFICATION_TYPE,
      });
      expect(inbox).toHaveLength(PARALLEL_SIGNUPS);
    });
  });

  test("parallel signups with immediate: true deliver inside the signup tx on the outside-tx pool", async () => {
    notifyImmediately = true;
    await confirmSignupsInParallel("hook-immediate");

    expect(notifyOutcomeKinds).toEqual(Array(PARALLEL_SIGNUPS).fill("dispatched"));
    // Queued channels go through the signup dispatcher's job runner, so the inbox fills async.
    await waitFor(async () => {
      const inbox = await selectMany(stack.db, inAppMessagesTable, {
        notificationType: IMMEDIATE_NOTIFICATION_TYPE,
      });
      expect(inbox).toHaveLength(PARALLEL_SIGNUPS);
    });
  });
});
