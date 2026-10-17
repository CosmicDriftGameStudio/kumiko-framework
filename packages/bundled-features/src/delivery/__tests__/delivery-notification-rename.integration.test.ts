import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configureBlindIndexKey } from "@cosmicdrift/kumiko-framework/crypto";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  defineWriteHandler,
  type NotifyFn,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetBlindIndexKeyForTests } from "@cosmicdrift/kumiko-framework/testing";
import { createRendererMailHtmlFeature } from "@cosmicdrift/kumiko-renderer-mail-html";
import * as z from "zod";
import { createInMemoryTransport } from "../../channel-email/types.js";
import { createConfigFeature } from "../../config/feature.js";
import { configValuesTable } from "../../config/table.js";
import { createRendererFoundationFeature } from "../../renderer-foundation/feature.js";
import { createTemplateResolverFeature } from "../../template-resolver/feature.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { hashUnsubscribeAddress, upsertAddressOptOut } from "../address-opt-out.js";
import { DeliveryHandlers, DeliveryQueries } from "../constants.js";
import { createDeliveryFeature } from "../feature.js";
import { notificationAddressOptOutsTable, notificationPreferencesTable } from "../tables.js";
import { createDeliveryTestContext } from "../testing.js";
import { upsertPreference } from "../upsert-preference.js";
import { createPlainFallbackEmailFeature } from "./plain-email-channel.js";

const CURRENT_TYPE = "app:notify:invoice-ready";
const FORMER_TYPE = "app:notify:invoice-created";
const ADDRESS = "rename-recipient@test.com";

const emailTransport = createInMemoryTransport();
const testEmail = (userId: string) => `user-${userId}@test.com`;
const user = createTestUser({ id: 2, roles: ["User"] });

const appFeature = defineFeature("app", (r) => {
  r.requires("delivery");
  r.notification("invoice-ready", { renamedFrom: [FORMER_TYPE] });
  r.writeHandler(
    defineWriteHandler({
      name: "notifyUser",
      schema: z.object({ userId: z.string() }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      handler: async (event, ctx) => {
        await (ctx.notify as NotifyFn)(CURRENT_TYPE, {
          to: event.payload.userId,
          data: { title: "Invoice", body: "ready" },
        });
        return { isSuccess: true, data: {} };
      },
    }),
  );
  r.writeHandler(
    defineWriteHandler({
      name: "notifyAddress",
      schema: z.object({ email: z.string() }),
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      handler: async (event, ctx) => {
        await (ctx.notify as NotifyFn)(CURRENT_TYPE, {
          route: { email: event.payload.email },
          data: { title: "Invoice", body: "ready" },
        });
        return { isSuccess: true, data: {} };
      },
    }),
  );
});

const features = [
  createConfigFeature(),
  createTenantFeature(),
  createTemplateResolverFeature(),
  createRendererFoundationFeature(),
  createDeliveryFeature(),
  createRendererMailHtmlFeature(),
  createPlainFallbackEmailFeature({
    transport: emailTransport,
    resolveEmail: async (userId) => testEmail(userId),
  }),
  appFeature,
] as const;

let stack: TestStack;

beforeAll(async () => {
  configureBlindIndexKey(Buffer.alloc(32, 7).toString("base64"));
  stack = await setupTestStack({
    features,
    extraContext: (deps) => createDeliveryTestContext(deps, {}),
  });
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
    notificationAddressOptOutsTable,
  });
});

afterAll(async () => {
  resetBlindIndexKeyForTests();
  await stack.cleanup();
});

beforeEach(() => {
  emailTransport.sent.length = 0;
});

const tenantDb = () => createTenantDb(stack.db, user.tenantId);
const sentTo = (address: string) => emailTransport.sent.filter((m) => m.to === address);

async function storeFormerNamePreference(enabled: boolean): Promise<void> {
  const result = await upsertPreference(tenantDb(), user, {
    tenantId: user.tenantId,
    userId: user.id,
    notificationType: FORMER_TYPE,
    channel: "email",
    enabled,
  });
  expect(result.isSuccess).toBe(true);
}

async function storeFormerNameOptOut(): Promise<string> {
  const addressHash = hashUnsubscribeAddress(ADDRESS);
  if (addressHash === undefined) throw new Error("blind-index key not configured");
  const result = await upsertAddressOptOut(tenantDb(), user, {
    tenantId: user.tenantId,
    addressHash,
    notificationType: FORMER_TYPE,
    channel: "email",
  });
  expect(result.isSuccess).toBe(true);
  return addressHash;
}

describe("notification rename keeps preferences and opt-outs", () => {
  test("registry exposes the declared former names", () => {
    expect(stack.registry.getAllNotifications().get(CURRENT_TYPE)?.renamedFrom).toEqual([
      FORMER_TYPE,
    ]);
  });

  test("a preference stored under the former name suppresses the renamed notification", async () => {
    await storeFormerNamePreference(false);
    await stack.http.writeOk("app:write:notify-user", { userId: user.id }, user);
    expect(sentTo(testEmail(user.id))).toHaveLength(0);
  });

  test("an address opt-out stored under the former name suppresses the renamed notification", async () => {
    await storeFormerNameOptOut();
    await stack.http.writeOk("app:write:notify-address", { email: ADDRESS }, user);
    expect(sentTo(ADDRESS)).toHaveLength(0);
  });

  test("setPreference with the former name stores and reports the current name", async () => {
    const response = await stack.http.writeOk<{ notificationType: string }>(
      DeliveryHandlers.setPreference,
      { notificationType: FORMER_TYPE, channel: "email", enabled: false },
      user,
    );
    expect(response.notificationType).toBe(CURRENT_TYPE);

    const prefs = await stack.http.queryOk<{ rows: Record<string, unknown>[] }>(
      DeliveryQueries.preferences,
      {},
      user,
    );
    const stored = prefs.rows.filter((row) => row["channel"] === "email");
    expect(stored.some((row) => row["notificationType"] === CURRENT_TYPE)).toBe(true);
  });

  test("an enabled preference under the current name wins over a disabled former-name row", async () => {
    await storeFormerNamePreference(false);
    await stack.http.writeOk(
      DeliveryHandlers.setPreference,
      { notificationType: CURRENT_TYPE, channel: "email", enabled: true },
      user,
    );
    await stack.http.writeOk("app:write:notify-user", { userId: user.id }, user);
    expect(sentTo(testEmail(user.id))).toHaveLength(1);
  });

  test("resubscribeAddress lifts opt-outs under the former name", async () => {
    const addressHash = await storeFormerNameOptOut();
    await stack.http.writeOk(
      DeliveryHandlers.resubscribeAddress,
      { addressHash, notificationType: CURRENT_TYPE, channel: "email" },
      createSystemUser(user.tenantId, ["SystemAdmin"]),
    );
    await stack.http.writeOk("app:write:notify-address", { email: ADDRESS }, user);
    expect(sentTo(ADDRESS)).toHaveLength(1);
  });
});
