// delivery:query:opted-in-user-ids over the real stack: preference rows are written through the
// event store (upsertPreference), the query is called in-process as a tenant's job system user (JWT verification strips the system
// role, so system identities cannot reach a handler over HTTP).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/feature.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { seedTenantMembership } from "../../tenant/seeding.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { userTable } from "../../user/index.ts";
import { DeliveryQueries } from "../constants.ts";
import { createDeliveryFeature } from "../feature.ts";
import { notificationPreferencesTable } from "../tables.ts";
import { upsertPreference } from "../upsert-preference.ts";

const DIGEST_TYPE = "app:notify:daily-digest";
const FORMER_DIGEST_TYPE = "app:notify:digest";
const INVOICE_TYPE = "app:notify:invoice-ready";

const tenantA = testTenantId(931);
const tenantB = testTenantId(932);
const jobUserA = createSystemUser(tenantA);
const tenantAdminA = createTestUser({ id: 931, roles: ["TenantAdmin"], tenantId: tenantA });

const appFeature = defineFeature("app", (r) => {
  r.requires({ features: ["delivery"] });
  r.notification("daily-digest", { renamedFrom: [FORMER_DIGEST_TYPE] });
  r.notification("invoice-ready", {});
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createConfigFeature(), createTenantFeature(), createDeliveryFeature(), appFeature],
  });
  await unsafePushTables(stack.db, { notificationPreferencesTable, userTable });
});

afterAll(async () => {
  await stack.cleanup();
});

async function setPreference(
  tenantId: typeof tenantA,
  userId: string,
  notificationType: string,
  channel: string,
  enabled: boolean,
): Promise<void> {
  await seedTenantMembership(stack.db, { userId, tenantId, roles: ["User"] });
  const result = await upsertPreference(
    createTenantDb({ db: stack.db, tenantId }),
    createTestUser({ id: 930, roles: ["User"], tenantId }),
    { tenantId, userId, notificationType, channel, enabled },
  );
  expect(result.isSuccess).toBe(true);
}

async function optedIn(notificationType: string, channel: string, caller = jobUserA) {
  const answer = await stack.dispatcher.query(
    DeliveryQueries.optedInUserIds,
    { notificationType, channel },
    caller,
  );
  return answer as { userIds: string[] };
}

describe("delivery:query:opted-in-user-ids", () => {
  test("lists only users with an enabled row for exactly that type and channel, in the caller's tenant", async () => {
    await setPreference(tenantA, "u-on", INVOICE_TYPE, "email", true);
    await setPreference(tenantA, "u-off", INVOICE_TYPE, "email", false);
    await setPreference(tenantA, "u-inapp-only", INVOICE_TYPE, "inApp", true);
    await setPreference(tenantA, "u-other-type", DIGEST_TYPE, "email", true);
    await setPreference(tenantB, "u-foreign", INVOICE_TYPE, "email", true);

    const result = await optedIn(INVOICE_TYPE, "email");
    expect(result.userIds).toEqual(["u-on"]);
  });

  test("returns unique user ids sorted ascending", async () => {
    await setPreference(tenantA, "sort-c", DIGEST_TYPE, "push", true);
    await setPreference(tenantA, "sort-a", DIGEST_TYPE, "push", true);
    await setPreference(tenantA, "sort-b", DIGEST_TYPE, "push", true);
    const result = await optedIn(DIGEST_TYPE, "push");
    expect(result.userIds).toEqual(["sort-a", "sort-b", "sort-c"]);
  });

  test("a row stored under a former name counts when no exact row exists", async () => {
    await setPreference(tenantA, "rename-only-former", FORMER_DIGEST_TYPE, "sms", true);
    const result = await optedIn(DIGEST_TYPE, "sms");
    expect(result.userIds).toEqual(["rename-only-former"]);
  });

  test("an exact disabled row beats an enabled former-name row, an exact enabled row beats a disabled one", async () => {
    await setPreference(tenantA, "rename-exact-off", FORMER_DIGEST_TYPE, "chat", true);
    await setPreference(tenantA, "rename-exact-off", DIGEST_TYPE, "chat", false);
    await setPreference(tenantA, "rename-exact-on", FORMER_DIGEST_TYPE, "chat", false);
    await setPreference(tenantA, "rename-exact-on", DIGEST_TYPE, "chat", true);
    const result = await optedIn(DIGEST_TYPE, "chat");
    expect(result.userIds).toEqual(["rename-exact-on"]);
  });

  test("a removed member keeps the preference row but is no longer listed, a remaining member is", async () => {
    const stayingId = "00000000-0000-4000-8000-000000000931";
    const removedId = "00000000-0000-4000-8000-000000000932";
    await setPreference(tenantA, stayingId, INVOICE_TYPE, "webhook", true);
    await setPreference(tenantA, removedId, INVOICE_TYPE, "webhook", true);
    expect((await optedIn(INVOICE_TYPE, "webhook")).userIds).toEqual([stayingId, removedId]);

    await stack.http.writeOk(
      TenantHandlers.removeMember,
      { userId: removedId, tenantId: tenantA },
      TestUsers.systemAdmin,
    );

    expect((await optedIn(INVOICE_TYPE, "webhook")).userIds).toEqual([stayingId]);
  });

  test("a TenantAdmin is refused, the query is job-only", async () => {
    const res = await stack.http.query(
      DeliveryQueries.optedInUserIds,
      { notificationType: INVOICE_TYPE, channel: "email" },
      tenantAdminA,
    );
    expect(res.status).toBe(403);
  });
});
