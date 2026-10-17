// The unsubscribe link points at the sending tenant's own host when the app resolves one, the
// pages behind it speak the mail's language, and an app job triggered on the address opt-out
// learns about it after commit.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configureBlindIndexKey } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createSystemUser,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { localeDe } from "@cosmicdrift/kumiko-locale-de";
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
import { hashUnsubscribeAddress } from "../address-opt-out.js";
import { DELIVERY_UNSUBSCRIBE_PATH } from "../constants.js";
import { createDeliveryFeature } from "../feature.js";
import {
  type UnsubscribeAddressPayload,
  unsubscribeAddressPayloadSchema,
} from "../handlers/unsubscribe-address.write.js";
import { DeliveryHandlers } from "../public-names.js";
import { notificationAddressOptOutsTable, notificationPreferencesTable } from "../tables.js";
import { createDeliveryTestContext } from "../testing.js";
import type { DeliveryService } from "../types.js";
import { createUnsubscribeRoutes, signAddressUnsubscribeToken } from "../unsubscribe.js";
import { createPlainFallbackEmailFeature } from "./plain-email-channel.js";

const UNSUBSCRIBE_SECRET = "unsubscribe-origin-test-secret-32-chars-min!";
const BASE_URL = "https://app.example";
const BIDX_KEY = Buffer.alloc(32, 9).toString("base64");
const NEWS = "unsub-origin:notify:news";

const transport = createInMemoryTransport();
const tenantWithOrigin: TenantId = testTenantId(801);
const tenantWithoutOrigin: TenantId = testTenantId(802);
const tenantOriginThrows: TenantId = testTenantId(803);
const tenantOriginInsecure: TenantId = testTenantId(804);

const tenantOrigins = new Map<TenantId, () => Promise<string | null>>([
  [tenantWithOrigin, async () => "https://acme.status.example/ignored/path"],
  [tenantWithoutOrigin, async () => null],
  [
    tenantOriginThrows,
    async () => {
      throw new Error("custom-domain lookup down");
    },
  ],
  [tenantOriginInsecure, async () => "http://acme.insecure.example"],
]);

const optOutsSeenByApp: Array<{ payload: UnsubscribeAddressPayload; tenantId: TenantId }> = [];

const appFeature = defineFeature("unsub-origin", (r) => {
  r.requires({ features: ["delivery"] });
  r.notification("news", { unsubscribe: true });
  r.job(
    "drop-subscriber",
    { trigger: { on: DeliveryHandlers.unsubscribeAddress }, runIn: "worker" },
    async (payload, ctx) => {
      const tenantId = ctx.triggeredBy?.tenantId;
      if (tenantId === undefined) throw new Error("opt-out job without a tenant");
      optOutsSeenByApp.push({ payload: unsubscribeAddressPayloadSchema.parse(payload), tenantId });
    },
  );
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
      localeDe(),
      appFeature,
    ],
    jobs: { consumerLane: "worker" },
    extraContext: (deps) => {
      const ctx = createDeliveryTestContext(deps, {
        unsubscribeLinks: {
          secret: UNSUBSCRIBE_SECRET,
          baseUrl: BASE_URL,
          tenantOrigin: async (channelCtx) =>
            (await tenantOrigins.get(channelCtx.tenantId)?.()) ?? null,
        },
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

async function mailNews(address: string, tenantId: TenantId, locale?: string): Promise<URL> {
  await deliveryService.notify(
    NEWS,
    {
      route: { email: address },
      data: { title: "News", body: "Hello" },
      ...(locale !== undefined && { locale }),
    },
    createSystemUser(tenantId),
    tenantId,
  );
  const mail = transport.sent.find((sent) => sent.to === address);
  const header = mail?.headers?.["List-Unsubscribe"];
  if (header === undefined) throw new Error(`no List-Unsubscribe header for ${address}`);
  return new URL(header.slice(1, -1));
}

function tokenOf(link: URL): string {
  const token = link.searchParams.get("token");
  if (token === null) throw new Error("link without token");
  return token;
}

async function postForm(path: string, body: Record<string, string>): Promise<Response> {
  return stack.app.request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

async function oneClick(link: URL): Promise<Response> {
  return stack.app.request(`${link.pathname}${link.search}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "List-Unsubscribe=One-Click",
  });
}

function hiddenResubscribeToken(html: string): string {
  const match = /name="token" value="([^"]+)"/.exec(html);
  if (match?.[1] === undefined) throw new Error("unsubscribed page without undo token");
  return match[1].replaceAll("&amp;", "&");
}

describe("unsubscribe link origin", () => {
  test("points at the tenant's own origin when the app resolves one", async () => {
    const link = await mailNews("origin@external.test", tenantWithOrigin);
    expect(link.origin).toBe("https://acme.status.example");
    expect(link.pathname).toBe(DELIVERY_UNSUBSCRIBE_PATH);
  });

  test("falls back to the app origin on null, a throw or a non-https origin", async () => {
    for (const [tenantId, address] of [
      [tenantWithoutOrigin, "no-origin@external.test"],
      [tenantOriginThrows, "throws@external.test"],
      [tenantOriginInsecure, "insecure@external.test"],
    ] as const) {
      const link = await mailNews(address, tenantId);
      expect(link.origin).toBe(BASE_URL);
    }
  });
});

describe("unsubscribe pages in the mail's language", () => {
  test("confirmation, result and undo pages render in the locale the mail was sent in", async () => {
    const link = await mailNews("de-reader@external.test", tenantWithOrigin, "de");

    const confirm = await stack.app.request(`${link.pathname}${link.search}`);
    expect(confirm.status).toBe(200);
    const confirmHtml = await confirm.text();
    expect(confirmHtml).toContain('<html lang="de">');
    expect(confirmHtml).toContain("Diese E-Mails nicht mehr erhalten?");
    expect(link.searchParams.has("lang")).toBe(false);

    const done = await postForm(DELIVERY_UNSUBSCRIBE_PATH, { token: tokenOf(link) });
    expect(done.status).toBe(200);
    const doneHtml = await done.text();
    expect(doneHtml).toContain("Diese E-Mails kommen nicht mehr.");

    const undo = await postForm("/api/delivery/resubscribe", {
      token: hiddenResubscribeToken(doneHtml),
    });
    expect(undo.status).toBe(200);
    expect(await undo.text()).toContain("Diese E-Mails kommen wieder.");
  });

  test("a token signed without a locale renders the English page", async () => {
    const token = await signAddressUnsubscribeToken(
      {
        tenantId: tenantWithOrigin,
        notificationType: NEWS,
        channel: "email",
        address: "legacy@external.test",
      },
      UNSUBSCRIBE_SECRET,
    );
    const res = await stack.app.request(
      `${DELIVERY_UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("Unsubscribe from these emails?");
  });
});

describe("app hook after an address opt-out", () => {
  test("a job triggered on unsubscribeAddress receives the opt-out with its tenant", async () => {
    const address = "Hook.Reader@external.test";
    const link = await mailNews(address, tenantWithOrigin);
    optOutsSeenByApp.length = 0;

    expect((await oneClick(link)).status).toBe(200);
    await stack.drainJobs();

    expect(optOutsSeenByApp).toEqual([
      {
        payload: {
          addressHash: hashUnsubscribeAddress(address) ?? "",
          notificationType: NEWS,
          channel: "email",
        },
        tenantId: tenantWithOrigin,
      },
    ]);
  });

  test("a forged token opts nobody out and fires no job", async () => {
    const link = await mailNews("forged@external.test", tenantWithoutOrigin);
    optOutsSeenByApp.length = 0;
    const forged = new URL(link);
    forged.searchParams.set("token", `${tokenOf(link)}x`);

    expect((await oneClick(forged)).status).toBeGreaterThanOrEqual(400);
    await stack.drainJobs();

    expect(optOutsSeenByApp).toEqual([]);
  });
});
