// A tenant without its own mail provider gets the test mail through the app transport of
// channel-email, the same sender its notifications fall back to. A tenant with its own
// provider never touches the platform sender, not even when that provider is broken.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { seedRowViaEventStore } from "@cosmicdrift/kumiko-testing/helpers";
import { type TestStack, unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { createChannelEmailFeature } from "../../channel-email/feature.ts";
import { createInMemoryTransport } from "../../channel-email/types.ts";
import { createDeliveryFeature } from "../../delivery/feature.ts";
import {
  createMailFoundationFeature,
  MAIL_TRANSPORT_EXTENSION,
  tenantMailTransport,
} from "../../mail-foundation/index.ts";
import {
  createMailTransportInMemoryFeature,
  getInbox,
} from "../../mail-transport-inmemory/index.ts";
import { createUserFeature, USER_STATUS, userEntity, userTable } from "../../user/index.ts";
import { ReadinessQueries, ReadinessWrites } from "../constants.ts";
import { setupReadinessStack } from "./readiness-test-stack.ts";

const MAIL_PROBE = "mail-foundation:probe:send-test-mail";
const MAIL_PROVIDER_KEY = "mail-foundation:config:provider";

const failingMail = defineFeature("probe-failing-mail", (r) => {
  r.requires({ features: ["mail-foundation"] });
  r.useExtension(MAIL_TRANSPORT_EXTENSION, "failing", {
    selectableInSettings: false,
    build: async () => ({
      send: async () => {
        throw new Error("smtp relay down");
      },
    }),
  });
});

type Row = { probe: string; status: string; message: { i18nKey: string } };

const platformTransport = createInMemoryTransport();
let stack: TestStack;
let nextTenant = 960;

beforeAll(async () => {
  stack = await setupReadinessStack({
    features: [
      createUserFeature(),
      createMailFoundationFeature(),
      createMailTransportInMemoryFeature(),
      failingMail,
      createDeliveryFeature(),
      createChannelEmailFeature({
        transport: platformTransport,
        tenantTransport: tenantMailTransport,
        resolveEmail: async () => null,
      }),
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

async function freshAdmin(email: string) {
  nextTenant += 1;
  const admin = createTestUser({
    id: nextTenant,
    tenantId: testTenantId(nextTenant),
    roles: ["TenantAdmin"],
  });
  await seedRowViaEventStore(stack.db, userTable, {
    id: admin.id,
    email,
    passwordHash: "hashed",
    displayName: "Probe Admin",
    locale: "en",
    emailVerified: true,
    roles: '["TenantAdmin"]',
    status: USER_STATUS.Active,
  });
  return admin;
}

async function selectProvider(admin: Awaited<ReturnType<typeof freshAdmin>>, provider: string) {
  await stack.http.writeOk("config:write:set", { key: MAIL_PROVIDER_KEY, value: provider }, admin);
}

async function mailRowOf(admin: Awaited<ReturnType<typeof freshAdmin>>): Promise<Row | undefined> {
  await stack.http.writeOk(ReadinessWrites.runProbes, {}, admin);
  await stack.drainJobs();
  const { rows } = await stack.http.queryOk<{ rows: Row[] }>(
    ReadinessQueries.latestResults,
    {},
    admin,
  );
  return rows.find((row) => row.probe === MAIL_PROBE);
}

describe("mail probe sender order", () => {
  test("sends the test mail via the platform sender to the starter only", async () => {
    const admin = await freshAdmin("platform-starter@probe.example");
    const sentBefore = platformTransport.sent.length;

    const row = await mailRowOf(admin);

    expect(row?.status).toBe("ok");
    expect(row?.message.i18nKey).toBe("mail-foundation.probe.send-test-mail.platform-accepted");
    expect(platformTransport.sent.slice(sentBefore).map((mail) => mail.to)).toEqual([
      "platform-starter@probe.example",
    ]);
    expect(getInbox(admin.tenantId)).toEqual([]);
    expect(JSON.stringify(row)).not.toContain("platform-starter@probe.example");
  });

  test("a platform sender that rejects the mail fails with the platform text, not the raw error", async () => {
    const admin = await freshAdmin("platform-starter2@probe.example");
    platformTransport.failNext = { message: "relay quota exceeded" };

    const row = await mailRowOf(admin);

    expect(row?.status).toBe("failed");
    expect(row?.message.i18nKey).toBe("mail-foundation.probe.platform-send-rejected");
    expect(JSON.stringify(row)).not.toContain("relay quota exceeded");
  });

  test("an own provider wins over the platform sender", async () => {
    const admin = await freshAdmin("own-starter@probe.example");
    await selectProvider(admin, "inmemory");
    const sentBefore = platformTransport.sent.length;

    const row = await mailRowOf(admin);

    expect(row?.message.i18nKey).toBe("mail-foundation.probe.send-test-mail.accepted");
    expect(getInbox(admin.tenantId).map((mail) => mail.to)).toEqual(["own-starter@probe.example"]);
    expect(platformTransport.sent.length).toBe(sentBefore);
  });

  test("a broken own provider fails without falling back to the platform sender", async () => {
    const admin = await freshAdmin("own-starter2@probe.example");
    await selectProvider(admin, "failing");
    const sentBefore = platformTransport.sent.length;

    const row = await mailRowOf(admin);

    expect(row?.status).toBe("failed");
    expect(row?.message.i18nKey).toBe("mail-foundation.probe.send-rejected");
    expect(platformTransport.sent.length).toBe(sentBefore);
  });
});
