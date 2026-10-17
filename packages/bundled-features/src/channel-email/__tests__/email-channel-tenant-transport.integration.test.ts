// With mail-foundation mounted the email channel sends through the tenant's own
// provider; tenants without a provider fall back to the app transport. A tenant
// whose provider is configured but broken must fail, never fall back silently.
// A provider that reads a tenant secret must get that tenant's secret, inline and in jobs.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createTenantDb } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createJobRunner } from "@cosmicdrift/kumiko-framework/jobs";
import {
  createEnvMasterKeyProvider,
  type SecretsContext,
} from "@cosmicdrift/kumiko-framework/secrets";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { ConfigHandlers } from "../../config/constants.js";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature.js";
import { createConfigResolver } from "../../config/resolver.js";
import { configValuesTable } from "../../config/table.js";
import { createPlainFallbackEmailFeature } from "../../delivery/__tests__/plain-email-channel.js";
import { collectChannels, createDeliveryService } from "../../delivery/delivery-service.js";
import { createDeliveryFeature } from "../../delivery/feature.js";
import { deliveryAttemptsTable } from "../../delivery/tables.js";
import { createDeliveryTestContext } from "../../delivery/testing.js";
import type { DeliveryService } from "../../delivery/types.js";
import { mailFoundationFeature } from "../../mail-foundation/feature.js";
import {
  MAIL_TRANSPORT_EXTENSION,
  type MailTransportPlugin,
  tenantMailTransport,
} from "../../mail-foundation/index.js";
import {
  clearInbox,
  getInbox,
  mailTransportInMemoryFeature,
} from "../../mail-transport-inmemory/index.js";
import { createSecretsFeature } from "../../secrets/feature.js";
import { createSecretsContext } from "../../secrets/secrets-context.js";
import { tenantSecretsTable } from "../../secrets/table.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantMembershipsTable } from "../../tenant/membership-table.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { createInMemoryTransport } from "../types.js";

const appTransport = createInMemoryTransport();

const brokenProviderFeature = defineFeature("mail-transport-broken", (r) => {
  r.requires({ features: ["mail-foundation"] });
  const plugin: MailTransportPlugin = {
    build: async () => {
      throw new Error("provider build failed");
    },
  };
  r.useExtension(MAIL_TRANSPORT_EXTENSION, "broken", plugin);
});

// Stands in for an SMTP password: the transport a tenant gets is the one its secret selects.
const transportsBySecret = new Map<string, ReturnType<typeof createInMemoryTransport>>();
function transportForSecret(secret: string) {
  const existing = transportsBySecret.get(secret);
  if (existing) return existing;
  const created = createInMemoryTransport();
  transportsBySecret.set(secret, created);
  return created;
}

const keyedProviderFeature = defineFeature("mail-transport-keyed", (r) => {
  r.requires({ features: ["mail-foundation"] });
  r.requires({ features: ["secrets"] });
  const apiKey = r.secret("api.key", { label: { en: "API key" }, scope: "tenant" });
  const plugin: MailTransportPlugin = {
    build: async (ctx, tenantId) => {
      if (!ctx.secrets) throw new Error("keyed provider: no secrets context");
      const secret = await ctx.secrets.get(tenantId, apiKey);
      if (secret === undefined) throw new Error("keyed provider: api key not set");
      return transportForSecret(secret.reveal());
    },
  };
  r.useExtension(MAIL_TRANSPORT_EXTENSION, "keyed", plugin);
  return { apiKey };
});

const tenantA: TenantId = testTenantId(601);
const tenantB: TenantId = testTenantId(602);
const tenantWithoutProvider: TenantId = testTenantId(603);
const tenantBrokenProvider: TenantId = testTenantId(604);
const tenantKeyedE: TenantId = testTenantId(605);
const tenantKeyedF: TenantId = testTenantId(606);
const SECRET_E = "secret-of-tenant-e";
const SECRET_F = "secret-of-tenant-f";

function adminOf(tenantId: TenantId, id: number) {
  return createTestUser({ id, tenantId, roles: ["TenantAdmin"] });
}

let stack: TestStack;
let deliveryService: DeliveryService;
let accessorFactory: ReturnType<typeof createConfigAccessorFactory>;
let secrets: SecretsContext;

function configFor(tenantId: TenantId) {
  const systemUser = createSystemUser(tenantId);
  return accessorFactory({
    user: { id: systemUser.id, tenantId },
    db: createTenantDb(stack.db, tenantId),
  });
}

beforeAll(async () => {
  const resolver = createConfigResolver();
  const masterKeyProvider = createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
    },
  });
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createSecretsFeature(),
      createDeliveryFeature(),
      mailFoundationFeature,
      mailTransportInMemoryFeature,
      brokenProviderFeature,
      keyedProviderFeature,
      createPlainFallbackEmailFeature({
        transport: appTransport,
        tenantTransport: tenantMailTransport,
        resolveEmail: async () => null,
      }),
    ],
    masterKeyProvider,
    extraContext: (deps) => {
      accessorFactory = createConfigAccessorFactory(deps.registry, resolver);
      secrets = createSecretsContext({ db: deps.db, masterKeyProvider, registry: deps.registry });
      const ctx = createDeliveryTestContext(deps, {
        secrets,
        tenantConfigFor: (tenantId) => configFor(tenantId),
      });
      deliveryService = ctx.deliveryService;
      return { ...ctx, secrets, configResolver: resolver, _configAccessorFactory: accessorFactory };
    },
  });
  await unsafePushTables(stack.db, {
    configValuesTable,
    tenantMembershipsTable,
    tenant_secrets: tenantSecretsTable,
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity, "tenant");

  for (const [tenantId, userId] of [
    [tenantA, 1],
    [tenantB, 2],
    [tenantBrokenProvider, 4],
  ] as const) {
    await stack.http.writeOk(
      ConfigHandlers.set,
      {
        key: "mail-foundation:config:provider",
        value: tenantId === tenantBrokenProvider ? "broken" : "inmemory",
      },
      adminOf(tenantId, userId),
    );
  }
  for (const [tenantId, userId, secret] of [
    [tenantKeyedE, 5, SECRET_E],
    [tenantKeyedF, 6, SECRET_F],
  ] as const) {
    const admin = adminOf(tenantId, userId);
    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: "mail-foundation:config:provider", value: "keyed" },
      admin,
    );
    await stack.http.writeOk(
      "secrets:write:set",
      { key: keyedProviderFeature.exports.apiKey.name, value: secret },
      admin,
    );
  }
});

afterAll(async () => {
  await stack.cleanup();
});

async function notifyInline(tenantId: TenantId, to: string, type: string) {
  await deliveryService.notify(
    type,
    { route: { email: to }, data: { title: "Hello", body: "Body" }, immediate: true },
    createSystemUser(tenantId),
    tenantId,
  );
}

async function attemptStatuses(type: string): Promise<string[]> {
  const rows = await selectMany<{ status: string }>(stack.db, deliveryAttemptsTable, {
    notificationType: type,
  });
  return rows.map((row) => row.status);
}

async function notifyThroughJobs(tenantId: TenantId, to: string, type: string) {
  const redisUrl = process.env["REDIS_URL"];
  if (!redisUrl) throw new Error("REDIS_URL required for the async delivery test");
  const jobRunner = createJobRunner({
    registry: stack.registry,
    context: { db: stack.db, secrets, _configAccessorFactory: accessorFactory },
    redisUrl,
    consumerLane: "worker",
    queueNamePrefix: `kumiko-email-tenant-transport-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  await jobRunner.start();
  try {
    const queuedService = createDeliveryService({
      db: stack.db,
      registry: stack.registry,
      channels: collectChannels(stack.registry),
      jobRunner,
      tenantConfigFor: (id) => configFor(id),
    });
    await queuedService.notify(
      type,
      { route: { email: to }, data: { title: "Hello", body: "Body" } },
      createSystemUser(tenantId),
      tenantId,
    );
    await waitFor(
      async () => {
        expect(await attemptStatuses(type)).toContain("sent");
      },
      { delays: Array(24).fill(250) },
    );
  } finally {
    await jobRunner.stop();
  }
}

describe("channel-email resolves the transport per tenant", () => {
  test("two tenants with a provider each send through their own transport", async () => {
    clearInbox(tenantA);
    clearInbox(tenantB);
    appTransport.sent.length = 0;

    await notifyInline(tenantA, "a@test.local", "app:notify:tenant-a");
    await notifyInline(tenantB, "b@test.local", "app:notify:tenant-b");

    expect(getInbox(tenantA).map((m) => m.to)).toEqual(["a@test.local"]);
    expect(getInbox(tenantB).map((m) => m.to)).toEqual(["b@test.local"]);
    expect(appTransport.sent).toHaveLength(0);
  });

  test("a tenant without a provider falls back to the app transport", async () => {
    appTransport.sent.length = 0;
    await notifyInline(tenantWithoutProvider, "c@test.local", "app:notify:tenant-c");

    expect(appTransport.sent.map((m) => m.to)).toEqual(["c@test.local"]);
    expect(getInbox(tenantWithoutProvider)).toHaveLength(0);
  });

  test("a configured but unusable provider fails the send and never falls back", async () => {
    appTransport.sent.length = 0;
    const type = "app:notify:tenant-broken";
    await notifyInline(tenantBrokenProvider, "d@test.local", type);

    expect(appTransport.sent).toHaveLength(0);
    expect(await attemptStatuses(type)).toEqual(["failed"]);
  });

  test("the render and send jobs resolve the transport from the job's tenant config", async () => {
    clearInbox(tenantB);
    appTransport.sent.length = 0;
    await notifyThroughJobs(tenantB, "job@test.local", "app:notify:tenant-b-job");

    expect(getInbox(tenantB).map((m) => m.to)).toEqual(["job@test.local"]);
    expect(appTransport.sent).toHaveLength(0);
  });

  test("a provider reading a tenant secret gets the sending tenant's secret, inline and in jobs", async () => {
    transportsBySecret.clear();
    appTransport.sent.length = 0;

    await notifyInline(tenantKeyedE, "e@test.local", "app:notify:keyed-e");
    await notifyInline(tenantKeyedF, "f@test.local", "app:notify:keyed-f");
    await notifyThroughJobs(tenantKeyedF, "f-job@test.local", "app:notify:keyed-f-job");
    await notifyThroughJobs(tenantKeyedE, "e-job@test.local", "app:notify:keyed-e-job");

    expect(transportForSecret(SECRET_E).sent.map((m) => m.to)).toEqual([
      "e@test.local",
      "e-job@test.local",
    ]);
    expect(transportForSecret(SECRET_F).sent.map((m) => m.to)).toEqual([
      "f@test.local",
      "f-job@test.local",
    ]);
    expect(appTransport.sent).toHaveLength(0);
  });
});
