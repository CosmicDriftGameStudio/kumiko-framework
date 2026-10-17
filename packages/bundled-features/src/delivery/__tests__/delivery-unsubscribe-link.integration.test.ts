// A notification declared with `unsubscribe: true` gets a signed unsubscribe link from the
// delivery service itself: List-Unsubscribe headers on the mail, and the one-click POST on the
// real route opts the recipient out of the next send.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configureBlindIndexKey } from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetBlindIndexKeyForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createInMemoryTransport } from "../../channel-email/types.js";
import { createConfigFeature } from "../../config/feature.js";
import { configValuesTable } from "../../config/table.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { collectChannels, createDeliveryService } from "../delivery-service.js";
import { createDeliveryFeature } from "../feature.js";
import {
  deliveryAttemptsTable,
  notificationAddressOptOutsTable,
  notificationPreferencesTable,
} from "../tables.js";
import { createDeliveryTestContext } from "../testing.js";
import type { DeliveryService } from "../types.js";
import { createUnsubscribeRoutes } from "../unsubscribe.js";
import { createPlainFallbackEmailFeature } from "./plain-email-channel.js";

const UNSUBSCRIBE_SECRET = "unsubscribe-link-test-secret-32-chars-min!!";
const BASE_URL = "https://app.example";
const BIDX_KEY = Buffer.alloc(32, 7).toString("base64");

const transport = createInMemoryTransport();
const tenantId: TenantId = testTenantId(701);
const otherTenantId: TenantId = testTenantId(702);
const user = createTestUser({ id: 701, tenantId, roles: ["TenantAdmin"] });

const NEWS = "unsub-probe:notify:news";
const PLAIN = "unsub-probe:notify:plain";

const probe = defineFeature("unsub-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.notification("news", { unsubscribe: true });
  r.notification("plain", {});
});

let stack: TestStack;
let deliveryService: DeliveryService;

beforeAll(async () => {
  configureBlindIndexKey(BIDX_KEY);
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      createPlainFallbackEmailFeature({
        transport,
        resolveEmail: async (userId) => `${userId}@users.test`,
      }),
      probe,
    ],
    extraContext: (deps) => {
      const ctx = createDeliveryTestContext(deps, {
        unsubscribeLinks: { secret: UNSUBSCRIBE_SECRET, baseUrl: BASE_URL },
      });
      deliveryService = ctx.deliveryService;
      return ctx;
    },
    extraRoutes: [...createUnsubscribeRoutes({ secret: UNSUBSCRIBE_SECRET })],
  });
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    notificationPreferencesTable,
    notificationAddressOptOutsTable,
  });
});

afterAll(async () => {
  await stack.cleanup();
  resetBlindIndexKeyForTests();
});

function mailsTo(address: string) {
  return transport.sent.filter((mail) => mail.to === address);
}

async function attemptStatuses(type: string): Promise<string[]> {
  const rows = await selectMany<{ status: string }>(stack.db, deliveryAttemptsTable, {
    notificationType: type,
  });
  return rows.map((row) => row.status);
}

// What a mail client does with the headers: POST the List-Unsubscribe URL with the fixed body.
async function oneClickUnsubscribe(listUnsubscribe: string | undefined): Promise<Response> {
  const url = new URL((listUnsubscribe ?? "").slice(1, -1));
  expect(url.origin).toBe(BASE_URL);
  return stack.app.request(`${url.pathname}${url.search}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });
}

describe("framework-signed unsubscribe links", () => {
  test("user recipient: headers carry the link and the one-click POST suppresses the next send", async () => {
    const address = `${user.id}@users.test`;
    const notify = () =>
      deliveryService.notify(
        NEWS,
        { to: user.id, data: { title: "News", body: "Hello" } },
        createSystemUser(tenantId),
        tenantId,
      );

    await notify();
    const [mail] = mailsTo(address);
    expect(mail?.headers?.["List-Unsubscribe"]).toStartWith(
      `<${BASE_URL}/api/delivery/unsubscribe?token=`,
    );
    expect(mail?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    const res = await oneClickUnsubscribe(mail?.headers?.["List-Unsubscribe"]);
    expect(res.status).toBe(200);

    await notify();
    expect(mailsTo(address)).toHaveLength(1);
    expect(await attemptStatuses(NEWS)).toContain("skipped");
  });

  test("address recipient: headers carry the link and the one-click POST suppresses the next send", async () => {
    const address = "reader@external.test";
    const notify = () =>
      deliveryService.notify(
        NEWS,
        { route: { email: address }, data: { title: "News", body: "Hello" } },
        createSystemUser(tenantId),
        tenantId,
      );

    await notify();
    const [mail] = mailsTo(address);
    expect(mail?.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    const res = await oneClickUnsubscribe(mail?.headers?.["List-Unsubscribe"]);
    expect(res.status).toBe(200);

    await notify();
    expect(mailsTo(address)).toHaveLength(1);
  });

  test("an address opt-out holds only for its tenant and notification", async () => {
    const address = "scoped@external.test";
    const notify = (type: string, tenant: TenantId) =>
      deliveryService.notify(
        type,
        { route: { email: address }, data: { title: "News", body: "Hello" } },
        createSystemUser(tenant),
        tenant,
      );

    await notify(NEWS, tenantId);
    const [mail] = mailsTo(address);
    expect((await oneClickUnsubscribe(mail?.headers?.["List-Unsubscribe"])).status).toBe(200);

    await notify(NEWS, tenantId);
    expect(mailsTo(address)).toHaveLength(1);
    await notify(NEWS, otherTenantId);
    await notify(PLAIN, tenantId);
    expect(mailsTo(address)).toHaveLength(3);
  });

  test("an unsubscribeUrl supplied by the caller wins", async () => {
    const address = "own-link@external.test";
    await deliveryService.notify(
      NEWS,
      {
        route: { email: address },
        data: { title: "News", body: "Hello", unsubscribeUrl: "https://own.example/u?t=1" },
      },
      createSystemUser(tenantId),
      tenantId,
    );
    expect(mailsTo(address)[0]?.headers?.["List-Unsubscribe"]).toBe("<https://own.example/u?t=1>");
  });

  test("a notification without the flag gets no link", async () => {
    const address = "no-flag@external.test";
    await deliveryService.notify(
      PLAIN,
      { route: { email: address }, data: { title: "Plain", body: "Hello" } },
      createSystemUser(tenantId),
      tenantId,
    );
    expect(mailsTo(address)).toHaveLength(1);
    expect(mailsTo(address)[0]?.headers).toBeUndefined();
  });

  test("without unsubscribeLinks configured the mail is sent without a link", async () => {
    const address = "unconfigured@external.test";
    const service = createDeliveryService({
      db: stack.db,
      registry: stack.registry,
      channels: collectChannels(stack.registry),
    });
    await service.notify(
      NEWS,
      { route: { email: address }, data: { title: "News", body: "Hello" } },
      createSystemUser(tenantId),
      tenantId,
    );
    expect(mailsTo(address)).toHaveLength(1);
    expect(mailsTo(address)[0]?.headers).toBeUndefined();
  });

  test("an address recipient without a blind-index key is still mailed, without a link", async () => {
    resetBlindIndexKeyForTests();
    try {
      const address = "no-key@external.test";
      await deliveryService.notify(
        NEWS,
        { route: { email: address }, data: { title: "News", body: "Hello" } },
        createSystemUser(tenantId),
        tenantId,
      );
      expect(mailsTo(address)).toHaveLength(1);
      expect(mailsTo(address)[0]?.headers).toBeUndefined();
    } finally {
      configureBlindIndexKey(BIDX_KEY);
    }
  });
});
